/**
 * Mitgliederverwaltung eines Servers (Lastenheft §3.3, `ServerMember` in
 * Pflichtenheft §6).
 *
 * **Festlegung dieser Sitzung (F3):** Pflichtenheft §6 nennt am `ServerMember`
 * nur das Feld `permissionLevel`, ohne die Stufen zu benennen; B2 hat sie
 * bewusst nicht vorweggenommen (WORK_STATUS „Gefundener Punkt" 12). Damit die
 * Mitgliederverwaltung im Frontend nicht mit erfundenen Freitext-Stufen
 * arbeitet, sind sie hier einmal zentral festgelegt. B3 berechnet aus ihnen die
 * Flags in `GameServerPermissions`; das Frontend liest ausschließlich diese
 * Flags und leitet nie selbst etwas aus der Stufe ab (Pflichtenheft §5.2).
 */

export const SERVER_MEMBER_LEVELS = ['viewer', 'operator', 'manager'] as const;

export type ServerMemberLevel = (typeof SERVER_MEMBER_LEVELS)[number];

export function isServerMemberLevel(value: string): value is ServerMemberLevel {
  return (SERVER_MEMBER_LEVELS as readonly string[]).includes(value);
}

/**
 * Ein Mitverwalter eines Servers.
 *
 * Der Besitzer selbst ist **kein** `ServerMember` – er steht als `ownerId` am
 * `GameServerDto`.
 */
export interface ServerMemberDto {
  userId: string;
  displayName: string;
  level: ServerMemberLevel;
  /** ISO-8601-Zeitstempel der Freigabe. */
  addedAt: string;
  /**
   * Darf der Aufrufer diese Zuordnung ändern oder entfernen?
   *
   * Älteres Einzel-Flag; bleibt, weil Oberfläche und Tests es lesen. Die
   * Rechte je Vorgang stehen seit dem Review 2026-09-16 (Befund 2.2) in
   * {@link ServerMemberDto.permissions} – dort steht auch das Warum.
   */
  canEdit: boolean;
  /**
   * Rechte des Aufrufers an dieser Zuordnung (Pflichtenheft §5.2).
   *
   * Optional, damit dieser Vertrag für sich stehen kann (Entwicklungsregeln
   * §3): Fehlt das Objekt, gilt `canEdit` für beide Vorgänge. Das Backend füllt
   * es immer.
   */
  permissions?: ServerMemberPermissions;
}

/**
 * Serverseitig berechnete Rechte an einer Mitglieds-Zuordnung (Pflichtenheft
 * §5.2, Review 2026-09-16 Befund 2.2).
 *
 * Bis dahin trug das DTO nur `canEdit`, und die Oberfläche leitete daraus
 * beide Vorgänge ab. Zwei Felder statt einem, weil die Entscheidung im Backend
 * liegen soll: Heute hängen beide an `canManageMembers`, morgen kann das
 * Entfernen des letzten Verwalters oder das Anheben über die eigene Stufe
 * gesondert verboten sein, ohne dass die Oberfläche etwas davon wissen muss.
 */
export interface ServerMemberPermissions {
  /** Stufe dieser Zuordnung ändern (`PUT /api/servers/:id/members`). */
  canChangeLevel: boolean;
  /** Zuordnung entfernen (`DELETE /api/servers/:id/members/:userId`). */
  canRemove: boolean;
}

// ---------------------------------------------------------------------------
// Rangvergleich (ergänzt in B3)
// ---------------------------------------------------------------------------
// Das Backend muss entscheiden können, ob eine Stufe für eine Aktion reicht
// („darf ein `operator` die Einstellungen ändern?"). Der Rang steht deshalb im
// Vertrag und nicht als zweite Liste im Backend.

export interface ServerMemberLevelDefinition {
  readonly label: string;
  readonly description: string;
  /** Rang für Vergleiche; höher schließt niedriger ein. */
  readonly rank: number;
}

export const SERVER_MEMBER_LEVEL_CATALOG = {
  /** Darf zusehen: Karte, Detailseite, Live-Werte, Konsolenausgabe. */
  viewer: {
    label: 'Zuschauer',
    description: 'Sieht den Server, seine Live-Werte und die Konsolenausgabe – ohne einzugreifen.',
    rank: 0,
  },
  /** Darf bedienen: starten, stoppen, neu starten, Konsolenbefehle absetzen. */
  operator: {
    label: 'Bediener',
    description: 'Startet, stoppt und startet den Server neu und darf Konsolenbefehle absetzen.',
    rank: 1,
  },
  /**
   * Darf verwalten: zusätzlich Einstellungen, Dateien, Backups und geplante
   * Aufgaben. Löschen und Mitgliederverwaltung bleiben beim Besitzer – ein
   * Mitglied soll sich nicht selbst zum Besitzer machen können.
   */
  manager: {
    label: 'Verwalter',
    description:
      'Verwaltet zusätzlich Einstellungen, Dateien, Backups und geplante Aufgaben. Löschen und Mitgliederverwaltung bleiben beim Besitzer.',
    rank: 2,
  },
} as const satisfies Record<ServerMemberLevel, ServerMemberLevelDefinition>;

export function rankForServerMemberLevel(level: ServerMemberLevel): number {
  return SERVER_MEMBER_LEVEL_CATALOG[level].rank;
}

/** `true`, wenn `level` mindestens so weit reicht wie `required`. */
export function serverMemberLevelAtLeast(
  level: ServerMemberLevel,
  required: ServerMemberLevel,
): boolean {
  return rankForServerMemberLevel(level) >= rankForServerMemberLevel(required);
}
