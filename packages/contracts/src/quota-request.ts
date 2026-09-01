/**
 * Kontingent-Anfragen (Mockup-Abgleich 12.3.1).
 *
 * Das Lastenheft kennt Kontingente, die ein Administrator **setzt** (§3.4). Der
 * Entwurf zeigt daneben einen Weg, mehr zu **beantragen**: Ein Nutzer stößt an
 * seine Grenze, begründet, was er braucht, und der Administrator entscheidet.
 * Genau das bildet dieser Vertrag ab – eine Erweiterung des Funktionsumfangs,
 * ausdrücklich vom Betreiber beauftragt.
 *
 * Bewusst nur **zwei** Größen: Arbeitsspeicher und gleichzeitige Server. Das
 * sind die Grenzen, an die man beim Anlegen und Starten tatsächlich stößt; CPU
 * und Plattenplatz hängen an denselben Servern und würden die Anfrage zu einem
 * Formular machen.
 */

/** Zustand einer Anfrage. Entschieden wird genau einmal. */
export type QuotaRequestStatus = 'pending' | 'approved' | 'rejected';

export const QUOTA_REQUEST_STATUSES: readonly QuotaRequestStatus[] = [
  'pending',
  'approved',
  'rejected',
] as const;

/** Was der Aufrufer mit dieser Anfrage tun darf (Pflichtenheft §5.2). */
export interface QuotaRequestPermissions {
  /** Genehmigen oder ablehnen – verlangt `user.manage` und einen offenen Antrag. */
  canDecide: boolean;
  /** Zurückziehen – nur der Antragsteller, und nur solange offen. */
  canWithdraw: boolean;
}

export interface QuotaRequestDto {
  id: string;
  /** Antragsteller. */
  userId: string;
  userDisplayName: string;
  /**
   * Gewünschter Arbeitsspeicher in MB; `null`, wenn die Anfrage ihn nicht
   * betrifft. Mindestens eines der beiden Wunschfelder ist gesetzt.
   */
  requestedRamMb: number | null;
  /** Gewünschte Zahl gleichzeitig laufender Server; `null`, wenn nicht Teil der Anfrage. */
  requestedMaxConcurrentServers: number | null;
  /** Begründung des Antragstellers – der Grund, warum ein Mensch entscheidet. */
  reason: string;
  status: QuotaRequestStatus;
  /**
   * Anmerkung der Entscheidung; `null`, solange offen oder ohne Anmerkung.
   *
   * Steht auch bei einer Genehmigung zur Verfügung – „nur für diesen Monat" ist
   * eine Auflage, keine Ablehnung.
   */
  decisionNote: string | null;
  /** Wer entschieden hat; `null`, solange offen. */
  decidedByDisplayName: string | null;
  /** ISO-8601 der Entscheidung; `null`, solange offen. */
  decidedAt: string | null;
  /** ISO-8601 der Antragstellung. */
  createdAt: string;
  permissions: QuotaRequestPermissions;
}
