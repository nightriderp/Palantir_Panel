/**
 * Prüfungen für `start.sh` des Bedrock-Images – ohne Docker und ohne Mojang.
 *
 * Gestellt werden zwei Dinge: ein Datenordner und ein `bedrock_server` an der
 * Stelle, an der das Skript ihn erwartet. Damit sind die Entscheidungen
 * prüfbar, die das Skript trifft: die verwalteten Schlüssel in
 * `server.properties`, die Verweise von den Serverdateien auf die
 * Spielstände im Datenordner und der zweite Port für IPv6.
 *
 * Der Verweis-Teil ist der wichtigste. Bedrock kennt keinen Schalter für den
 * Ort der Welten – liegt das Programm woanders als die Spielstände, hängt
 * alles an diesen Verweisen. Geht einer verloren, legt der Server still eine
 * neue, leere Welt an.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
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
const FASSUNG = '1.26.51.1';

/** Die Bibliothek der Wurzel, so wie sie im Container unter `/opt/palantir/lib` liegt. */
const LIB_ORDNER = (() => {
  const ziel = mkdtempSync(join(tmpdir(), 'palantir-lib-'));
  copyFileSync(join(HIER, '..', '..', 'base', 'linux', 'palantir.sh'), join(ziel, 'palantir.sh'));

  return posix(ziel);
})();

const SH_VORHANDEN = spawnSync('sh', ['-c', 'exit 0']).error === undefined;
const nurMitShell = { skip: SH_VORHANDEN ? false : 'Keine POSIX-Shell (sh) im PATH.' };

/*
 * Ein `ln -s` in der Git-Shell unter Windows legt keinen Verweis an, sondern
 * kopiert. Ob das Skript einen Verweis setzt, ist dort also nicht messbar -
 * im Container und in der CI schon. Geprueft wird deshalb ueberall, dass die
 * Datei danach an beiden Stellen steht, und nur auf POSIX zusaetzlich, dass
 * es wirklich ein Verweis ist.
 */
const istPosix = process.platform !== 'win32';

const aufraeumen = [];

after(() => {
  for (const pfad of aufraeumen) {
    spawnSync('sh', ['-c', 'rm -rf "$1"', '_', posix(pfad)]);
  }
});

/**
 * Legt den Arbeitsordner an.
 *
 * `serverDa` steuert, ob die Serverdateien schon ausgepackt sind – ohne sie
 * geht das Skript in den Download-Zweig.
 */
function arbeitsordner({ serverDa = true } = {}) {
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-bedrock-'));
  aufraeumen.push(wurzel);

  const daten = join(wurzel, 'daten');
  const bin = join(wurzel, 'bin');
  mkdirSync(daten);
  mkdirSync(bin);

  if (serverDa) {
    const ordner = join(daten, '.palantir', 'server', FASSUNG);
    mkdirSync(ordner, { recursive: true });

    // Die Attrappe schreibt ihre Argumente auf und endet sofort – mehr braucht
    // keiner dieser Fälle.
    const datei = join(ordner, 'bedrock_server');
    writeFileSync(
      datei,
      ['#!/bin/sh', 'for arg in "$@"; do printf \'argv %s\\n\' "$arg"; done', 'exit 0', ''].join(
        '\n',
      ),
    );
    spawnSync('sh', ['-c', 'chmod 0755 "$1"', '_', posix(datei)]);

    // Zwei Dateien, die im echten Archiv liegen: Das Skript soll sie in den
    // Datenordner übernehmen, bevor es sie durch Verweise ersetzt.
    writeFileSync(join(ordner, 'allowlist.json'), '[]\n');
    writeFileSync(join(ordner, 'permissions.json'), '[]\n');
  }

  return { wurzel, daten, bin, server: join(daten, '.palantir', 'server', FASSUNG) };
}

const umgebung = (ordner, extra = {}) => ({
  ...process.env,
  PALANTIR_DATA_DIR: posix(ordner.daten),
  PALANTIR_LIB_DIR: LIB_ORDNER,
  PALANTIR_STARTUP_PARAMETERS: '',
  BEDROCK_VERSION: FASSUNG,
  BEDROCK_URL: 'https://beispiel.invalid/bedrock.zip',
  BEDROCK_SHA256: '0'.repeat(64),
  ...extra,
});

/** Führt `start.sh` aus und wartet auf sein Ende. */
function starte(ordner, extra = {}) {
  const ergebnis = spawnSync(
    'sh',
    [
      '-c',
      'PATH="$(cd "$1" && pwd):$PATH"; export PATH; exec sh "$2"',
      '_',
      posix(ordner.bin),
      START_SH,
    ],
    { encoding: 'utf8', timeout: 60_000, env: umgebung(ordner, extra) },
  );

  return {
    ...ergebnis,
    zeilen: (ergebnis.stdout ?? '')
      .split('\n')
      .map((zeile) => zeile.replace(/\r$/u, ''))
      .filter((zeile) => zeile.length > 0),
  };
}

/** Liest einen Schlüssel aus `server.properties`. */
function eigenschaft(ordner, schluessel) {
  const inhalt = readFileSync(join(ordner.server, 'server.properties'), 'utf8');
  const treffer = inhalt
    .split('\n')
    .map((zeile) => zeile.trim())
    .find((zeile) => zeile.startsWith(`${schluessel}=`));

  return treffer === undefined ? null : treffer.slice(schluessel.length + 1);
}

describe('start.sh – server.properties', nurMitShell, () => {
  it('schreibt die vom Panel verwalteten Schlüssel', () => {
    const ordner = arbeitsordner();

    const ergebnis = starte(ordner, {
      SERVER_PORT: '25010',
      MAX_PLAYERS: '12',
      MOTD: 'Palantir-Bedrock',
      BEDROCK_GAMEMODE: 'creative',
      BEDROCK_DIFFICULTY: 'hard',
      BEDROCK_LEVEL_NAME: 'Testwelt',
    });

    assert.equal(ergebnis.status, 0, ergebnis.stderr);
    assert.equal(eigenschaft(ordner, 'server-port'), '25010');
    assert.equal(eigenschaft(ordner, 'max-players'), '12');
    assert.equal(eigenschaft(ordner, 'server-name'), 'Palantir-Bedrock');
    assert.equal(eigenschaft(ordner, 'gamemode'), 'creative');
    assert.equal(eigenschaft(ordner, 'difficulty'), 'hard');
    assert.equal(eigenschaft(ordner, 'level-name'), 'Testwelt');
  });

  it('setzt den IPv6-Port neben den Spielport', () => {
    // Ohne diese Angabe nähme der Server seinen Vorgabewert 19133 – und der
    // kollidierte mit dem Nachbarn auf derselben Node.
    const ordner = arbeitsordner();

    starte(ordner, { SERVER_PORT: '25010' });

    assert.equal(eigenschaft(ordner, 'server-portv6'), '25011');
  });

  it('lässt die Konto-Prüfung eingeschaltet', () => {
    // Ohne sie käme jeder mit jedem Namen herein, auch mit dem eines Spielers,
    // der hier schon Rechte hat.
    const ordner = arbeitsordner();

    starte(ordner);

    assert.equal(eigenschaft(ordner, 'online-mode'), 'true');
  });

  it('rührt Schlüssel nicht an, die das Panel nicht verwaltet', () => {
    const ordner = arbeitsordner();

    writeFileSync(
      join(ordner.server, 'server.properties'),
      'view-distance=16\nmax-players=3\n',
      'utf8',
    );

    starte(ordner, { MAX_PLAYERS: '12' });

    assert.equal(eigenschaft(ordner, 'view-distance'), '16');
    assert.equal(eigenschaft(ordner, 'max-players'), '12');
  });
});

describe('start.sh – Spielstände', nurMitShell, () => {
  it('verweist von den Serverdateien auf die Spielstände im Datenordner', () => {
    const ordner = arbeitsordner();

    starte(ordner);

    const verweis = join(ordner.server, 'worlds');

    assert.ok(existsSync(join(ordner.daten, 'worlds')), 'Der Datenordner hat kein worlds.');
    assert.ok(existsSync(verweis), 'Im Serverordner fehlt worlds.');

    if (istPosix) {
      assert.ok(lstatSync(verweis).isSymbolicLink(), 'worlds im Serverordner ist kein Verweis.');
    }
  });

  it('übernimmt Listen aus dem Archiv, bevor es sie ersetzt', () => {
    // `allowlist.json` und `permissions.json` liegen im Archiv. Wären sie nach
    // dem ersten Start weg, verlöre der Betreiber seine Einträge bei jedem
    // Fassungswechsel.
    const ordner = arbeitsordner();

    starte(ordner);

    assert.ok(existsSync(join(ordner.daten, 'allowlist.json')));
    assert.ok(existsSync(join(ordner.daten, 'permissions.json')));

    if (istPosix) {
      assert.ok(lstatSync(join(ordner.server, 'allowlist.json')).isSymbolicLink());
    }
  });

  it('lässt eine bestehende Liste im Datenordner unangetastet', () => {
    const ordner = arbeitsordner();

    writeFileSync(join(ordner.daten, 'allowlist.json'), '[{"name":"Spielerin"}]\n', 'utf8');

    starte(ordner);

    assert.match(readFileSync(join(ordner.daten, 'allowlist.json'), 'utf8'), /Spielerin/u);
  });
});

describe('start.sh – Serverdateien', nurMitShell, () => {
  it('meldet einen gescheiterten Download als 69 statt als Absturz', () => {
    // EX_UNAVAILABLE: Der Server ist in Ordnung, nur die Quelle war nicht zu
    // erreichen. Ein erneuter Start versucht es wieder.
    const ordner = arbeitsordner({ serverDa: false });

    const ergebnis = starte(ordner);

    assert.equal(ergebnis.status, 69, ergebnis.stderr);
  });

  it('verlangt Adresse und Prüfsumme aus dem Image', () => {
    const ordner = arbeitsordner({ serverDa: false });

    const ergebnis = starte(ordner, { BEDROCK_URL: '', BEDROCK_SHA256: '' });

    assert.equal(ergebnis.status, 78, ergebnis.stderr);
  });
});
