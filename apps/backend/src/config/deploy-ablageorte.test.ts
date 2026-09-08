import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Die Warnung des Deploy-Skripts zu den Ablageorten (Fundpunkt 177).
 *
 * `deploy/vps/deploy.sh` prüft vor dem Start, ob die Ordner, die in den
 * Backend-Container eingehängt werden, dem Benutzer gehören, unter dem das
 * Backend läuft (UID 1000). Gehören sie `root`, läuft alles scheinbar normal an
 * — und der erste Archivierungslauf, die erste Sicherung oder der erste
 * Schrift-Upload scheitert still am Schreiben.
 *
 * **Der Fall, den dieser Test hält:** Bis Fundpunkt 177 stieg die Prüfung aus,
 * wenn es den Ordner gar nicht gab. Genau dann wird sie aber gebraucht: Auf
 * einer frischen Installation fehlen die Ordner, Docker legt die fehlende
 * Bind-Quelle selbst als `root:root` an, und die Warnung blieb ausgerechnet
 * dort aus, wo sie hingehört.
 *
 * Geprüft wird die Funktion **ausgeführt**, nicht ihr Quelltext: Ein Test, der
 * nur nach einer Zeichenkette im Skript sucht, hält die Formulierung fest, aber
 * nicht das Verhalten.
 */

const HIER = path.dirname(fileURLToPath(import.meta.url));
const DEPLOY_SH = path.resolve(HIER, '../../../../deploy/vps/deploy.sh');

const aufraeumen: string[] = [];

afterAll(() => {
  for (const ordner of aufraeumen) {
    rmSync(ordner, { recursive: true, force: true });
  }
});

/** Schneidet `pruefe_besitzer` aus dem Skript heraus. */
function funktionAusSkript(): string {
  const zeilen = readFileSync(DEPLOY_SH, 'utf8').split('\n');
  const start = zeilen.findIndex((z) => z.startsWith('pruefe_besitzer() {'));

  if (start < 0) {
    throw new Error('pruefe_besitzer() nicht in deploy.sh gefunden');
  }

  // Die Funktion endet an der ersten Zeile, die nur aus `}` besteht.
  const ende = zeilen.findIndex((z, i) => i > start && z === '}');

  if (ende < 0) {
    throw new Error('Ende von pruefe_besitzer() nicht gefunden');
  }

  return zeilen.slice(start, ende + 1).join('\n');
}

/** Ruft die Funktion mit einem Pfad auf und liefert ihre Ausgabe. */
function rufeAuf(pfad: string): string {
  const ordner = mkdtempSync(path.join(tmpdir(), 'palantir-deploy-'));
  aufraeumen.push(ordner);

  const skript = path.join(ordner, 'probe.sh');

  writeFileSync(
    skript,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'log() { echo "$*"; }',
      '',
      funktionAusSkript(),
      '',
      `pruefe_besitzer "${pfad.replace(/\\/g, '/')}" 'Prüfzweck'`,
      '',
    ].join('\n'),
  );

  return execFileSync('bash', [skript], { encoding: 'utf8' });
}

describe('deploy.sh – Warnung zu den Ablageorten (Fundpunkt 177)', () => {
  it('warnt, wenn es den Ordner noch gar nicht gibt', () => {
    const ordner = mkdtempSync(path.join(tmpdir(), 'palantir-deploy-'));
    aufraeumen.push(ordner);

    const ausgabe = rufeAuf(path.join(ordner, 'gibt-es-nicht'));

    // Der Betreiber muss ohne Nachdenken wissen, was zu tun ist.
    expect(ausgabe).toContain('gibt es noch nicht');
    expect(ausgabe).toContain('mkdir -p');
    expect(ausgabe).toContain('chown 1000:1000');
  });

  it('schweigt, wenn der Ordner UID 1000 gehört', () => {
    const ordner = mkdtempSync(path.join(tmpdir(), 'palantir-deploy-'));
    aufraeumen.push(ordner);

    const besitzer = execFileSync('bash', ['-c', `stat -c '%u' '${ordner.replace(/\\/g, '/')}'`], {
      encoding: 'utf8',
    }).trim();

    const ausgabe = rufeAuf(ordner);

    if (besitzer === '1000') {
      expect(ausgabe.trim()).toBe('');
    } else {
      // Auf einem Läufer, dessen Benutzer nicht UID 1000 ist, ist die Warnung
      // der richtige Ausgang – und sie muss den gefundenen Besitzer nennen.
      expect(ausgabe).toContain(`gehoert UID ${besitzer}`);
      expect(ausgabe).toContain('chown -R 1000:1000');
    }
  });

  it('deckt alle drei Ablageorte ab, die in den Container eingehängt werden', () => {
    const skript = readFileSync(DEPLOY_SH, 'utf8');

    // Ein vierter Ablageort ohne Prüfung wäre derselbe Fehler noch einmal.
    for (const ort of ['data/audit-archive', 'data/panel-backups', 'data/fonts']) {
      expect(skript, ort).toContain(`pruefe_besitzer "\${REPO_DIR}/${ort}"`);
    }
  });
});
