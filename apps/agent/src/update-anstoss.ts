import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Name der Markierungsdatei im Anstoß-Ordner.
 *
 * Fest, nicht aus dem Befehl: Das Backend bestimmt nur, **dass** geklingelt
 * wird, nie wohin geschrieben wird. Auf denselben Namen wartet
 * `deploy/gamenode/palantir-update.path`.
 */
export const ANSTOSS_DATEI = 'anstoss';

/** Vollständiger Commit, wie ihn auch das Validierungsschema verlangt. */
const COMMIT = /^[0-9a-f]{40}$/;

/**
 * Klingel für die Selbstaktualisierung der Node (Gefundener Punkt 342).
 *
 * Der Agent legt auf `UPDATE_AVAILABLE` hin **nur** eine Datei in einem Ordner
 * ab, den er mit dem Host teilt. Mehr tut er nicht: Er startet nichts, holt
 * nichts und kennt `update.sh` nicht. Auf dem Host wartet eine systemd-Pfad-Unit
 * auf die Datei und startet den Update-Dienst, der die Signatur des
 * Versions-Tags prüft wie zuvor.
 *
 * Geschrieben wird über eine Zwischendatei mit anschließendem `rename`: Die
 * Pfad-Unit reagiert, sobald der Name auftaucht, und `update.sh` liest den
 * Inhalt sofort. Eine halb geschriebene Datei gäbe es so nie zu sehen.
 */
export class UpdateAnstoss {
  constructor(private readonly ordner: string) {}

  /**
   * Legt die Markierung ab. Eine schon liegende wird ersetzt - zwei Anstöße
   * hintereinander bedeuten dasselbe wie einer.
   */
  async ablegen(targetCommit: string): Promise<void> {
    // Das Schema hat die Form schon geprüft; hier noch einmal, weil der Wert
    // gleich in einer Datei steht, die ein Skript als root liest.
    if (!COMMIT.test(targetCommit)) {
      throw new Error('targetCommit ist kein vollständiger Commit.');
    }

    const ziel = path.join(this.ordner, ANSTOSS_DATEI);
    const zwischen = path.join(this.ordner, `.${ANSTOSS_DATEI}.tmp`);

    await writeFile(zwischen, `${targetCommit}\n`, { mode: 0o600 });
    await rename(zwischen, ziel);
  }
}
