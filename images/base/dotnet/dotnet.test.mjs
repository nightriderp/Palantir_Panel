/**
 * Prüfungen für `dotnet.sh` – ohne Docker und ohne .NET.
 *
 * Es gibt hier genau eine Sache zu prüfen, aber die lohnt: Die Schreiborte
 * müssen im Datenordner liegen. Zeigten sie ins Wurzeldateisystem, bräche der
 * Start mit „Access to the path … is denied" ab – und das sieht nicht nach
 * einem Pfadproblem aus.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Frist je Skriptlauf – an einer Stelle, über die Umgebung einstellbar
 * (Fundpunkt 296, Review 2026-09-16 Befund 7.3).
 *
 * Vorher standen an jedem Aufruf fest verdrahtete 30 Sekunden. Allein
 * läuft jedes Skript in Sekundenbruchteilen; unter der Parallelität von
 * `turbo run test` teilen sich alle Pakete dieselbe Maschine, und eine Frist,
 * die von der Maschinenlast abhängt, ist keine (Fundpunkte 290, 295). Deshalb
 * großzügig, und eine gerissene Frist meldet sich als das, was sie ist –
 * statt als Skript, das nichts ausgibt.
 */
const LAUF_FRIST_MS = Number(process.env.PALANTIR_DOTNET_TEST_FRIST_MS ?? 120_000);

/** `spawnSync` mit der gemeinsamen Frist; eine gerissene Frist ist ein eigener Fehlschlag. */
function laufMitFrist(befehl, argumente, optionen = {}) {
  const ergebnis = spawnSync(befehl, argumente, { ...optionen, timeout: LAUF_FRIST_MS });
  if (ergebnis.error?.code === 'ETIMEDOUT' || ergebnis.signal === 'SIGTERM') {
    assert.fail(
      `${befehl} wurde nach ${LAUF_FRIST_MS} ms abgebrochen (PALANTIR_DOTNET_TEST_FRIST_MS). ` +
        'Die Maschine war vermutlich ausgelastet.',
    );
  }
  return ergebnis;
}

/** Pfad in der Schreibweise, die eine POSIX-Shell versteht (Windows: `C:\…`). */
const posix = (pfad) => pfad.replace(/\\/gu, '/');

const HIER = fileURLToPath(new URL('.', import.meta.url));
const PALANTIR_SH = posix(join(HIER, '..', 'linux', 'palantir.sh'));
const DOTNET_SH = posix(join(HIER, 'dotnet.sh'));

const SH_VORHANDEN = spawnSync('sh', ['-c', 'exit 0']).error === undefined;
const nurMitShell = { skip: SH_VORHANDEN ? false : 'Keine POSIX-Shell (sh) im PATH.' };

const aufraeumen = [];

after(() => {
  for (const pfad of aufraeumen) {
    spawnSync('sh', ['-c', 'rm -rf "$1"', '_', posix(pfad)]);
  }
});

function arbeitsordner() {
  const wurzel = mkdtempSync(join(tmpdir(), 'palantir-dotnet-'));
  aufraeumen.push(wurzel);

  const daten = join(wurzel, 'daten');
  mkdirSync(daten);

  return { wurzel, daten };
}

/** Führt ein Stück Shell aus, das beide Bibliotheken eingebunden hat. */
function mitBibliothek(ordner, rumpf, extra = {}) {
  return laufMitFrist(
    'sh',
    ['-c', `set -eu; . "$1"; . "$2"; ${rumpf}`, '_', PALANTIR_SH, DOTNET_SH],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PALANTIR_DATA_DIR: posix(ordner.daten),
        PALANTIR_DOTNET_VERSION: '10.0.0-Test',
        ...extra,
      },
    },
  );
}

describe('dotnet.sh – Orte, die .NET beschreiben darf', nurMitShell, () => {
  it('legt Zwischenspeicher und Zuhause in den Datenordner', () => {
    const ordner = arbeitsordner();

    const lauf = mitBibliothek(
      ordner,
      'dotnet_vorbereiten; printf "bundle %s\\n" "$DOTNET_BUNDLE_EXTRACT_BASE_DIR";' +
        ' printf "heim %s\\n" "$DOTNET_CLI_HOME"',
    );

    assert.equal(lauf.status, 0, lauf.stderr);
    const daten = posix(ordner.daten);
    assert.match(lauf.stdout, new RegExp(`bundle ${daten}/\\.palantir/dotnet/bundle`, 'u'));
    assert.match(lauf.stdout, new RegExp(`heim ${daten}/\\.palantir/dotnet`, 'u'));
    assert.ok(existsSync(join(ordner.daten, '.palantir', 'dotnet', 'bundle')));
  });

  it('schaltet Telemetrie ab', () => {
    // Ein Spielserver ruft nicht zu Hause an.
    const lauf = mitBibliothek(
      arbeitsordner(),
      'dotnet_vorbereiten; printf "telemetrie %s\\n" "$DOTNET_CLI_TELEMETRY_OPTOUT"',
    );

    assert.match(lauf.stdout, /telemetrie 1\n/u);
  });

  it('nennt die Fassung im Log – sie gehört in jede Fehlermeldung', () => {
    const lauf = mitBibliothek(arbeitsordner(), 'dotnet_vorbereiten');

    assert.match(lauf.stdout, /\.NET 10\.0\.0-Test/u);
  });
});
