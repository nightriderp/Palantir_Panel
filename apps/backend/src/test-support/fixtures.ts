/**
 * Testdaten für die datenbankgestützten Tests (Audit-Maßnahme W2-28).
 *
 * Bewusst schmal: Jede Funktion schreibt genau eine Zeile mit den Pflichtfeldern
 * und gibt die erzeugte Id zurück. Die Tests setzen darauf ihre eigenen,
 * fachlichen Ausgangslagen zusammen – dieselben Bausteine in mehreren Dateien,
 * damit nicht jede Datei ihr eigenes `insert` mit eigenen Vorgabewerten pflegt.
 *
 * Eindeutige Werte (Benutzername, Node-Name, WireGuard-Adresse, Subdomain)
 * kommen aus einem Zähler je Prozess. Sie müssen nur innerhalb einer
 * Wegwerf-Datenbank eindeutig sein, und die gehört genau einer Testdatei.
 */

import type {
  HostNodeStatus,
  ServerMemberLevel,
  ServerResourceLimits,
  ServerStatus,
} from '@palantir/contracts';
import type { Database } from '../db/client.js';
import {
  authMethods,
  gameServers,
  hostNodes,
  roles,
  serverMembers,
  userResourceLimits,
  userRoles,
  users,
} from '../db/schema.js';

let zaehler = 0;

/** Fortlaufende Nummer für Werte, die eindeutig sein müssen. */
export function naechsteNummer(): number {
  zaehler += 1;

  return zaehler;
}

export interface NutzerVorgabe {
  readonly username?: string | null;
  readonly displayName?: string;
  readonly isOwner?: boolean;
  readonly banned?: boolean;
}

/** Legt ein Konto an und gibt dessen Id zurück. */
export async function legeNutzerAn(db: Database, vorgabe: NutzerVorgabe = {}): Promise<string> {
  const nummer = naechsteNummer();
  const [zeile] = await db
    .insert(users)
    .values({
      username: vorgabe.username === undefined ? `nutzer${String(nummer)}` : vorgabe.username,
      displayName: vorgabe.displayName ?? `Nutzer ${String(nummer)}`,
      isOwner: vorgabe.isOwner ?? false,
      banned: vorgabe.banned ?? false,
    })
    .returning({ id: users.id });

  if (zeile === undefined) {
    throw new Error('Konto konnte nicht angelegt werden.');
  }

  return zeile.id;
}

export interface NodeVorgabe {
  readonly status?: HostNodeStatus;
  readonly totalRamMb?: number;
  readonly totalCpuCores?: number;
  readonly totalDiskMb?: number;
}

/** Legt eine Homeserver-Node an und gibt deren Id zurück. */
export async function legeNodeAn(db: Database, vorgabe: NodeVorgabe = {}): Promise<string> {
  const nummer = naechsteNummer();
  const [zeile] = await db
    .insert(hostNodes)
    .values({
      name: `node${String(nummer)}`,
      // 10.10.0.x reicht für die Tests; eindeutig muss die Adresse sein, erreichbar nicht.
      wireguardIp: `10.10.${String(Math.floor(nummer / 250))}.${String((nummer % 250) + 2)}`,
      status: vorgabe.status ?? 'online',
      totalRamMb: vorgabe.totalRamMb ?? 32_768,
      totalCpuCores: vorgabe.totalCpuCores ?? 8,
      totalDiskMb: vorgabe.totalDiskMb ?? 1_000_000,
    })
    .returning({ id: hostNodes.id });

  if (zeile === undefined) {
    throw new Error('Node konnte nicht angelegt werden.');
  }

  return zeile.id;
}

export interface ServerVorgabe {
  readonly ownerId: string;
  readonly hostId: string;
  readonly name?: string;
  readonly status?: ServerStatus;
  readonly subdomain?: string;
  readonly resourceLimits?: ServerResourceLimits;
  readonly gameType?: string;
}

/** Legt einen Gameserver an und gibt dessen Id zurück. */
export async function legeServerAn(db: Database, vorgabe: ServerVorgabe): Promise<string> {
  const nummer = naechsteNummer();
  const [zeile] = await db
    .insert(gameServers)
    .values({
      ownerId: vorgabe.ownerId,
      hostId: vorgabe.hostId,
      name: vorgabe.name ?? `Server ${String(nummer)}`,
      gameType: vorgabe.gameType ?? 'minecraft',
      status: vorgabe.status ?? 'stopped',
      subdomain: vorgabe.subdomain ?? `server${String(nummer)}`,
      resourceLimits: vorgabe.resourceLimits ?? { ramMb: 2048, cpuCores: 1, diskMb: 10_240 },
      configJson: {},
      autoShutdown: { enabled: false, idleTimeoutMinutes: 30, graceMinutes: 10 },
    })
    .returning({ id: gameServers.id });

  if (zeile === undefined) {
    throw new Error('Server konnte nicht angelegt werden.');
  }

  return zeile.id;
}

/** Trägt ein Mitglied auf einem Server ein. */
export async function legeMitgliedAn(
  db: Database,
  serverId: string,
  userId: string,
  level: ServerMemberLevel = 'viewer',
): Promise<void> {
  await db.insert(serverMembers).values({ serverId, userId, permissionLevel: level });
}

/** Legt eine Rolle an und gibt deren Id zurück. */
export async function legeRolleAn(db: Database, name: string): Promise<string> {
  const [zeile] = await db
    .insert(roles)
    .values({ name, permissions: [] })
    .returning({ id: roles.id });

  if (zeile === undefined) {
    throw new Error('Rolle konnte nicht angelegt werden.');
  }

  return zeile.id;
}

/** Weist einem Konto eine Rolle zu. */
export async function weiseRolleZu(db: Database, userId: string, roleId: string): Promise<void> {
  await db.insert(userRoles).values({ userId, roleId });
}

/** Setzt das Ressourcen-Kontingent eines Kontos. */
export async function setzeKontingent(
  db: Database,
  userId: string,
  grenzen: {
    readonly maxRamMb?: number | null;
    readonly maxCpuCores?: number | null;
    readonly maxDiskMb?: number | null;
    readonly maxConcurrentServers?: number | null;
  },
): Promise<void> {
  await db.insert(userResourceLimits).values({
    userId,
    maxRamMb: grenzen.maxRamMb ?? null,
    maxCpuCores: grenzen.maxCpuCores ?? null,
    maxDiskMb: grenzen.maxDiskMb ?? null,
    maxConcurrentServers: grenzen.maxConcurrentServers ?? null,
  });
}

/** Legt eine Passwort-Login-Methode an und gibt deren Id zurück. */
export async function legePasswortMethodeAn(
  db: Database,
  userId: string,
  passwordHash = '$argon2id$attrappe',
): Promise<string> {
  const [zeile] = await db
    .insert(authMethods)
    .values({ userId, type: 'password', passwordHash })
    .returning({ id: authMethods.id });

  if (zeile === undefined) {
    throw new Error('Login-Methode konnte nicht angelegt werden.');
  }

  return zeile.id;
}
