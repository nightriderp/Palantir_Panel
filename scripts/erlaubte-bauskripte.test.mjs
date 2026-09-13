/**
 * Installationsskripte der Abhaengigkeiten (Arbeitspaket HM-5).
 *
 * `pnpm install` fuehrt ohne weitere Angabe die `preinstall`-, `install`- und
 * `postinstall`-Skripte JEDER Abhaengigkeit aus - auf jedem Entwicklungsrechner
 * und in jedem CI-Lauf. Eine uebernommene Abhaengigkeit braucht dafuer keine
 * Luecke im Code, sie braucht nur eine Zeile in ihrer package.json. Seit HM-5
 * benennt `pnpm.onlyBuiltDependencies` in der Wurzel-package.json, wer das darf.
 *
 * Eine Liste allein rostet aber: Sie steht fest, waehrend die Abhaengigkeiten
 * weiterziehen. Dieser Test haelt beides zusammen - er liest, welche installierten
 * Pakete ein Installationsskript MITBRINGEN, und vergleicht das mit der Liste.
 * Bringt ein Update ein neues mit, wird er rot, und jemand entscheidet: Braucht
 * das Paket sein Skript wirklich?
 *
 * Geprueft wird der Ist-Zustand unter `node_modules/.pnpm`, nicht die
 * `pnpm-lock.yaml`: Die Sperrdatei vermerkt keine Skripte. Plattformabhaengig ist
 * das Ergebnis nicht - die Binaerpakete je Betriebssystem (`@esbuild/linux-x64`
 * und Geschwister) tragen selbst keine Skripte, nur ihre gemeinsame Huelle.
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PNPM_ORDNER = path.join(WURZEL, 'node_modules', '.pnpm');
const SKRIPT_NAMEN = ['preinstall', 'install', 'postinstall'];

/** Namen aller installierten Pakete, die ein Installationsskript mitbringen. */
function paketeMitInstallationsskript() {
  const gefunden = new Set();

  for (const eintrag of readdirSync(PNPM_ORDNER)) {
    const basis = path.join(PNPM_ORDNER, eintrag, 'node_modules');
    if (!existsSync(basis)) continue;

    // Ein Eintrag unter `.pnpm` enthaelt das Paket selbst und seine
    // Abhaengigkeiten als Verweise. Gezaehlt wird nur das Paket selbst -
    // sonst taucht dieselbe Abhaengigkeit unter jedem Nachbarn wieder auf.
    const eigen = eintrag.split('@')[0] || eintrag;

    for (const name of paketnamen(basis)) {
      if (name.replace('/', '+') !== eigen.replace('/', '+')) continue;

      const pfad = path.join(basis, name, 'package.json');
      if (!existsSync(pfad)) continue;

      let paket;
      try {
        paket = JSON.parse(readFileSync(pfad, 'utf8'));
      } catch {
        continue;
      }

      const skripte = paket.scripts ?? {};
      if (SKRIPT_NAMEN.some((schluessel) => skripte[schluessel])) gefunden.add(paket.name);
    }
  }

  return gefunden;
}

/** Paketnamen eines `node_modules`-Ordners, Bereiche (`@scope/name`) aufgeloest. */
function paketnamen(basis) {
  const namen = [];

  for (const eintrag of readdirSync(basis)) {
    if (eintrag.startsWith('@')) {
      for (const unter of readdirSync(path.join(basis, eintrag))) namen.push(`${eintrag}/${unter}`);
    } else {
      namen.push(eintrag);
    }
  }

  return namen;
}

function erlaubte() {
  const paket = JSON.parse(readFileSync(path.join(WURZEL, 'package.json'), 'utf8'));

  return new Set(paket.pnpm?.onlyBuiltDependencies ?? []);
}

describe('Erlaubte Installationsskripte (HM-5)', () => {
  // Ohne installierte Abhaengigkeiten gibt es nichts zu vergleichen. In der CI
  // laeuft `pnpm install` vor den Tests; lokal ohne node_modules waere ein
  // roter Test nur irrefuehrend.
  const installiert = existsSync(PNPM_ORDNER);

  test(
    'die Liste nennt nur Pakete, die es gibt und die ein Skript haben',
    { skip: !installiert },
    () => {
      const mitSkript = paketeMitInstallationsskript();

      for (const name of erlaubte()) {
        assert.ok(
          mitSkript.has(name),
          `\`${name}\` steht in pnpm.onlyBuiltDependencies, bringt aber kein ` +
            'Installationsskript (mehr) mit. Entweder ist der Eintrag veraltet - dann weg ' +
            'damit - oder das Paket heisst inzwischen anders.',
        );
      }
    },
  );

  test('kein Paket baut ungefragt', { skip: !installiert }, () => {
    const zuviel = [...paketeMitInstallationsskript()]
      .filter((name) => !erlaubte().has(name))
      .sort();

    assert.deepEqual(
      zuviel,
      [],
      `Diese Pakete bringen ein Installationsskript mit, stehen aber nicht in ` +
        `pnpm.onlyBuiltDependencies: ${zuviel.join(', ')}.\n` +
        'Das ist kein Formfehler, sondern eine Entscheidung: Braucht das Paket sein ' +
        'Skript wirklich (native Binaerdatei, plattformabhaengiger Download)? Dann in ' +
        'die Liste aufnehmen. Sonst bleibt es draussen - und wenn dadurch etwas ' +
        'fehlschlaegt, ist genau das der Befund.',
    );
  });

  test('esbuild und unrs-resolver sind begruendet dabei', { skip: !installiert }, () => {
    const liste = erlaubte();

    // esbuild holt bzw. verknuepft seine plattformeigene Binaerdatei; ohne sie
    // laeuft weder Vitest noch der Vite-Build.
    assert.ok(liste.has('esbuild'), 'esbuild fehlt in der Liste');
    // unrs-resolver kommt ueber eslint-import-resolver-typescript und bringt
    // seine nativen Bindungen ueber das Skript an ihren Platz.
    assert.ok(liste.has('unrs-resolver'), 'unrs-resolver fehlt in der Liste');
  });
});
