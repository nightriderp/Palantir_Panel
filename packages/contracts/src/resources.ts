/**
 * Ressourcen & Kapazität (Pflichtenheft §6 und §10, Lastenheft §3.4).
 *
 * Hier stehen die Datenstrukturen, die Backend (Arbeitspaket B4), Frontend
 * (Admin-Kontingente in F10, Node-Auslastung in F7) und die Notification-Engine
 * (B6, Konsument des Events `resource.low`) gemeinsam brauchen.
 *
 * Zwei Prüfungen greifen **immer beide** (Pflichtenheft §10):
 *
 * 1. das optionale Kontingent des Nutzers ({@link UserResourceLimits}) – jedes
 *    Feld ist einzeln abschaltbar, `null` bedeutet „kein Limit";
 * 2. die harte, globale Kapazität der Ziel-Node ({@link NodeResources} gegen
 *    {@link NodeResourceUsage}) – unabhängig davon, ob das Nutzer-Kontingent
 *    noch Luft hätte.
 *
 * Die Hardware-Rahmenwerte aus Lastenheft §5 (Ryzen 7 5800X, 32 GB RAM, 2 TB
 * nutzbar) stehen bewusst **nicht** in diesem Vertrag und nicht im Code,
 * sondern als Datensatz an der Entität `HostNode` – eine zweite Node hat andere
 * Werte.
 *
 * Änderungen sind bevorzugt additiv (neue optionale Felder).
 */

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

/**
 * Ressourcenarten, die Palantir bewirtschaftet.
 *
 * `servers` ist die Anzahl gleichzeitig laufender Server – nur im
 * Nutzer-Kontingent relevant, nicht auf Node-Ebene und nie Anlass für eine
 * Warnung (eine Node hat keine Obergrenze an Servern, nur an RAM/CPU/Platz).
 */
export type ResourceKind = 'ram' | 'cpu' | 'disk' | 'servers';

/** Einheit, in der eine {@link ResourceKind} gezählt wird. */
export type ResourceUnit = 'mb' | 'cores' | 'count';

/**
 * Einheit je Ressourcenart.
 *
 * Bewusst als Tabelle statt als Feld an jeder Struktur abgeleitet: die Zuordnung
 * ist fest und soll nicht an mehreren Stellen wiederholt werden. MiB und Kerne
 * folgen den Feldnamen aus Pflichtenheft §6 (`maxRamMb`, `maxCpuCores`).
 */
export const RESOURCE_UNITS = {
  ram: 'mb',
  cpu: 'cores',
  disk: 'mb',
  servers: 'count',
} as const satisfies Record<ResourceKind, ResourceUnit>;

export function unitForResource(resource: ResourceKind): ResourceUnit {
  return RESOURCE_UNITS[resource];
}

// ---------------------------------------------------------------------------
// Node (Entität `HostNode`, Pflichtenheft §6)
// ---------------------------------------------------------------------------

/**
 * Status einer Node.
 *
 * Pflichtenheft §6 nennt das Feld `status`, ohne die Werte festzulegen. Diese
 * Sitzung (B4) legt sie hier fest, weil die Kapazitätsprüfung sie auswerten
 * muss: nur eine Node im Zustand `online` nimmt neue Starts an.
 * `maintenance` unterscheidet eine bewusst stillgelegte Node von einer, die
 * unerwartet nicht antwortet – für den Betreiber ein wichtiger Unterschied.
 */
export const HOST_NODE_STATUSES = ['online', 'offline', 'maintenance'] as const;

export type HostNodeStatus = (typeof HOST_NODE_STATUSES)[number];

export function isHostNodeStatus(value: string): value is HostNodeStatus {
  return (HOST_NODE_STATUSES as readonly string[]).includes(value);
}

/**
 * Gesamt-Ressourcen einer Node (`HostNode.totalResources`, Pflichtenheft §6).
 *
 * Gemeint ist stets das, was der Gameserver-VM tatsächlich zur Verfügung steht –
 * nicht die Hardware des Blechs darunter (Lastenheft §5: von 2,5 TB sind 2 TB
 * für die VM nutzbar, der Rest gehört Proxmox).
 */
export interface NodeResources {
  ramMb: number;
  /** Nachkommastellen erlaubt (z. B. 7.5 von 8 Kernen). */
  cpuCores: number;
  diskMb: number;
}

/**
 * Belegung einer Node durch alle Server aller Nutzer.
 *
 * RAM und CPU zählen nur **laufende** Server, weil ein gestoppter Container
 * nichts davon belegt. Speicherplatz zählt **alle** Server: der Datenordner
 * bleibt auch im gestoppten Zustand liegen.
 */
export interface NodeResourceUsage {
  runningRamMb: number;
  runningCpuCores: number;
  allocatedDiskMb: number;
  runningServers: number;
  totalServers: number;
}

// ---------------------------------------------------------------------------
// Nutzer-Kontingent (Entität `UserResourceLimit`, Pflichtenheft §6)
// ---------------------------------------------------------------------------

/**
 * Optionales Kontingent eines Nutzers (Lastenheft §3.4, Pflichtenheft §10).
 *
 * Jedes Feld ist einzeln abschaltbar: `null` heißt „für diese Ressource gilt
 * kein Limit". Ein Nutzer ohne Datensatz verhält sich wie einer, bei dem alle
 * vier Felder `null` sind ({@link NO_USER_RESOURCE_LIMITS}) – die harte
 * Node-Prüfung greift trotzdem.
 */
export interface UserResourceLimits {
  maxRamMb: number | null;
  maxCpuCores: number | null;
  maxDiskMb: number | null;
  maxConcurrentServers: number | null;
}

/** Kontingent eines Nutzers ohne jede Beschränkung – der Standardfall. */
export const NO_USER_RESOURCE_LIMITS: UserResourceLimits = Object.freeze({
  maxRamMb: null,
  maxCpuCores: null,
  maxDiskMb: null,
  maxConcurrentServers: null,
});

/**
 * Belegung durch die Server eines einzelnen Nutzers.
 *
 * Gleiche Zählweise wie bei {@link NodeResourceUsage}: RAM/CPU nur laufend,
 * Speicherplatz über alle Server.
 */
export interface UserResourceUsage {
  runningRamMb: number;
  runningCpuCores: number;
  allocatedDiskMb: number;
  runningServers: number;
  totalServers: number;
}

/** Was der aufrufende Nutzer mit diesem Kontingent tun darf (Pflichtenheft §5.2). */
export interface UserResourceLimitPermissions {
  canView: boolean;
  /** Kontingent setzen, ändern oder aufheben – erfordert `user.manage`. */
  canEdit: boolean;
}

/**
 * Kontingent-DTO (Pflichtenheft §5.2).
 *
 * Enthält neben dem Kontingent selbst immer auch die aktuelle Belegung, damit
 * die Admin-Oberfläche (F10) beim Setzen eines Limits sofort sieht, ob der
 * Nutzer bereits darüber liegt – ohne einen zweiten Endpunkt abzufragen.
 */
export interface UserResourceLimitDto {
  userId: string;
  /** Anzeigename des Nutzers; `null`, wenn für den Aufrufer nicht sichtbar. */
  userDisplayName: string | null;
  limits: UserResourceLimits;
  usage: UserResourceUsage;
  /** ISO-8601-Zeitstempel der letzten Änderung; `null`, solange kein Limit gesetzt wurde. */
  updatedAt: string | null;
  permissions: UserResourceLimitPermissions;
}

// ---------------------------------------------------------------------------
// Kapazitätsprüfung (Pflichtenheft §10)
// ---------------------------------------------------------------------------

/** Welche der beiden Prüfungen aus Pflichtenheft §10 angeschlagen hat. */
export type CapacityScope = 'user' | 'node';

/**
 * Angeforderte Ressourcen eines Serverstarts.
 *
 * Entspricht `GameServer.resourceLimits` (`ServerResourceLimits`) – bewusst als
 * eigener Typ, weil die Prüfung auch für einen noch nicht angelegten Server
 * (Erstellungs-Wizard in F3) läuft.
 */
export interface RequestedServerResources {
  ramMb: number;
  cpuCores: number;
  diskMb: number;
}

/**
 * Eine überschrittene Grenze.
 *
 * `used` ist die Belegung **ohne** den zu prüfenden Server, `requested` das, was
 * zusätzlich dazukäme. Überschritten ist die Grenze, sobald
 * `used + requested > limit` – Gleichstand ist erlaubt.
 */
export interface CapacityViolation {
  scope: CapacityScope;
  resource: ResourceKind;
  unit: ResourceUnit;
  limit: number;
  used: number;
  requested: number;
}

/**
 * Nutzdaten des Events `resource.low` (Pflichtenheft §10 und §14).
 *
 * Konsument ist die Notification-Engine (B6). Das Event meldet keinen Vorgang,
 * sondern einen erreichten Schwellwert – daher die Zustandsform `low` im Namen
 * (Begründung im Benennungsschema in `events.ts`).
 */
export interface ResourceLowEvent {
  /** `node`: Auslastung der Ziel-VM. `server`: ein einzelner Server nahe an seinem eigenen Limit. */
  scope: 'node' | 'server';
  /** `servers` kommt hier nie vor – eine Anzahl ist keine knapp werdende Ressource. */
  resource: 'ram' | 'cpu' | 'disk';
  unit: ResourceUnit;
  nodeId: string;
  /** Nur bei `scope: 'server'` gesetzt. */
  serverId: string | null;
  used: number;
  total: number;
  /** Belegung in Prozent (0–100), auf eine Nachkommastelle gerundet. */
  usedPercent: number;
  /** Schwellwert, ab dem gewarnt wird (aus der Konfiguration, siehe `.env.example` §13). */
  thresholdPercent: number;
  /** ISO-8601-Zeitstempel der Auswertung. */
  at: string;
}

/**
 * Ergebnis einer Kapazitätsprüfung.
 *
 * `allowed` ist genau dann `true`, wenn `violations` leer ist. Warnungen sind
 * davon unabhängig: ein Start darf erlaubt sein und die Node trotzdem über den
 * Schwellwert heben – dann steht hier eine {@link ResourceLowEvent}-Nutzlast,
 * die der Aufrufer an die Notification-Engine weitergibt.
 */
export interface CapacityCheckResult {
  allowed: boolean;
  violations: CapacityViolation[];
  warnings: ResourceLowEvent[];
}

/**
 * Schwellwerte für die Ressourcen-Warnungen (Pflichtenheft §10).
 *
 * Konfigurierbar über `RESOURCE_WARN_NODE_PERCENT` und
 * `RESOURCE_WARN_SERVER_PERCENT` in der zentralen `.env` (Pflichtenheft §12.1).
 */
export interface ResourceWarningThresholds {
  /** Auslastung der Node in Prozent, ab der gewarnt wird. */
  nodePercent: number;
  /** Auslastung eines einzelnen Servers gegen sein eigenes Limit, ab der gewarnt wird. */
  serverPercent: number;
}
