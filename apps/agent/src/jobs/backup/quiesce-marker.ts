import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentRconAccess } from '@palantir/contracts';

/**
 * Merkzettel offener Schreibstopps (Arbeitspaket HM-10).
 *
 * Beim Sichern ohne Anhalten bittet der Agent den Server, kurz nicht zu
 * schreiben (`save-off`), und hebt das danach wieder auf (`save-on`). Das
 * `finally` im Sicherungsjob deckt jeden Ausgang ab, den der Prozess noch
 * erlebt – **nicht aber seinen eigenen Tod.** Wird der Agent-Container in genau
 * diesem Fenster erschlagen (Deployment, OOM, Absturz), bliebe der Spielserver
 * dauerhaft im Schreibstopp: Er läuft weiter, nimmt Spieler an und schreibt
 * nichts mehr auf die Platte. Beim nächsten Absturz ist alles seit der
 * Sicherung weg.
 *
 * Das ist der schlimmere Ausgang als eine misslungene Sicherung, und deshalb
 * gibt es dieses zweite Netz: Vor dem ersten Ruhigstell-Befehl landet ein
 * Merkzettel auf der Platte, nach dem letzten Gegenbefehl verschwindet er. Was
 * beim Start des Agents noch daliegt, ist ein Server, dessen Schreibstopp nie
 * aufgehoben wurde – die Gegenbefehle gehen dann sofort raus.
 *
 * **Der Merkzettel liegt im Ablageordner des Agents, nicht im Datenordner des
 * Servers.** Im Datenordner wäre er über den Datei-Manager sichtbar und
 * löschbar, und er wanderte in jede Sicherung.
 */

/** Was nötig ist, um einen Schreibstopp wieder aufzuheben. */
export interface OffenerSchreibstopp {
  readonly serverId: string;
  readonly containerId: string;
  /** Die Gegenbefehle aus `GameTypeDefinition.resumeCommands`. */
  readonly resumeCommands: readonly string[];
  /** Nur gesetzt, wenn die Konsole über RCON läuft. */
  readonly rcon?: AgentRconAccess;
  /** Wann der Schreibstopp begonnen hat (ISO-8601) – nur für die Meldung. */
  readonly seit: string;
}

/** Dateiendung der Merkzettel; alles andere im Ordner wird übergangen. */
const ENDUNG = '.json';

/**
 * Ordner und Zugriff auf die Merkzettel.
 *
 * Absichtlich ohne Zustand im Speicher: Der ganze Sinn ist, einen Neustart des
 * Prozesses zu überleben.
 */
export class QuiesceMarker {
  readonly #ordner: string;

  constructor(ordner: string) {
    this.#ordner = path.resolve(ordner);
  }

  /** Pfad des Merkzettels eines Servers. */
  #pfad(serverId: string): string {
    // Der Dateiname entsteht aus der Server-Id. Sie kommt aus dem Backend und
    // ist eine UUID; `path.basename` ist trotzdem da, damit aus einer Id mit
    // Schrägstrich kein Pfad wird.
    return path.join(this.#ordner, `${path.basename(serverId)}${ENDUNG}`);
  }

  /**
   * Hält fest, dass ein Server im Schreibstopp steht.
   *
   * Erst schreiben, dann den Befehl schicken – anders herum gäbe es ein Fenster,
   * in dem der Stopp gilt und niemand davon weiß.
   *
   * Geschrieben wird über einen Zwischennamen und ein Umbenennen, wie beim
   * Packen eines Archivs: Ein halb geschriebener Merkzettel wäre beim Start
   * nicht lesbar und damit so gut wie keiner.
   */
  async merken(eintrag: OffenerSchreibstopp): Promise<void> {
    await mkdir(this.#ordner, { recursive: true });

    const ziel = this.#pfad(eintrag.serverId);
    const zwischen = `${ziel}.teil`;

    await writeFile(zwischen, JSON.stringify(eintrag), 'utf8');
    await rename(zwischen, ziel);
  }

  /**
   * Nimmt den Merkzettel wieder weg.
   *
   * Ein fehlender Merkzettel ist kein Fehler: Der Aufrufer ruft das im
   * `finally`, und dort kann er auch dann landen, wenn das Merken selbst
   * gescheitert ist.
   */
  async vergessen(serverId: string): Promise<void> {
    await unlink(this.#pfad(serverId)).catch(() => undefined);
  }

  /**
   * Alle Merkzettel, die noch dastehen.
   *
   * Unlesbare Einträge werden übergangen und ihre Datei entfernt – ein
   * Merkzettel, den niemand deuten kann, hilft keinem Server, bleibt aber sonst
   * für immer liegen und meldet sich bei jedem Start.
   */
  async offene(): Promise<OffenerSchreibstopp[]> {
    let dateien: string[];

    try {
      dateien = await readdir(this.#ordner);
    } catch {
      // Kein Ordner heißt: Es gab noch nie einen Schreibstopp.
      return [];
    }

    const gefunden: OffenerSchreibstopp[] = [];

    for (const datei of dateien) {
      if (!datei.endsWith(ENDUNG)) continue;

      const pfad = path.join(this.#ordner, datei);

      try {
        const eintrag = JSON.parse(await readFile(pfad, 'utf8')) as OffenerSchreibstopp;

        if (
          typeof eintrag?.serverId === 'string' &&
          typeof eintrag?.containerId === 'string' &&
          Array.isArray(eintrag?.resumeCommands) &&
          eintrag.resumeCommands.length > 0
        ) {
          gefunden.push(eintrag);
          continue;
        }
      } catch {
        // Fällt unten mit dem unvollständigen Eintrag zusammen.
      }

      await unlink(pfad).catch(() => undefined);
    }

    return gefunden;
  }
}
