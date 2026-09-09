/**
 * Prüfungen für `java.sh` – ohne Docker und ohne JVM.
 *
 * Die Bibliothek ist POSIX-Shell. Ein kleines Skript bindet sie ein, ruft
 * `java_heap_bestimmen` auf und gibt aus, was die Funktion gesetzt hat. Die
 * RAM-Grenze kommt aus einer Datei, auf die `PALANTIR_MEMORY_LIMIT_FILE` zeigt –
 * so hängt das Ergebnis nicht an der cgroup des Rechners, auf dem der Test
 * läuft (Fundpunkt 178).
 *
 * Das Skript läuft unter `set -eu`, wie jedes Startskript, das die Bibliothek
 * einbindet: Eine Funktion, die dort eine ungesetzte Variable liest oder mit
 * einem stillen Fehlschlag endet, risse den Serverstart mit – und genau das
 * soll hier auffallen, nicht auf der Node.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/** Pfad in der Schreibweise, die eine POSIX-Shell versteht (Windows: `C:\…`). */
const posix = (pfad) => pfad.replace(/\\/gu, '/');

const HIER = fileURLToPath(new URL('.', import.meta.url));
const JAVA_SH = posix(join(HIER, 'java.sh'));

const SH_VORHANDEN = spawnSync('sh', ['-c', 'exit 0']).error === undefined;
const nurMitShell = { skip: SH_VORHANDEN ? false : 'Keine POSIX-Shell (sh) im PATH.' };

const aufraeumen = [];

after(() => {
  for (const pfad of aufraeumen) {
    spawnSync('sh', ['-c', 'rm -rf "$1"', '_', posix(pfad)]);
  }
});

/** Legt eine Datei mit dem Inhalt an, der in `memory.max` stünde. */
function grenzdatei(inhalt) {
  const ordner = mkdtempSync(join(tmpdir(), 'palantir-java-'));
  aufraeumen.push(ordner);

  const datei = join(ordner, 'memory.max');
  writeFileSync(datei, `${inhalt}\n`);

  return posix(datei);
}

/**
 * Bindet die Bibliothek ein, ruft `java_heap_bestimmen` auf und liefert, was
 * die Funktion gesetzt hat.
 */
function heapBestimmen(grenze) {
  const ergebnis = spawnSync(
    'sh',
    [
      '-c',
      [
        'set -eu',
        '. "$1"',
        'if java_heap_bestimmen; then ausgang=grenze; else ausgang=keine; fi',
        'printf \'%s\\n\' "$ausgang" "$JAVA_HEAP_ARGUMENTE" "$JAVA_KONTINGENT_MIB" "$JAVA_HEAP_MIB" "$JAVA_RUECKLAGE_MIB"',
      ].join('\n'),
      '_',
      JAVA_SH,
    ],
    {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, PALANTIR_MEMORY_LIMIT_FILE: grenze },
    },
  );

  assert.equal(ergebnis.status, 0, ergebnis.stderr);

  const [ausgang, argumente, kontingent, heap, ruecklage] = ergebnis.stdout
    .split('\n')
    .map((zeile) => zeile.replace(/\r$/u, ''));

  return { ausgang, argumente, kontingent, heap, ruecklage };
}

describe('java.sh – Heap aus dem RAM-Kontingent', nurMitShell, () => {
  // Kontingent (MiB) → Heap (MiB), Rücklage (MiB). Die Rücklage ist ein Viertel
  // des Kontingents, mindestens 512, höchstens 2048 MiB.
  const faelle = [
    [512, 512, 512],
    [1024, 512, 512],
    [2048, 1536, 512],
    [4096, 3072, 1024],
    [8192, 6144, 2048],
    [16_384, 14_336, 2048],
  ];

  for (const [kontingent, heap, ruecklage] of faelle) {
    it(`rechnet ${kontingent} MiB Kontingent auf ${heap} MiB Heap`, () => {
      const lauf = heapBestimmen(grenzdatei(kontingent * 1024 * 1024));

      assert.equal(lauf.ausgang, 'grenze');
      assert.equal(lauf.argumente, `-Xms${heap}M -Xmx${heap}M`);
      assert.equal(lauf.kontingent, String(kontingent));
      assert.equal(lauf.heap, String(heap));
      assert.equal(lauf.ruecklage, String(ruecklage));
    });
  }

  it('überlässt der JVM die Rechnung, wenn die angegebene Datei fehlt', () => {
    const lauf = heapBestimmen(posix(join(tmpdir(), 'palantir-java-gibt-es-nicht')));

    assert.equal(lauf.ausgang, 'keine');
    assert.equal(lauf.argumente, '-XX:MaxRAMPercentage=70');
    // Die Zahlen sind gesetzt, aber leer – unter `set -u` darf ein Startskript
    // sie lesen, ohne vorher nachzusehen.
    assert.deepEqual([lauf.kontingent, lauf.heap, lauf.ruecklage], ['', '', '']);
  });

  it('wertet "max" (cgroup v2 ohne Grenze) nicht als Zahl', () => {
    const lauf = heapBestimmen(grenzdatei('max'));

    assert.equal(lauf.ausgang, 'keine');
    assert.equal(lauf.argumente, '-XX:MaxRAMPercentage=70');
  });

  it('wertet die Ersatzzahl von cgroup v1 nicht als Grenze', () => {
    const lauf = heapBestimmen(grenzdatei('9223372036854771712'));

    assert.equal(lauf.ausgang, 'keine');
    assert.equal(lauf.argumente, '-XX:MaxRAMPercentage=70');
  });

  it('verträgt Leerraum in der Datei', () => {
    const lauf = heapBestimmen(grenzdatei('  4294967296  '));

    assert.equal(lauf.argumente, '-Xms3072M -Xmx3072M');
  });
});
