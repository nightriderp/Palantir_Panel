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
 */

import { spawn } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type DatabaseDumper } from './index.js';
import { PanelBackupError } from './errors.js';

export interface PgDumpOptions {
  readonly databaseUrl: string;
  /** Programmname oder voller Pfad; überschreibbar für Umgebungen ohne PATH-Eintrag. */
  readonly binary?: string;
  /** Frist für den gesamten Abzug. */
  readonly timeoutMs?: number;
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

export function createPgDumpDumper(options: PgDumpOptions): DatabaseDumper {
  const binary = options.binary ?? 'pg_dump';
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;

  return {
    async dump(targetPath: string): Promise<number> {
      if (options.databaseUrl.trim() === '') {
        throw new PanelBackupError('PANEL_BACKUP_NOT_CONFIGURED');
      }

      await mkdir(dirname(targetPath), { recursive: true });

      await new Promise<void>((resolve, reject) => {
        const prozess = spawn(
          binary,
          ['--no-owner', '--no-privileges', '--format=plain', '--compress=6', '--file', targetPath],
          {
            env: { ...process.env, ...pgEnvFromUrl(options.databaseUrl) },
            stdio: ['ignore', 'ignore', 'pipe'],
          },
        );

        let fehlerText = '';
        prozess.stderr?.on('data', (chunk: Buffer) => {
          fehlerText += chunk.toString('utf8');
        });

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

      const info = await stat(targetPath);

      return info.size;
    },
  };
}
