/**
 * Öffentliche Kennzahlen der Instanz (Mockup-Abgleich 2.1).
 *
 * Die Anmeldeseite zeigt sie am Fuß der Markenspalte – **vor** der Anmeldung.
 * Deshalb enthält dieser Vertrag bewusst nichts über Personen: keine Namen,
 * keine Nutzerzahl, keine Serverliste. Drei Zahlen, die zeigen, dass die
 * Instanz lebt.
 */
export interface PublicInstanceStatsDto {
  /** Verfügbare Spiel-Typen dieser Instanz. */
  gameTypes: number;
  /**
   * Tage seit Inbetriebnahme – gezählt ab dem ersten angelegten Konto.
   *
   * `null`, solange es kein Konto gibt: Dann fehlt der Bezugspunkt, und eine
   * Null wäre eine Behauptung statt einer Angabe.
   */
  daysInService: number | null;
  /** Gespielte Arcade-Partien insgesamt. */
  arcadeRounds: number;
}
