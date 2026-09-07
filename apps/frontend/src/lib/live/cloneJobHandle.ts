import { type ServerCloneJobDto } from '@palantir/contracts';

/**
 * Merkzettel für den zuletzt bekannten Klon-Auftrag (Fundpunkt event-flow-06).
 *
 * Das Klonen mit Weltdaten läuft Minuten. Der Fortschritt kam bisher
 * ausschließlich aus zwei flüchtigen Quellen: der 202-Antwort im lokalen
 * Zustand des Reiters „Einstellungen" und dem Live-Ereignis
 * `serverClone.progressed` im `useServerLive`. Beide sind weg, sobald die
 * Detailseite verlassen und neu betreten wird – und ohne die Auftrags-Id gibt
 * es auch keinen Weg zurück: `GET /api/servers/:id/clone/:jobId` braucht sie,
 * und einen „laufende Aufträge dieses Servers"-Endpunkt gibt es nicht (siehe
 * Bericht: Bedarf an einem Contract).
 *
 * Deshalb liegt der letzte bekannte Stand hier im `sessionStorage`: Er
 * überlebt das Neuladen der Seite und den Wechsel zwischen Reitern, ist aber
 * mit dem Browser-Tab wieder weg – genau die Lebensdauer, die ein laufender
 * Auftrag hat. Abgeschlossene Aufträge werden bewusst vergessen.
 *
 * Der gemerkte Stand ist **nur ein Anhaltspunkt**: Er wird beim Öffnen des
 * Reiters gegen das Backend geprüft und ersetzt. Er ersetzt keine Wahrheit,
 * sondern erspart die leere Anzeige, bis die Antwort da ist.
 */

const SCHLUESSEL_PRAEFIX = 'palantir.cloneJob.';

/**
 * Ersatzablage, wenn der Browser `sessionStorage` verweigert.
 *
 * Im privaten Modus mancher Browser wirft schon der Zugriff. Dann bleibt der
 * Stand wenigstens innerhalb dieses Seitenaufbaus erhalten.
 */
const imArbeitsspeicher = new Map<string, ServerCloneJobDto>();

function ablage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function schluessel(serverId: string): string {
  return `${SCHLUESSEL_PRAEFIX}${serverId}`;
}

/** Grobprüfung: Ist das gelesene JSON überhaupt ein Klon-Auftrag? */
function istKlonAuftrag(wert: unknown): wert is ServerCloneJobDto {
  if (typeof wert !== 'object' || wert === null) return false;

  const kandidat = wert as Partial<ServerCloneJobDto>;

  return (
    typeof kandidat.id === 'string' &&
    typeof kandidat.serverId === 'string' &&
    typeof kandidat.status === 'string' &&
    typeof kandidat.targetName === 'string' &&
    typeof kandidat.progressPercent === 'number'
  );
}

/** Laufenden Auftrag merken; abgeschlossene werden stattdessen vergessen. */
export function rememberCloneJob(job: ServerCloneJobDto): void {
  if (job.finishedAt !== null) {
    forgetCloneJob(job.serverId);

    return;
  }

  imArbeitsspeicher.set(job.serverId, job);

  try {
    ablage()?.setItem(schluessel(job.serverId), JSON.stringify(job));
  } catch {
    // Voller oder gesperrter Speicher: Der Merkzettel ist eine Bequemlichkeit,
    // kein Datenspeicher – der Arbeitsspeicher-Eintrag oben genügt.
  }
}

/** Zuletzt gemerkter Auftrag dieses Servers; `null`, wenn keiner bekannt ist. */
export function rememberedCloneJob(serverId: string): ServerCloneJobDto | null {
  const roh = (() => {
    try {
      return ablage()?.getItem(schluessel(serverId)) ?? null;
    } catch {
      return null;
    }
  })();

  if (roh === null) return imArbeitsspeicher.get(serverId) ?? null;

  try {
    const gelesen: unknown = JSON.parse(roh);

    return istKlonAuftrag(gelesen) ? gelesen : null;
  } catch {
    return null;
  }
}

export function forgetCloneJob(serverId: string): void {
  imArbeitsspeicher.delete(serverId);

  try {
    ablage()?.removeItem(schluessel(serverId));
  } catch {
    // Siehe oben.
  }
}
