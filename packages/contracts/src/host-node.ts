/**
 * HostNode-DTO (Pflichtenheft §5.2 und §6, Lastenheft §3.7).
 *
 * Eine Node ist ein Homeserver, auf dem Gameserver-Container laufen. Version 1
 * betreibt genau eine Node; das Datenmodell ist bewusst für mehrere vorbereitet
 * (Lastenheft §6).
 *
 * **Abgrenzung zu `resources.ts` (B4):** Dort stehen `HostNodeStatus`,
 * `NodeResources` und `NodeResourceUsage` – die Bausteine, die die harte
 * Kapazitätsprüfung aus Pflichtenheft §10 braucht. Diese Datei nutzt sie und
 * legt darüber die **Verwaltungssicht** aus Lastenheft §3.7: der vollständige
 * DTO mit `permissions`, Kapazität und Auslastung. Keine zweite Definition der
 * Bausteine (CLAUDE.md §3).
 *
 * **Ergänzungen gegenüber Pflichtenheft §6:** Dort stehen nur `id`,
 * `wireguardIp`, `totalResources` und `status`. Zusätzlich stehen hier `name`
 * (die Serverliste zeigt laut `GameServerDto.hostName` einen Anzeigenamen),
 * `statusMessage`, `lastSeenAt` und `createdAt` sowie die abgeleiteten Felder
 * `capacity` und `usage` – ohne sie wäre die geforderte Übersicht „inkl.
 * Auslastung und Kapazität" (Lastenheft §3.7) nicht darstellbar. Alle
 * Ergänzungen sind additiv.
 */

import { type HostNodeStatus, type NodeResources } from './resources.js';

/**
 * Kapazität einer Node (Lastenheft §3.7).
 *
 * `allocated` ist die Summe der Ressourcen-Limits aller auf dieser Node
 * angelegten Server – also der reservierte, nicht der tatsächlich genutzte
 * Anteil. `available` ist `total - allocated`, nie kleiner als 0.
 *
 * Gefüllt wird `allocated` aus der Belegung, die B4 als `NodeResourceUsage`
 * berechnet – dieselbe Zahl, hier nur in der Form der Übersicht.
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
