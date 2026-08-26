/**
 * Öffentlicher Port-Bereich der VPS (Lastenheft §3.7, Pflichtenheft §2.4).
 *
 * Der Game-Traffic-Proxy auf der VPS leitet öffentliche Ports auf die passende
 * interne Container-Adresse im Tunnel-Netz um. Welcher Port zu welchem Server
 * gehört, steht in der Datenbank und wird bei Erstellung und Löschung eines
 * Servers automatisch aktualisiert – die Zuordnung wird also nie von Hand
 * gepflegt.
 *
 * Der Admin verwaltet hier nur die **Bereiche**, aus denen vergeben werden
 * darf; die einzelne Zuordnung entsteht und verschwindet mit dem Server.
 *
 * Spiele mit Hostname-Routing (`supportsVirtualHostRouting`, initial Minecraft)
 * belegen keinen Port aus dem Pool – für sie läuft ein einziger öffentlicher
 * Port für alle Instanzen (Pflichtenheft §2.4).
 */

/**
 * Transportprotokoll eines öffentlichen Ports.
 *
 * Bewusst getrennt von `AgentPortProtocol` aus `agent-commands.ts`: Dort geht es
 * um die Portbindung im Container auf dem Homeserver, hier um den öffentlichen
 * Port auf der VPS. Die Werte stimmen überein, die Bedeutung nicht.
 */
export type PortProtocol = 'tcp' | 'udp';

export const PORT_PROTOCOLS = ['tcp', 'udp'] as const satisfies readonly PortProtocol[];

export function isPortProtocol(value: string): value is PortProtocol {
  return (PORT_PROTOCOLS as readonly string[]).includes(value);
}

/** Kleinster bzw. größter gültiger Port – gilt für jeden Bereich. */
export const MIN_PUBLIC_PORT = 1024;
export const MAX_PUBLIC_PORT = 65_535;

/** Serverseitig berechnetes `permissions`-Objekt eines Port-Bereichs (Pflichtenheft §5.2). */
export interface PortRangePermissions {
  canView: boolean;
  canEdit: boolean;
  /**
   * Bereich löschen. Immer `false`, solange noch Ports aus ihm vergeben sind –
   * sonst verlören laufende Server ihre Zuordnung.
   */
  canDelete: boolean;
}

/** Ein zusammenhängender Bereich öffentlicher Ports auf der VPS. */
export interface PortRangeDto {
  id: string;
  /** Bezeichnung für die Admin-Oberfläche, z. B. „Standardbereich". */
  label: string;
  /** Erster Port des Bereichs (einschließlich). */
  startPort: number;
  /** Letzter Port des Bereichs (einschließlich). */
  endPort: number;
  protocol: PortProtocol;
  /**
   * Node, für die dieser Bereich gilt; `null` = für alle Nodes.
   * Version 1 betreibt eine Node, das Feld bleibt dort `null`.
   */
  nodeId: string | null;
  /**
   * Deaktivierte Bereiche vergeben keine neuen Ports mehr. Bereits vergebene
   * Ports bleiben gültig – ein laufender Server verliert seine Adresse nicht,
   * nur weil ein Bereich stillgelegt wird.
   */
  enabled: boolean;
  /** Anzahl Ports im Bereich (`endPort - startPort + 1`). */
  totalPorts: number;
  allocatedPorts: number;
  availablePorts: number;
  /** ISO-8601-Zeitstempel. */
  createdAt: string;
  permissions: PortRangePermissions;
}

/** `permissions`-Objekt einer einzelnen Port-Zuordnung (Pflichtenheft §5.2). */
export interface PortAllocationPermissions {
  canView: boolean;
  /**
   * Zuordnung von Hand freigeben. Bewusst `false`, solange der zugehörige
   * Server existiert: Ports werden mit dem Server vergeben und mit ihm wieder
   * frei (Pflichtenheft §2.4). Wahr wird das Flag nur bei verwaisten Einträgen.
   */
  canRelease: boolean;
}

/** Zuordnung Port ↔ Zielserver (Pflichtenheft §2.4). */
export interface PortAllocationDto {
  id: string;
  port: number;
  protocol: PortProtocol;
  /** Bereich, aus dem der Port stammt. */
  rangeId: string;
  /** Zielserver; `null` bei einem verwaisten Eintrag (Server bereits entfernt). */
  serverId: string | null;
  /** Anzeigename des Zielservers; `null`, wenn nicht (mehr) ermittelbar. */
  serverName: string | null;
  /** ISO-8601-Zeitstempel. */
  allocatedAt: string;
  permissions: PortAllocationPermissions;
}

/** Gesamtübersicht des Port-Pools für die Admin-Oberfläche (F10). */
export interface PortPoolDto {
  totalPorts: number;
  allocatedPorts: number;
  availablePorts: number;
  ranges: PortRangeDto[];
}
