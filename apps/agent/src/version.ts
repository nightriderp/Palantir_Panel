import { readFileSync } from 'node:fs';
import { fehlerFeld, log } from './log.js';

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
    log.warn(
      fehlerFeld(fehler),
      'package.json nicht lesbar – Fassung wird als "unbekannt" gemeldet',
    );

    return UNBEKANNT;
  }

  log.warn('package.json ohne brauchbares Feld "version" – Fassung "unbekannt"');

  return UNBEKANNT;
}

/** Stellen des Commits in der gemeldeten Fassung – wie `git log --oneline`, nur etwas länger. */
const STAND_STELLEN = 12;

/**
 * Paketfassung und ausgerollter Commit zu einer Zeichenkette (Fundpunkt 318).
 *
 * Das `+` ist kein Zierrat, sondern SemVer: Was dahinter steht, sind
 * Baumetadaten und bleibt beim Vergleich zweier Fassungen außen vor. Ein
 * Backend, das `0.6.0` erwartet, liest weiter `0.6.0` – deshalb ist das hier
 * eine additive Änderung ohne Vertragsanpassung.
 *
 * Ohne brauchbaren Wert bleibt es bei der Paketfassung. Geprüft wird die Form,
 * nicht der Inhalt: Ein Container, dem jemand `AGENT_COMMIT=beliebiger text`
 * mitgibt, soll die Fassung nicht mit Freitext verlängern.
 */
export function fassungMitStand(paketFassung: string, commit: string | undefined): string {
  const stand = (commit ?? '').trim().toLowerCase();

  if (!/^[0-9a-f]{7,40}$/.test(stand)) {
    return paketFassung;
  }

  return `${paketFassung}+${stand.slice(0, STAND_STELLEN)}`;
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
 *
 * **Mit dem ausgerollten Stand** (Fundpunkt 318): Die Paketfassung allein sagt
 * nichts über das Release – sie steht seit jeher auf 0.6.0 und ändert sich mit
 * keinem Ausrollen. Wer von außen wissen wollte, ob eine Node nachgezogen hat,
 * musste sich auf ihr anmelden und ins Journal sehen; die Node nimmt aber
 * bewusst keine eingehenden Verbindungen an (Fundpunkt 85). Deshalb hängt
 * `update.sh` den ausgecheckten Commit als `AGENT_COMMIT` an den Container, und
 * er wandert hier als SemVer-Baumetadaten an die Fassung: `0.6.0+dce821c77236`.
 */
export const AGENT_VERSION = fassungMitStand(fassungLesen(), process.env.AGENT_COMMIT);
