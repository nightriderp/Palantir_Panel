/**
 * Belegter Plattenplatz **je Server** (Fundpunkt 168, Lastenheft §3.3).
 *
 * Das Lastenheft verlangt „Warnungen bei knappen Ressourcen (Speicherplatz) auf
 * Server- und Node-Ebene". Die Node-Ebene misst `connection/node-stats.ts` über
 * `statfs`; auf Server-Ebene gab es bisher keine Messung, `diskUsedMb` war
 * dauerhaft `null` und die Warnung konnte nie auslösen.
 *
 * Gemessen wird der Datenordner des Servers: `AGENT_DATA_DIR/<serverId>`. Der
 * Baumdurchlauf selbst steht in `directory-size.ts` und ist derselbe, den auch
 * die Speicherübersicht benutzt.
 *
 * ---
 *
 * **Der Takt: Zwischenspeicher mit Frist, Messung im Hintergrund.**
 *
 * Der Ist-Zustand wird je Server im Takt des Backend-Zeitgebers abgetastet
 * (`SCHEDULER_INTERVAL_MS`, Vorgabe 60 s). Ein rekursiver Durchlauf über einen
 * Weltordner kostet einen `readdir` je Verzeichnis und ein `lstat` je Datei –
 * bei 10 000 Dateien also gut 10 000 Systemaufrufe, in der Größenordnung von
 * einigen zehn Millisekunden warm und einigen hundert Millisekunden kalt. Bei
 * einem Modpack mit 100 000 Dateien ist es das Zehnfache. Jede Minute je Server
 * wäre dafür zu oft: Plattenplatz wächst um Größenordnungen langsamer als CPU
 * und Arbeitsspeicher sich ändern – ein Weltordner füllt sich über Stunden, und
 * eine Warnung, die fünf Minuten später kommt, ist genauso rechtzeitig.
 *
 * Deshalb zwei Eigenschaften statt eines eigenen Zeitgebers:
 *
 *  1. **Frist** ({@link DEFAULT_DISK_USAGE_TTL_MS}, 5 Minuten). Ein Wert
 *     innerhalb der Frist wird ohne neuen Durchlauf herausgegeben. Bei 60 s
 *     Abtastung ist das ein Durchlauf statt fünf.
 *  2. **Antwort aus dem Zwischenspeicher, Messung im Hintergrund.**
 *     {@link ServerDiskUsage.usedMb} wartet **nie** auf das Dateisystem,
 *     sondern gibt den letzten bekannten Wert zurück und stößt die Messung nur
 *     an. Ein langsamer Ordner verzögert damit nicht die Abtastung der übrigen
 *     Server. Der Preis: Die erste Antwort nach dem Start des Agents ist `null`.
 *
 * Ein eigener Scheduler-Job wäre der dritte Weg gewesen. Dagegen sprach, dass
 * er auch dann liefe, wenn niemand die Werte abholt (kein Backend verbunden,
 * kein Server läuft), und dass er die Liste der Server selbst führen müsste –
 * die kennt der Aufrufer ohnehin.
 *
 * ---
 *
 * **Sicherheit.** Der Pfad wird ausschließlich aus `AGENT_DATA_DIR` und der vom
 * Backend vergebenen Server-Id gebildet, nie aus einer Angabe des Servers oder
 * des Nutzers. Die Id muss das UUID-Format haben (`serverIdFromDirectoryName`),
 * enthält also weder `/` noch `.` – ein `..` kommt gar nicht erst durch.
 * Zusätzlich prüft {@link resolveWithinDirectory} das Ergebnis gegen das
 * Datenverzeichnis, und der Baumdurchlauf folgt keiner symbolischen
 * Verknüpfung. Der Ordner ist damit nicht verlassbar.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { directorySize } from './directory-size.js';
import { resolveWithinDirectory, serverIdFromDirectoryName } from '../paths.js';

const BYTES_PER_MB = 1024 * 1024;

/**
 * Frist des Zwischenspeichers: 5 Minuten.
 *
 * Bewusst eine Konstante und keine Umgebungsvariable – sie ist eine
 * Kostenabwägung des Agents, keine Betriebseinstellung, und ein zweiter
 * Stellknopf neben `SCHEDULER_INTERVAL_MS` hilft dem Betreiber nicht.
 */
export const DEFAULT_DISK_USAGE_TTL_MS = 5 * 60 * 1000;

export interface ServerDiskUsageOptions {
  /** `AGENT_DATA_DIR` – die einzige erlaubte Wurzel. */
  readonly dataDir: string;
  /** Frist des Zwischenspeichers; ohne Angabe {@link DEFAULT_DISK_USAGE_TTL_MS}. */
  readonly ttlMs?: number;
  /** Zeitquelle; ohne Angabe die Systemzeit. */
  readonly now?: () => Date;
  /**
   * Messung eines Ordners. Ohne Angabe der Baumdurchlauf aus
   * `directory-size.ts` – injizierbar, damit die Tests des Taktes ohne
   * Dateisystem auskommen.
   */
  readonly measure?: (pfad: string) => Promise<number | null>;
}

/** Ein Eintrag des Zwischenspeichers. */
interface Eintrag {
  /** Zuletzt gemessener Wert in MB, `null` bei fehlgeschlagener Messung. */
  readonly usedMb: number | null;
  /** Zeitpunkt der Messung in Millisekunden. */
  readonly gemessenUm: number;
}

/**
 * Zwischenspeicher der Ordnergrößen je Server.
 *
 * Kein Job im Sinne des {@link JobScheduler}: Es gibt keinen eigenen Zeitgeber,
 * der Takt entsteht aus Frist und Abfrage.
 */
export class ServerDiskUsage {
  readonly #dataDir: string;
  readonly #ttlMs: number;
  readonly #now: () => Date;
  readonly #measure: (pfad: string) => Promise<number | null>;
  readonly #stand = new Map<string, Eintrag>();
  /** Laufende Messungen – verhindert, dass derselbe Ordner doppelt gelaufen wird. */
  readonly #laufend = new Map<string, Promise<number | null>>();

  constructor(options: ServerDiskUsageOptions) {
    this.#dataDir = path.resolve(options.dataDir);
    this.#ttlMs = options.ttlMs ?? DEFAULT_DISK_USAGE_TTL_MS;
    this.#now = options.now ?? (() => new Date());
    this.#measure = options.measure ?? messeOrdner;
  }

  /**
   * Belegung des Datenordners in MB – **ohne** auf das Dateisystem zu warten.
   *
   * Liefert den letzten bekannten Wert; ist er älter als die Frist oder gibt es
   * noch keinen, wird eine Messung angestoßen, deren Ergebnis erst der nächste
   * Aufruf sieht. `null` heißt „keine Angabe": entweder ist noch nichts
   * gemessen, oder die letzte Messung ist gescheitert (Ordner fehlt oder ist
   * nicht lesbar). Diese Methode wirft nie – ein Fehler beim Plattenplatz darf
   * die übrigen Messwerte nicht mitreißen.
   */
  usedMb(serverId: string): number | null {
    const bekannt = this.#stand.get(serverId.toLowerCase());

    if (bekannt === undefined || this.#abgelaufen(bekannt)) {
      // Bewusst ohne `await`: Der Aufrufer bekommt sofort eine Antwort. Fehler
      // sind in `measureNow` bereits abgefangen, es kann also nichts unbemerkt
      // liegen bleiben.
      void this.measureNow(serverId);
    }

    return bekannt?.usedMb ?? null;
  }

  /**
   * Misst jetzt und wartet auf das Ergebnis.
   *
   * Läuft für denselben Server bereits eine Messung, wird **keine zweite**
   * gestartet – die Zusage wartet auf die laufende. Dieselbe
   * Überlappungsfreiheit wie im {@link JobScheduler}.
   */
  async measureNow(serverId: string): Promise<number | null> {
    const id = serverId.toLowerCase();
    const laufend = this.#laufend.get(id);

    if (laufend !== undefined) {
      return laufend;
    }

    const durchgang = this.#messe(id).finally(() => {
      this.#laufend.delete(id);
    });

    this.#laufend.set(id, durchgang);

    return durchgang;
  }

  /** Vergisst den gespeicherten Stand – etwa, wenn ein Server gelöscht wurde. */
  forget(serverId: string): void {
    this.#stand.delete(serverId.toLowerCase());
  }

  /** Wartet auf alle laufenden Messungen. Nur für Tests und das Herunterfahren. */
  async settled(): Promise<void> {
    await Promise.all([...this.#laufend.values()]);
  }

  async #messe(id: string): Promise<number | null> {
    const pfad = this.#pfad(id);
    const usedMb = pfad === null ? null : await this.#measure(pfad);

    this.#stand.set(id, { usedMb, gemessenUm: this.#now().getTime() });

    return usedMb;
  }

  #abgelaufen(eintrag: Eintrag): boolean {
    return this.#now().getTime() - eintrag.gemessenUm >= this.#ttlMs;
  }

  /**
   * Datenordner eines Servers, oder `null`, wenn die Id keine ist.
   *
   * Zwei Schranken hintereinander: das UUID-Format der Id und die Prüfung des
   * Ergebnisses gegen `AGENT_DATA_DIR`. Die zweite ist nach der ersten
   * rechnerisch überflüssig – sie bleibt trotzdem stehen, damit eine spätere
   * Lockerung des Id-Formats nicht still den Ordner öffnet.
   */
  #pfad(id: string): string | null {
    const gepruefteId = serverIdFromDirectoryName(id);

    if (gepruefteId === null) {
      return null;
    }

    try {
      return resolveWithinDirectory(this.#dataDir, gepruefteId);
    } catch {
      return null;
    }
  }
}

/**
 * Baumgröße eines Ordners in MB; `null`, wenn er fehlt oder nicht lesbar ist.
 *
 * Der Datenordner selbst darf **keine** symbolische Verknüpfung sein: `readdir`
 * folgt ihr, und die Messung läge dann außerhalb von `AGENT_DATA_DIR`. Innerhalb
 * des Baums ist das schon durch `directorySize` ausgeschlossen; die Wurzel ist
 * der eine Fall, den nur der Aufrufer prüfen kann.
 */
async function messeOrdner(pfad: string): Promise<number | null> {
  try {
    if ((await fs.lstat(pfad)).isSymbolicLink()) {
      return null;
    }
  } catch {
    // Ordner fehlt – dasselbe Ergebnis wie eine gescheiterte Messung.
    return null;
  }

  const groesse = await directorySize(pfad);

  return groesse === null ? null : Math.round(groesse.sizeBytes / BYTES_PER_MB);
}
