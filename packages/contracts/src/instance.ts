/**
 * Öffentliche Kennzahlen der Instanz (Mockup-Abgleich 2.1).
 *
 * Die Anmeldeseite zeigt sie am Fuß der Markenspalte – **vor** der Anmeldung.
 * Deshalb enthält dieser Vertrag bewusst nichts über Personen: keine Namen,
 * keine Nutzerzahl, keine Serverliste. Drei Zahlen, die zeigen, dass die
 * Instanz lebt.
 */
export interface PublicInstanceStatsDto {
  /**
   * Nimmt die Instanz Selbstregistrierungen an? (Mockup-Abgleich 12.1.1.)
   *
   * Steht hier, weil die Anmeldeseite es **vor** der Anmeldung wissen muss:
   * Ein Registrierungsformular, das erst beim Abschicken sagt, dass gerade
   * niemand aufgenommen wird, ist eine vergeudete Eingabe. Optional, damit
   * ältere Konsumenten gültig bleiben; fehlt es, wird von „offen" ausgegangen –
   * so verhält sich die Instanz seit jeher.
   */
  selfRegistrationEnabled?: boolean;
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

/** Was der Aufrufer mit den Instanz-Einstellungen tun darf (Pflichtenheft §5.2). */
export interface InstanceSettingsPermissions {
  canEdit: boolean;
}

/**
 * Einstellungen der Instanz (Mockup-Abgleich 12.1.1).
 *
 * Bewusst ein eigenes DTO und keine Sammlung loser Schalter: Die Nutzerseite
 * der Administration zeigt sie als Karte, und jede weitere Einstellung des
 * Betriebs gehört später hierher – nicht in ein neues Feld irgendwo anders.
 */
export interface InstanceSettingsDto {
  /**
   * Dürfen sich neue Konten selbst registrieren?
   *
   * `false` heißt: `POST /auth/register` antwortet mit
   * `AUTH_REGISTRATION_DISABLED`. Bestehende Konten sind davon unberührt, und
   * ein Admin kann weiterhin Konten anlegen.
   */
  selfRegistrationEnabled: boolean;
  /** ISO-8601 der letzten Änderung; `null`, solange nie etwas geändert wurde. */
  updatedAt: string | null;
  permissions: InstanceSettingsPermissions;
}
