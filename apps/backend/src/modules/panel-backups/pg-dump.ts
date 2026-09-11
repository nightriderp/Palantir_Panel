/**
 * Abzug der Panel-Datenbank über `pg_dump` (Mockup-Abgleich 12.5.1).
 *
 * Der Aufruf läuft ohne Shell (`spawn` mit Argumentliste), und die
 * Verbindungsdaten gehen **nicht** als Argument mit: Argumente stehen in der
 * Prozessliste, jeder Nutzer der VPS könnte das Datenbank-Passwort dort
 * mitlesen. Stattdessen wird `DATABASE_URL` in die üblichen `PG*`-Variablen
 * zerlegt und dem Kindprozess als Umgebung mitgegeben.
 *
 * Bewusst zerlegt statt als ganze URL in `PGDATABASE`: libpq erweitert eine
 * Verbindungs-URI nur dort, wo sie ausdrücklich als `dbname` übergeben wird –
 * aus der Umgebung gelesen bliebe sie ein Datenbankname mit Sonderzeichen.
 *
 * Komprimiert wird von `pg_dump` selbst (`--compress`); ein eigener
 * Kompressionsschritt wäre eine weitere Stelle, an der etwas schiefgeht.
 *
 * **Mit Schlüssel schreibt `pg_dump` nicht selbst** (Fundpunkt 241): Der Abzug
 * kommt dann über die Standardausgabe und fließt durch die Verschlüsselung in
 * die Zieldatei. Der Umweg über `--file` und ein nachträgliches Verschlüsseln
 * wäre einfacher zu lesen und falsch – zwischen beiden Schritten läge der
 * vollständige Klartext auf der Platte.
 */

import { spawn } from 'node:child_process';
import { type KeyObject } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { type DatabaseDumper } from './index.js';
import {
  OFFENE_ENDUNG,
  VERSCHLUESSELTE_ENDUNG,
  erzeugeVerschluesselungsStrom,
  ladeOeffentlichenSchluessel,
} from './crypto.js';
import { PanelBackupError } from './errors.js';

/**
 * Frist eines Abzugs, wenn keine andere gesetzt ist.
 *
 * Exportiert, weil der Kehraus abgerissener Läufe (Audit W1-6, bb-04) daraus
 * seine Obergrenze ableitet: Länger als diese Frist kann ein Abzug nicht
 * dauern, ein `running` darüber hinaus gehört keinem lebenden Prozess mehr.
 */
export const PG_DUMP_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export interface PgDumpOptions {
  readonly databaseUrl: string;
  /** Programmname oder voller Pfad; überschreibbar für Umgebungen ohne PATH-Eintrag. */
  readonly binary?: string;
  /** Frist für den gesamten Abzug. */
  readonly timeoutMs?: number;
  /**
   * Pfad zum öffentlichen Schlüssel auf der VPS (`PANEL_BACKUP_PUBLIC_KEY_FILE`).
   *
   * Ohne Angabe bleibt der Abzug im Klartext – der Zustand vor Fundpunkt 241.
   * Gelesen wird die Datei bei **jedem** Lauf und nicht einmalig beim Start:
   * Wer einen falschen Pfad bemerkt und ihn richtigstellt, braucht dafür
   * keinen Neustart des Panels.
   */
  readonly publicKeyFile?: string;
}

/**
 * `DATABASE_URL` in die Umgebungsvariablen von libpq übersetzen.
 *
 * Exportiert, weil genau das die Stelle ist, an der ein Tippfehler in der
 * Verbindungsangabe zu einem leeren Abzug führen würde – sie gehört geprüft.
 */
export function pgEnvFromUrl(databaseUrl: string): Record<string, string> {
  const url = new URL(databaseUrl);
  const env: Record<string, string> = {};

  if (url.hostname !== '') {
    env.PGHOST = decodeURIComponent(url.hostname);
  }

  if (url.port !== '') {
    env.PGPORT = url.port;
  }

  if (url.username !== '') {
    env.PGUSER = decodeURIComponent(url.username);
  }

  if (url.password !== '') {
    env.PGPASSWORD = decodeURIComponent(url.password);
  }

  const datenbank = decodeURIComponent(url.pathname.replace(/^\//, ''));

  if (datenbank !== '') {
    env.PGDATABASE = datenbank;
  }

  const sslmode = url.searchParams.get('sslmode');

  if (sslmode !== null && sslmode !== '') {
    env.PGSSLMODE = sslmode;
  }

  return env;
}

/**
 * Den öffentlichen Schlüssel von der Platte holen.
 *
 * Scheitert das, scheitert der **Lauf** – es wird bewusst nicht auf einen
 * Klartext-Abzug zurückgefallen. Ein Betreiber, der einen Schlüssel eingetragen
 * hat, bekommt entweder eine verschlüsselte Sicherung oder eine sichtbar
 * gescheiterte; still das Gegenteil des Gewollten zu tun wäre die schlechteste
 * der drei Möglichkeiten.
 */
async function ladeSchluessel(pfad: string): Promise<KeyObject> {
  let pem: string;

  try {
    pem = await readFile(pfad, 'utf8');
  } catch (fehler: unknown) {
    const grund = fehler instanceof Error ? fehler.message : 'unbekannt';

    throw new Error(
      `Der öffentliche Schlüssel für die Sicherung ließ sich nicht lesen: ${pfad} (${grund}). ` +
        'Erzeugen mit `pnpm --filter @palantir/backend panel:schluessel`.',
    );
  }

  try {
    return ladeOeffentlichenSchluessel(pem);
  } catch (fehler: unknown) {
    const grund = fehler instanceof Error ? fehler.message : 'unbekannt';

    throw new Error(`Der öffentliche Schlüssel unter ${pfad} taugt nicht: ${grund}`);
  }
}

export function createPgDumpDumper(options: PgDumpOptions): DatabaseDumper {
  const binary = options.binary ?? 'pg_dump';
  const timeoutMs = options.timeoutMs ?? PG_DUMP_DEFAULT_TIMEOUT_MS;
  const schluesselDatei = options.publicKeyFile?.trim() ?? '';
  const verschluesselt = schluesselDatei !== '';

  /**
   * `pg_dump` starten und auf sein Ende warten.
   *
   * Liefert den Prozess an den Aufrufer weiter, solange er lebt: Beim
   * verschlüsselten Weg hängt die Verschlüsselung an seiner Standardausgabe.
   */
  function starte(
    argumente: string[],
    stdout: 'pipe' | 'ignore',
    verbinde: (ausgabe: NodeJS.ReadableStream) => Promise<void>,
  ): { ende: Promise<void>; geschrieben: Promise<void> } {
    const prozess = spawn(binary, argumente, {
      env: { ...process.env, ...pgEnvFromUrl(options.databaseUrl) },
      stdio: ['ignore', stdout, 'pipe'],
    });

    let fehlerText = '';

    prozess.stderr?.on('data', (chunk: Buffer) => {
      fehlerText += chunk.toString('utf8');
    });

    const ende = new Promise<void>((resolve, reject) => {
      const frist = setTimeout(() => {
        prozess.kill('SIGKILL');
        reject(new Error('Der Abzug hat zu lange gedauert und wurde abgebrochen.'));
      }, timeoutMs);

      prozess.on('error', (error: NodeJS.ErrnoException) => {
        clearTimeout(frist);

        if (error.code === 'ENOENT') {
          reject(new PanelBackupError('PANEL_BACKUP_NOT_CONFIGURED'));

          return;
        }

        reject(error);
      });

      prozess.on('close', (code) => {
        clearTimeout(frist);

        if (code === 0) {
          resolve();

          return;
        }

        reject(new Error(fehlerText.trim() || `pg_dump endete mit Code ${String(code)}.`));
      });
    });

    const geschrieben = prozess.stdout === null ? Promise.resolve() : verbinde(prozess.stdout);

    return { ende, geschrieben };
  }

  return {
    extension: verschluesselt ? VERSCHLUESSELTE_ENDUNG : OFFENE_ENDUNG,

    async dump(targetPath: string): Promise<number> {
      if (options.databaseUrl.trim() === '') {
        throw new PanelBackupError('PANEL_BACKUP_NOT_CONFIGURED');
      }

      // Vor dem Start: Ein fehlender Schlüssel soll keinen `pg_dump` anwerfen,
      // dessen Ausgabe nirgendwo hin kann.
      const schluessel = verschluesselt ? await ladeSchluessel(schluesselDatei) : null;

      await mkdir(dirname(targetPath), { recursive: true });

      try {
        if (schluessel === null) {
          const { ende } = starte(
            [
              '--no-owner',
              '--no-privileges',
              '--format=plain',
              '--compress=6',
              '--file',
              targetPath,
            ],
            'ignore',
            () => Promise.resolve(),
          );

          await ende;
        } else {
          const { ende, geschrieben } = starte(
            ['--no-owner', '--no-privileges', '--format=plain', '--compress=6'],
            'pipe',
            (ausgabe) =>
              pipeline(
                ausgabe,
                erzeugeVerschluesselungsStrom(schluessel),
                createWriteStream(targetPath),
              ),
          );

          /*
           * Auf **beide** warten, bevor entschieden wird: Endet `pg_dump` mit
           * einem Fehler, ist die halb geschriebene Datei trotzdem ein gültig
           * versiegeltes Chiffrat – sie sähe heil aus und enthielte einen
           * halben Abzug. Und aufräumen lässt sich erst, wenn niemand mehr
           * hineinschreibt.
           */
          const ausgang = await Promise.allSettled([ende, geschrieben]);
          const abgang = ausgang.find((eintrag) => eintrag.status === 'rejected');

          if (abgang?.status === 'rejected') {
            throw abgang.reason as Error;
          }
        }
      } catch (fehler: unknown) {
        /*
         * Die angefangene Datei mitnehmen. Ein Rumpf, der wie eine Sicherung
         * heißt, ist gefährlicher als gar keine – niemand prüft beim
         * Zurückspielen, ob die Datei vollständig ist.
         */
        await rm(targetPath, { force: true }).catch(() => undefined);

        throw fehler;
      }

      const info = await stat(targetPath);

      return info.size;
    },
  };
}
