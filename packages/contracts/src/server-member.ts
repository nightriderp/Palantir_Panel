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
  /** Darf der Aufrufer diese Zuordnung ändern oder entfernen? */
  canEdit: boolean;
}
