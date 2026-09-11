/**
 * Prüfungen für `start.sh` des 7-Days-to-Die-Images – ohne Docker, ohne Steam
 * und ohne das Spiel.
 *
 * Der Schwerpunkt liegt auf `serverconfig.xml`: Sie wird bei jedem Start neu
 * geschrieben (XML lässt sich nicht verschmelzen wie `schlüssel=wert`), und ein
 * Anführungszeichen im Servernamen zerrisse sie. Der Server startete dann mit
 * einer Meldung über Zeile und Spalte, mit der niemand etwas anfangen kann.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  copyFileSync(join(HIER, '..', '..', 'base', 'steam', 'steam.sh'), join(ziel, 'steam.sh'));

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

function arbeitsordner() {
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-sdtd-'));
  aufraeumen.push(wurzel);

  const daten = join(wurzel, 'daten');
  const vorlage = join(wurzel, 'steamcmd');
  mkdirSync(daten);
  mkdirSync(join(vorlage, 'linux64'), { recursive: true });
  writeFileSync(join(vorlage, 'linux64', 'steamclient.so'), 'so');

  writeFileSync(
    join(vorlage, 'steamcmd.sh'),
    [
      '#!/bin/sh',
      'ziel=""',
      'for a in "$@"; do',
      '  case "$vorher" in +force_install_dir) ziel="$a";; esac',
      '  vorher="$a"',
      'done',
      'mkdir -p "$ziel"',
      'printf "%s\\n" "#!/bin/sh" "for arg in \\"\\$@\\"; do printf \'argv %s\\\\n\' \\"\\$arg\\"; done" > "$ziel/7DaysToDieServer.x86_64"',
      'chmod 0755 "$ziel/7DaysToDieServer.x86_64"',
      'exit 0',
      '',
    ].join('\n'),
  );
  spawnSync('sh', ['-c', 'chmod 0755 "$1"', '_', posix(join(vorlage, 'steamcmd.sh'))]);

  return { wurzel, daten, vorlage };
}

function starte(ordner, extra = {}) {
  const ergebnis = spawnSync('sh', [START_SH], {
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      PALANTIR_DATA_DIR: posix(ordner.daten),
      PALANTIR_LIB_DIR: LIB_ORDNER,
      PALANTIR_STEAMCMD_DIR: posix(ordner.vorlage),
      PALANTIR_STARTUP_PARAMETERS: '',
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

const konfig = (ordner) =>
  readFileSync(join(ordner.daten, '.palantir', 'serverconfig.xml'), 'utf8');

/** Der Wert einer Eigenschaft aus der XML-Datei. */
function wert(ordner, name) {
  const treffer = new RegExp(`<property name="${name}" value="([^"]*)"/>`, 'u').exec(
    konfig(ordner),
  );

  return treffer === null ? null : treffer[1];
}

describe('start.sh – serverconfig.xml', nurMitShell, () => {
  it('schreibt die Felder des Panels', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner, {
      SDTD_NAME: 'Nordheim',
      MAX_PLAYERS: '12',
      SDTD_WORLD: 'Navezgane',
      SERVER_PORT: '26900',
    });

    assert.equal(lauf.status, 0, lauf.stderr);
    assert.match(konfig(ordner), /^<\?xml version="1\.0"\?>$/mu);
    assert.equal(wert(ordner, 'ServerName'), 'Nordheim');
    assert.equal(wert(ordner, 'ServerMaxPlayerCount'), '12');
    assert.equal(wert(ordner, 'GameWorld'), 'Navezgane');
    assert.equal(wert(ordner, 'ServerPort'), '26900');
  });

  it('maskiert, was ein XML-Attribut zerrisse', () => {
    const ordner = arbeitsordner();

    starte(ordner, { SDTD_NAME: 'Der "grosse" & <beste> Server' });

    const inhalt = konfig(ordner);
    assert.match(inhalt, /value="Der &quot;grosse&quot; &amp; &lt;beste&gt; Server"/u);
    // Und die Datei bleibt eine Zeile je Eigenschaft.
    assert.equal(inhalt.split('\n').filter((z) => z.includes('ServerName')).length, 1);
  });

  it('legt Welt und Spielstände neben die Serverdateien', () => {
    // SteamCMD räumt in seinem Ordner auf; was dem Betreiber gehört, hat dort
    // nichts zu suchen.
    const ordner = arbeitsordner();

    starte(ordner);

    assert.equal(wert(ordner, 'UserDataFolder'), `${posix(ordner.daten)}/welt`);
    assert.equal(wert(ordner, 'SaveGameFolder'), `${posix(ordner.daten)}/welt/Saves`);
  });

  it('lässt Telnet und Web-Dashboard aus', () => {
    // Zwei weitere Wege in den Server hinein, die niemand abgesichert hat –
    // und die das Panel ohnehin nicht spricht.
    const ordner = arbeitsordner();

    starte(ordner);

    assert.equal(wert(ordner, 'TelnetEnabled'), 'false');
    assert.equal(wert(ordner, 'WebDashboardEnabled'), 'false');
  });

  it('übersetzt die Sichtbarkeit in die Zahl, die das Spiel kennt', () => {
    const oeffentlich = arbeitsordner();
    const privat = arbeitsordner();

    starte(oeffentlich, { SDTD_PUBLIC: 'true' });
    starte(privat, { SDTD_PUBLIC: 'false' });

    assert.equal(wert(oeffentlich, 'ServerVisibility'), '2');
    assert.equal(wert(privat, 'ServerVisibility'), '0');
  });
});

describe('start.sh – Aufruf des Servers', nurMitShell, () => {
  it('übergibt die Konfigurationsdatei und die Pflichtschalter', () => {
    const ordner = arbeitsordner();

    const lauf = starte(ordner, { PALANTIR_STARTUP_PARAMETERS: '-noeac' });

    assert.ok(lauf.argv.includes(`-configfile=${posix(ordner.daten)}/.palantir/serverconfig.xml`));
    for (const schalter of ['-dedicated', '-batchmode', '-nographics']) {
      assert.ok(lauf.argv.includes(schalter), `${schalter} fehlt`);
    }
    assert.equal(lauf.argv.at(-1), '-noeac');
  });
});
