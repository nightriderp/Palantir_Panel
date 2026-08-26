/**
 * HostNode-DTO (Pflichtenheft §5.2 und §6, Lastenheft §3.7).
 *
 * Eine Node ist ein Homeserver, auf dem Gameserver-Container laufen. Version 1
 * betreibt genau eine Node; das Datenmodell ist bewusst für mehrere vorbereitet
 * (Lastenheft §6).
 *
 * **Ergänzungen gegenüber Pflichtenheft §6:** Dort stehen nur `id`,
 * `wireguardIp`, `totalResources` und `status`. Zusätzlich stehen hier `name`
 * (die Serverliste zeigt laut `GameServerDto.hostName` einen Anzeigenamen),
 * `statusMessage`, `lastSeenAt` und `createdAt` sowie die abgeleiteten Felder
 * `capacity` und `usage` – ohne sie wäre die geforderte Übersicht „inkl.
 * Auslastung und Kapazität" (Lastenheft §3.7) nicht darstellbar. Alle
 * Ergänzungen sind additiv.
 */

/**
 * Betriebszustand einer Node.
 *
 * `online` setzt eine bestehende Agent-Verbindung voraus (Pflichtenheft §2.2);
 * `degraded` meldet der Agent, wenn er erreichbar ist, die Container-Engine
 * aber nicht. `maintenance` setzt ein Admin von Hand – auf einer Node in
 * Wartung werden keine neuen Server platziert.
 */
export type HostNodeStatus = 'online' | 'offline' | 'degraded' | 'maintenance';

export const HOST_NODE_STATUSES = [
  'online',
  'offline',
  'degraded',
  'maintenance',
] as const satisfies readonly HostNodeStatus[];

export function isHostNodeStatus(value: string): value is HostNodeStatus {
  return (HOST_NODE_STATUSES as readonly string[]).includes(value);
}

/**
 * Ressourcenmenge einer Node (Pflichtenheft §6, `HostNode.totalResources`).
 *
 * Einheiten wie bei `ServerResourceLimits`, damit beide Seiten derselben
 * Kapazitätsrechnung dieselbe Skala nutzen (Pflichtenheft §10).
 */
export interface NodeResources {
  ramMb: number;
  cpuCores: number;
  diskMb: number;
}

/**
 * Kapazität einer Node (Lastenheft §3.7).
 *
 * `allocated` ist die Summe der Ressourcen-Limits aller auf dieser Node
 * angelegten Server – also der reservierte, nicht der tatsächlich genutzte
 * Anteil. `available` ist `total - allocated`, nie kleiner als 0.
 *
 * Die harte Prüfung vor jedem Serverstart (Pflichtenheft §10) arbeitet
 * zusätzlich mit {@link HostNodeUsage}, also den echten Messwerten.
 */
export interface HostNodeCapacity {
  total: NodeResources;
  allocated: NodeResources;
  available: NodeResources;
}

/**
 * Tatsächliche Auslastung einer Node (Lastenheft §3.7).
 *
 * `null`-Felder bedeuten „aktuell kein Messwert" – etwa direkt nach einem
 * Neustart des Agents oder solange die Node offline ist.
 */
export interface HostNodeUsage {
  cpuPercent: number | null;
  ramUsedMb: number | null;
  diskUsedMb: number | null;
  /** ISO-8601-Zeitstempel der Messung. */
  sampledAt: string;
}

/**
 * Serverseitig berechnetes `permissions`-Objekt einer Node (Pflichtenheft §5.2).
 *
 * `canView` folgt `node.view` **oder** `node.manage`: wer verwaltet, muss sehen
 * können. `canManageStorage` hängt an `node.manage`, weil der Storage-Explorer
 * laut Permission-Katalog Teil der Node-Verwaltung ist.
 */
export interface HostNodePermissions {
  canView: boolean;
  /** Node anlegen, bearbeiten, in Wartung nehmen oder entfernen. */
  canManage: boolean;
  /** Speicherverwaltung dieser Node öffnen (Storage-Explorer, Pflichtenheft §16). */
  canManageStorage: boolean;
}

/** Node (Pflichtenheft §6, Entität `HostNode`). */
export interface HostNodeDto {
  id: string;
  /** Anzeigename, z. B. „Homeserver". */
  name: string;
  /** Feste interne Adresse im Tunnel-Netz (Pflichtenheft §2.1). */
  wireguardIp: string;
  status: HostNodeStatus;
  /** Erläuterung zum Status, z. B. Grund einer Wartung; `null`, wenn nichts vorliegt. */
  statusMessage: string | null;
  capacity: HostNodeCapacity;
  /** Letzte bekannte Auslastung; `null`, solange keine Messung vorliegt. */
  usage: HostNodeUsage | null;
  /** Anzahl der auf dieser Node angelegten Gameserver. */
  serverCount: number;
  /** Letzter Kontakt des Agents als ISO-8601; `null`, wenn nie verbunden. */
  lastSeenAt: string | null;
  /** ISO-8601-Zeitstempel. */
  createdAt: string;
  permissions: HostNodePermissions;
}
