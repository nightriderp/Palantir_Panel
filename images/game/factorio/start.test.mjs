/**
 * Prüfungen für `start.sh` des Factorio-Images – ohne Docker und ohne Factorio.
 *
 * Gestellt wird ein `factorio`, das seine Argumente aufschreibt und beim
 * `--create` eine Datei anlegt. Damit sind die Entscheidungen prüfbar, die das
 * Skript trifft: die Karte beim ersten Start, die `server-settings.json` samt
 * Maskierung, das frische RCON-Passwort und die Argumentliste.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/** Pfad in der Schreibweise, die eine POSIX-Shell versteht (Windows: `C:\…`). */
const posix = (pfad) => pfad.replace(/\\/gu, '/');

const HIER = fileURLToPath(new URL('.', import.meta.url));
const START_SH = posix(join(HIER, 'start.sh'));

const LIB_ORDNER = (() => {
  const ziel = mkdtempSync(join(tmpdir(), 'palantir-lib-'));
  copyFileSync(join(HIER, '..', '..', 'base', 'linux', 'palantir.sh'), join(ziel, 'palantir.sh'));

  return posix(ziel);
})();

const SH_VORHANDEN = spawnSync('sh', ['-c', 'exit 0']).error === undefined;
const nurMitShell = { skip: SH_VORHANDEN ? false : 'Keine POSIX-Shell (sh) im PATH.' };

const aufraeumen = [];

after(() => {
  for (const pfad of aufraeumen) {
    spawnSync('sh', ['-c', 'rm -rf "$1"', '_', posix(pfad)]);
  }
});

/** Legt den Arbeitsordner mit einer `factorio`-Attrappe an. */
function arbeitsordner() {
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-factorio-'));
  aufraeumen.push(wurzel);

  const daten = join(wurzel, 'daten');
  const bin = join(daten, '.palantir', 'server', 'factorio', 'bin', 'x64');
  mkdirSync(daten);
  mkdirSync(bin, { recursive: true });

  // Die Attrappe schreibt ihre Argumente auf. Beim `--create` legt sie die
  // genannte Datei an – so verhält sie sich wie Factorio, das die Karte erzeugt
  // und sich danach beendet.
  const datei = join(bin, 'factorio');
  writeFileSync(
    datei,
    [
      '#!/bin/sh',
      'ziel=""',
      'erzeugen=""',
      'for a in "$@"; do',
      '  printf \'argv %s\\n\' "$a"',
      '  case "$vorher" in --create) ziel="$a"; erzeugen=1;; esac',
      '  vorher="$a"',
      'done',
      'if [ -n "$erzeugen" ]; then printf \'karte\\n\' > "$ziel"; fi',
      'exit 0',
      '',
    ].join('\n'),
  );
  spawnSync('sh', ['-c', 'chmod 0755 "$1"', '_', posix(datei)]);

  return { wurzel, daten };
}

function starte(ordner, extra = {}) {
  const ergebnis = spawnSync('sh', [START_SH], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      PALANTIR_DATA_DIR: posix(ordner.daten),
      PALANTIR_LIB_DIR: LIB_ORDNER,
      PALANTIR_STARTUP_PARAMETERS: '',
      FACTORIO_VERSION: '2.0.77',
      FACTORIO_URL: 'https://beispiel.invalid/factorio.tar.xz',
      FACTORIO_SHA256: '0'.repeat(64),
      ...extra,
    },
  });

  return {
    ...ergebnis,
    argv: (ergebnis.stdout ?? '')
      .split('\n')
      .map((zeile) => zeile.replace(/\r$/u, ''))
      .filter((zeile) => zeile.startsWith('argv '))
      .map((zeile) => zeile.slice(5)),
  };
}

const einstellungen = (ordner) =>
  JSON.parse(readFileSync(join(ordner.daten, '.palantir', 'server-settings.json'), 'utf8'));

describe('start.sh – Karte', nurMitShell, () => {
  it('legt beim ersten Start eine an und benutzt sie danach', () => {
    const ordner = arbeitsordner();

    const erster = starte(ordner, { FACTORIO_MAP: 'nordheim' });

    assert.equal(erster.status, 0, erster.stderr);
    const karte = join(ordner.daten, 'karten', 'nordheim.zip');
    assert.ok(existsSync(karte), 'Karte fehlt');
    assert.ok(erster.argv.includes('--create'));

    const zweiter = starte(ordner, { FACTORIO_MAP: 'nordheim' });

    // Beim zweiten Start gibt es sie schon – sonst überschriebe jeder Neustart
    // die Fabrik des Betreibers.
    assert.ok(!zweiter.argv.includes('--create'));
  });

  it('reicht den Startwert an die Erzeugung durch', () => {
    const lauf = starte(arbeitsordner(), { FACTORIO_SEED: '4711' });

    const stelle = lauf.argv.indexOf('--map-gen-seed');
    assert.notEqual(stelle, -1);
    assert.equal(lauf.argv[stelle + 1], '4711');
  });
});

describe('start.sh – server-settings.json', nurMitShell, () => {
  it('schreibt die Felder des Panels', () => {
    const ordner = arbeitsordner();

    starte(ordner, { FACTORIO_NAME: 'Nordheim', MAX_PLAYERS: '24', MOTD: 'Willkommen' });

    const inhalt = einstellungen(ordner);
    assert.equal(inhalt.name, 'Nordheim');
    assert.equal(inhalt.max_players, 24);
    assert.equal(inhalt.description, 'Willkommen');
    assert.equal(inhalt.visibility.public, false);
  });

  it('maskiert Anführungszeichen, statt die Datei zu zerreißen', () => {
    const ordner = arbeitsordner();

    // Ohne Maskierung wäre die Datei ab hier kein JSON mehr, und Factorio
    // beendete sich mit einer Meldung über Zeile und Spalte.
    starte(ordner, { FACTORIO_NAME: 'Der "grosse" Server\\Nord' });

    assert.equal(einstellungen(ordner).name, 'Der "grosse" Server\\Nord');
  });

  it('verlangt für die öffentliche Liste ein ausdrückliches "true"', () => {
    const ordner = arbeitsordner();

    starte(ordner, { FACTORIO_PUBLIC: 'ja' });

    assert.equal(einstellungen(ordner).visibility.public, false);
  });
});

describe('start.sh – RCON und Aufruf', nurMitShell, () => {
  it('legt bei jedem Start ein neues Passwort dort ab, wo die Definition es erwartet', () => {
    const ordner = arbeitsordner();
    const datei = join(ordner.daten, '.palantir', 'rcon.password');

    starte(ordner);
    const erstes = readFileSync(datei, 'utf8').trim();

    starte(ordner);
    const zweites = readFileSync(datei, 'utf8').trim();

    assert.equal(erstes.length, 48);
    assert.notEqual(erstes, zweites);
  });

  it('übergibt Karte, Einstellungen, Port und RCON – und hängt die Startparameter an', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner, {
      SERVER_PORT: '34199',
      PALANTIR_STARTUP_PARAMETERS: '--console-log /dev/stdout',
    });

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.ok(lauf.argv.includes('--start-server'));
    assert.ok(lauf.argv.includes('--server-settings'));
    const port = lauf.argv.indexOf('--port');
    assert.equal(lauf.argv[port + 1], '34199');
    assert.ok(lauf.argv.includes('--rcon-password'));
    assert.deepEqual(lauf.argv.slice(-2), ['--console-log', '/dev/stdout']);
  });
});
