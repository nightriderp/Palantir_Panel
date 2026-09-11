/**
 * Schlüsselpaar für die Panel-Sicherungen erzeugen (Fundpunkt 241).
 *
 * ```
 * pnpm --filter @palantir/backend panel:schluessel
 * pnpm --filter @palantir/backend panel:schluessel -- --verzeichnis /pfad --name eigener-name
 * ```
 *
 * Am besten **auf dem eigenen Rechner** ausführen, nicht auf der VPS: Der
 * private Schlüssel soll gar nicht erst auf der Maschine entstehen, deren
 * Sicherungen er aufschließt. Auf die VPS wandert danach nur die `.pub`.
 *
 * Ein bestehendes Paar wird nie überschrieben. Der alte private Schlüssel ist
 * der einzige Weg zurück in die bereits abgelegten Sicherungen – ein Kommando,
 * das ihn beim zweiten Aufruf ersetzt, wäre ein Datenverlust mit Ansage.
 */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fragePassphrase } from '../../lib/passphrase-prompt.js';
import { MINDESTLAENGE_PASSPHRASE, erzeugeSchluesselpaar } from './crypto.js';

function argument(name: string): string | undefined {
  const stelle = process.argv.indexOf(`--${name}`);

  return stelle === -1 ? undefined : process.argv[stelle + 1];
}

/**
 * `EEXIST` in einen Satz übersetzen, der sagt, warum das wichtig ist.
 *
 * Der rohe Fehler nennt nur den Pfad. Dass hinter dem Abbruch der Schutz der
 * bereits abgelegten Sicherungen steht, steht nirgends – und wer ihn nicht
 * kennt, räumt die alte Datei weg und versucht es noch einmal.
 */
function erklaereBestand(fehler: unknown, pfad: string): unknown {
  if ((fehler as NodeJS.ErrnoException | null)?.code !== 'EEXIST') {
    return fehler;
  }

  return new Error(
    `Unter diesem Namen liegt schon ein Schlüssel: ${pfad}\n` +
      '  Er wird nicht ersetzt. Jede damit verschlüsselte Sicherung ließe sich sonst\n' +
      '  nie wieder öffnen. Entweder --name anders wählen oder die alten Dateien\n' +
      '  bewusst wegräumen – im Wissen, dass damit auch die alten Sicherungen gehen.',
  );
}

async function main(): Promise<void> {
  const verzeichnis = argument('verzeichnis') ?? process.cwd();
  const name = argument('name') ?? 'palantir-sicherung';
  const oeffentlicherPfad = resolve(verzeichnis, `${name}.pub`);
  const privaterPfad = resolve(verzeichnis, `${name}.key`);

  console.log('Schlüsselpaar für die Panel-Sicherungen');
  console.log('');
  console.log(`  öffentlich: ${oeffentlicherPfad}`);
  console.log(`  privat:     ${privaterPfad}`);
  console.log('');
  console.log('Die Passphrase schützt den privaten Schlüssel. Sie wird nur beim');
  console.log('Zurückspielen einer Sicherung gebraucht – und ist ohne Ersatz:');
  console.log('Ohne sie ist keine verschlüsselte Sicherung mehr zu öffnen.');
  console.log('');

  const passphrase = await fragePassphrase(
    `Passphrase (mindestens ${String(MINDESTLAENGE_PASSPHRASE)} Zeichen): `,
  );

  if (passphrase.length < MINDESTLAENGE_PASSPHRASE) {
    throw new Error(
      `Die Passphrase ist zu kurz (${String(passphrase.length)} von ${String(MINDESTLAENGE_PASSPHRASE)} Zeichen).`,
    );
  }

  const wiederholung = await fragePassphrase('Passphrase wiederholen:     ');

  if (wiederholung !== passphrase) {
    throw new Error('Die beiden Eingaben stimmen nicht überein.');
  }

  console.log('');
  console.log('Erzeuge RSA-4096 – das dauert ein paar Sekunden ...');

  const paar = erzeugeSchluesselpaar(passphrase);

  /*
   * `wx` statt eines vorherigen Existenz-Tests: Die Prüfung steckt im Schreiben
   * selbst, dazwischen passt kein zweiter Lauf. Der private Teil bekommt 0600 –
   * auf Windows wirkungslos, auf der Maschine, auf der es zählt, nicht.
   */
  try {
    await writeFile(oeffentlicherPfad, paar.oeffentlich, { encoding: 'utf8', flag: 'wx' });
  } catch (fehler: unknown) {
    throw erklaereBestand(fehler, oeffentlicherPfad);
  }

  try {
    await writeFile(privaterPfad, paar.privat, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  } catch (fehler: unknown) {
    console.error('');
    console.error(
      `Der öffentliche Schlüssel wurde geschrieben (${oeffentlicherPfad}), der private nicht.`,
    );
    console.error('Beide Dateien entfernen und das Kommando wiederholen – ein halbes Paar nützt');
    console.error('niemandem: Damit verschlüsselte Sicherungen ließen sich nie wieder öffnen.');

    throw erklaereBestand(fehler, privaterPfad);
  }

  console.log('');
  console.log('Fertig. Was jetzt zu tun ist:');
  console.log('');
  console.log(`1. [VPS]      ${name}.pub auf die VPS legen, z. B. nach`);
  console.log('              /opt/palantir/secrets/palantir-sicherung.pub');
  console.log('2. [VPS]      In der zentralen .env im Repo-Wurzelverzeichnis eintragen:');
  console.log(
    '              PANEL_BACKUP_PUBLIC_KEY_FILE=/opt/palantir/secrets/palantir-sicherung.pub',
  );
  console.log('3. [VPS]      Backend neu starten. Ab dem nächsten Lauf endet der Dateiname');
  console.log('              auf .sql.gz.enc statt .sql.gz.');
  console.log(`4. [bei dir]  ${name}.key sicher verwahren – zusammen mit der Passphrase, aber`);
  console.log('              nicht am selben Ort wie die VPS. Ohne beides ist keine');
  console.log('              verschlüsselte Sicherung wiederherstellbar.');
  console.log('');
  console.log('Ältere, unverschlüsselte Abzüge bleiben liegen und lesbar; sie werden nicht');
  console.log('nachträglich verschlüsselt.');
}

try {
  await main();
} catch (fehler: unknown) {
  console.error('');
  console.error('Fehlgeschlagen:', fehler instanceof Error ? fehler.message : fehler);
  process.exitCode = 1;
}
