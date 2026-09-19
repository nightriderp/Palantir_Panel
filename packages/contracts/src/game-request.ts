/**
 * Spiel-Wünsche (Betreiber, 19.09.2026).
 *
 * Seit die Spielauswahl im Assistenten nur noch freigeschaltete Spiele zeigt,
 * fehlt dem Nutzer der Weg zu allem anderen: Was der Administrator nicht
 * freigegeben hat, steht nicht mehr grau daneben, sondern gar nicht mehr da.
 * Dieser Vertrag bildet die Gegenrichtung ab – ein Konto nennt ein Spiel, der
 * Administrator antwortet.
 *
 * Aufbau bewusst wie die Kontingent-Anfrage (`quota-request.ts`): dieselben
 * Zustände, derselbe Bescheid mit Anmerkung, höchstens eine offene Bitte je
 * Konto. Wer das eine kennt, kennt das andere. Unterschied ist der Inhalt: ein
 * **freier Text**, kein Verweis auf einen Spieltyp. Der Wunsch trifft oft ein
 * Spiel, das das Panel noch gar nicht kennt, und eine Kennung, die es nicht
 * gibt, wäre nicht zu tippen.
 */

/**
 * Zustand eines Wunsches. Entschieden wird genau einmal.
 *
 * Gleiche vier Zustände wie bei der Kontingent-Anfrage, damit Liste, Bescheid
 * und Beschriftungen dieselbe Sprache sprechen. `withdrawn` ist der Rückzug
 * durch den Antragsteller, kein Bescheid.
 */
export type GameRequestStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export const GAME_REQUEST_STATUSES: readonly GameRequestStatus[] = [
  'pending',
  'approved',
  'rejected',
  'withdrawn',
] as const;

export function isGameRequestStatus(value: string): value is GameRequestStatus {
  return (GAME_REQUEST_STATUSES as readonly string[]).includes(value);
}

/** Was der Abrufende mit diesem Wunsch tun darf (Pflichtenheft §5). */
export interface GameRequestPermissions {
  /** Bescheid erteilen – ein Konto mit `user.manage`. */
  canDecide: boolean;
  /** Zurückziehen – nur der Antragsteller, und nur solange offen. */
  canWithdraw: boolean;
}

export interface GameRequestDto {
  id: string;
  userId: string;
  userDisplayName: string;
  /**
   * Das gewünschte Spiel, wie der Antragsteller es geschrieben hat.
   *
   * Freier Text, keine Kennung aus der Spiele-Registry: Gewünscht wird gerade
   * das, was es noch nicht gibt.
   */
  game: string;
  /** Warum – freiwillig; ein Wunsch ist auch ohne Begründung einer. */
  reason: string | null;
  status: GameRequestStatus;
  /**
   * Anmerkung der Entscheidung; `null`, solange offen oder ohne Anmerkung.
   *
   * Trägt bei einer Zusage die Auflage („kommt mit dem nächsten Image") und bei
   * einer Absage den Grund – beides ist mehr wert als der bloße Zustand.
   */
  decisionNote: string | null;
  /** Wer entschieden hat; `null`, solange offen oder zurückgezogen. */
  decidedByDisplayName: string | null;
  /** ISO-8601 der Entscheidung; `null`, solange offen oder zurückgezogen. */
  decidedAt: string | null;
  /** ISO-8601 der Antragstellung. */
  createdAt: string;
  permissions: GameRequestPermissions;
}
