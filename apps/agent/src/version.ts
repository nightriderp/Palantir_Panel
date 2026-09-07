import { readFileSync } from 'node:fs';

/**
 * Ersatzwert, wenn die Paketdatei fehlt oder unbrauchbar ist.
 *
 * Bewusst kein Abbruch: Die Fassung ist reine Diagnose. Ein Agent, der wegen
 * einer fehlenden Zeile in `package.json` nicht startet, ließe die Container auf
 * der Node unbeaufsichtigt – ein „unbekannt" im `hello`-Frame ist das kleinere
 * Übel und im Backend sofort als Auffälligkeit erkennbar.
 */
const UNBEKANNT = 'unbekannt';

function fassungLesen(): string {
  try {
    const roh = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const manifest: unknown = JSON.parse(roh);

    if (
      typeof manifest === 'object' &&
      manifest !== null &&
      'version' in manifest &&
      typeof manifest.version === 'string' &&
      manifest.version.length > 0
    ) {
      return manifest.version;
    }
  } catch (fehler: unknown) {
    console.warn('[agent] package.json nicht lesbar – Fassung wird als "unbekannt" gemeldet', {
      fehler: fehler instanceof Error ? fehler.message : String(fehler),
    });

    return UNBEKANNT;
  }

  console.warn('[agent] package.json ohne brauchbares Feld "version" – Fassung "unbekannt"');

  return UNBEKANNT;
}

/**
 * Fassung des Agents – gelesen aus `apps/agent/package.json`, nicht abgeschrieben
 * (Audit W3-2, agent-conn-04).
 *
 * Der Wert wandert im `hello`-Frame zum Backend und dient dort allein der
 * Fehlersuche. Als Literal lief er auseinander: die Paketdatei stand längst auf
 * 0.6.0, gemeldet wurde weiter 0.1.0.
 *
 * `../package.json` stimmt in beiden Lagen, weil sowohl `src/` als auch das
 * gebaute `dist/` genau eine Ebene unter der Paketwurzel liegen – im Image
 * kopiert `apps/agent/Dockerfile` die Manifeste mit (`COPY --from=prod-deps`).
 *
 * Kein `import … with { type: 'json' }`: Die Datei liegt außerhalb des
 * `rootDir` aus `tsconfig.json`, `tsc` würde die Ausgabe sonst um eine Ebene
 * verschieben.
 */
export const AGENT_VERSION = fassungLesen();
