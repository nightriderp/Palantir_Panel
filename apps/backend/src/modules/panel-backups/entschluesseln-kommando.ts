/**
 * Eine verschlüsselte Panel-Sicherung wieder öffnen (Fundpunkt 241).
 *
 * ```
 * pnpm --filter @palantir/backend panel:entschluesseln -- \
 *   --datei palantir-2026-09-11....sql.gz.enc \
 *   --schluessel palantir-sicherung.key
 * ```
 *
 * Läuft **dort, wo der private Schlüssel liegt** – also beim Betreiber und
 * nicht auf der VPS. Der übliche Weg ist deshalb: Datei von der VPS holen, hier
 * öffnen, und den entstandenen Abzug einspielen.
 *
 * Geschrieben wird zuerst in eine Beidatei und erst nach dem geprüften Siegel
 * umbenannt: Ein GCM-Strom liefert die Daten, bevor er weiß, ob sie echt sind.
 * Am Ende soll deshalb entweder der vollständige, geprüfte Abzug dastehen oder
 * gar nichts.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { open, readFile, rename, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fragePassphrase } from '../../lib/passphrase-prompt.js';
import {
  SICHERUNGS_MAGIE,
  erzeugeEntschluesselungsStrom,
  istVerschluesselteSicherung,
  ladePrivatenSchluessel,
} from './crypto.js';

function argument(name: string): string | undefined {
  const stelle = process.argv.indexOf(`--${name}`);

  return stelle === -1 ? undefined : process.argv[stelle + 1];
}

/** Zielname: `.enc` fällt weg, sonst hängt `.entschluesselt` hinten an. */
function zielFuer(quelle: string): string {
  return quelle.endsWith('.enc') ? quelle.slice(0, -'.enc'.length) : `${quelle}.entschluesselt`;
}

async function liegtDa(pfad: string): Promise<boolean> {
  return stat(pfad).then(
    () => true,
    () => false,
  );
}

/** Trägt die Datei überhaupt unseren Kopf? Sonst gibt es eine klare Ansage. */
async function pruefeAnfang(pfad: string): Promise<void> {
  const griff = await open(pfad, 'r');

  try {
    const anfang = Buffer.alloc(SICHERUNGS_MAGIE.length);
    const { bytesRead } = await griff.read(anfang, 0, anfang.length, 0);

    if (!istVerschluesselteSicherung(anfang.subarray(0, bytesRead))) {
      throw new Error(
        `${pfad} ist keine verschlüsselte Palantir-Sicherung. ` +
          'Unverschlüsselte Abzüge (.sql.gz) lassen sich direkt mit gunzip lesen.',
      );
    }
  } finally {
    await griff.close();
  }
}

async function main(): Promise<void> {
  const quelle = argument('datei');
  const schluesselPfad = argument('schluessel');

  if (quelle === undefined || schluesselPfad === undefined) {
    console.error('Aufruf:');
    console.error('  pnpm --filter @palantir/backend panel:entschluesseln -- \\');
    console.error('    --datei <sicherung.sql.gz.enc> --schluessel <palantir-sicherung.key> \\');
    console.error('    [--ziel <abzug.sql.gz>]');

    throw new Error('--datei und --schluessel sind nötig.');
  }

  const quellPfad = resolve(quelle);
  const zielPfad = resolve(argument('ziel') ?? zielFuer(quelle));
  const beidatei = `${zielPfad}.teil`;

  /*
   * Das Ziel wird nicht überschrieben. Das Umbenennen am Ende täte es
   * klaglos – und beim Zurückspielen greift man leicht zweimal zur selben
   * Stelle, einmal mit der richtigen und einmal mit der falschen Datei.
   */
  if (await liegtDa(zielPfad)) {
    throw new Error(
      `${zielPfad} liegt bereits da. Datei wegräumen oder mit --ziel einen anderen Namen wählen.`,
    );
  }

  await pruefeAnfang(quellPfad);

  const pem = await readFile(resolve(schluesselPfad), 'utf8');
  const passphrase = await fragePassphrase('Passphrase des privaten Schlüssels: ');
  const schluessel = ladePrivatenSchluessel(pem, passphrase);

  console.log('');
  console.log(`Öffne ${quellPfad} ...`);

  try {
    await pipeline(
      createReadStream(quellPfad),
      erzeugeEntschluesselungsStrom(schluessel),
      // `wx`: Auch die Beidatei wird nicht stillschweigend ersetzt - ein
      // paralleler Lauf auf dieselbe Datei soll auffallen.
      createWriteStream(beidatei, { flags: 'wx' }),
    );
  } catch (fehler: unknown) {
    await rm(beidatei, { force: true }).catch(() => undefined);

    throw fehler;
  }

  await rename(beidatei, zielPfad);

  console.log(`Geschrieben: ${zielPfad}`);
  console.log('');
  console.log('Der Abzug ist gzip-komprimierter SQL-Text. Einspielen z. B. mit:');
  console.log(`  gunzip -c ${zielPfad} | psql "$DATABASE_URL"`);
  console.log('');
  console.log('Der Abzug enthält jedes Konto und jedes Geheimnis der Instanz – nach dem');
  console.log('Einspielen gehört er gelöscht, nicht im Download-Ordner liegen gelassen.');
}

try {
  await main();
} catch (fehler: unknown) {
  console.error('');
  console.error('Fehlgeschlagen:', fehler instanceof Error ? fehler.message : fehler);
  process.exitCode = 1;
}
