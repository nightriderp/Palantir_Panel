/**
 * Datenbankzugriff des Discord-Bots (Pflichtenheft §14a.4, §14a.10).
 *
 * Zwei Teile: die eigene Zuordnungstabelle ({@link createDrizzleDiscordSyncStore})
 * und das Einlesen des Panel-Stands für den Abgleich
 * ({@link loadPanelAccounts}). Letzteres liest Konten, Rollen und
 * Discord-Anmeldungen in zwei Abfragen statt je Konto einzeln – der Abgleich
 * läuft alle paar Minuten, und die Instanz soll dabei nicht spürbar arbeiten.
 */

import type { Permission } from '@palantir/contracts';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  authMethods,
  discordOwnerCategories,
  discordServerChannels,
  roles,
  userRoles,
  users,
} from '../../db/schema.js';
import { hasNonGuestRole, isApproved } from '../rbac/index.js';
import type { DiscordSyncStore } from './sync.js';

export function createDrizzleDiscordSyncStore(db: Database): DiscordSyncStore {
  return {
    async listCategories() {
      const zeilen = await db.select().from(discordOwnerCategories);

      return zeilen.map((z) => ({
        ownerId: z.userId,
        sequence: z.sequence,
        channelId: z.channelId,
      }));
    },

    async saveCategory(ownerId, sequence, channelId) {
      await db
        .insert(discordOwnerCategories)
        .values({ userId: ownerId, sequence, channelId })
        .onConflictDoUpdate({
          target: [discordOwnerCategories.userId, discordOwnerCategories.sequence],
          set: { channelId },
        });
    },

    async deleteCategory(ownerId, sequence) {
      await db
        .delete(discordOwnerCategories)
        .where(
          and(
            eq(discordOwnerCategories.userId, ownerId),
            eq(discordOwnerCategories.sequence, sequence),
          ),
        );
    },

    async listServerChannels() {
      const zeilen = await db.select().from(discordServerChannels);

      return zeilen.map((z) => ({
        serverId: z.serverId,
        channelId: z.channelId,
        statusMessageId: z.statusMessageId,
        lastRenderedHash: z.lastRenderedHash,
      }));
    },

    async saveServerChannel(serverId, channelId) {
      await db
        .insert(discordServerChannels)
        .values({ serverId, channelId })
        .onConflictDoUpdate({
          target: discordServerChannels.serverId,
          // Neuer Kanal, also auch keine Kachel mehr.
          set: { channelId, statusMessageId: null, lastRenderedHash: null, updatedAt: new Date() },
        });
    },

    async saveStatusMessage(serverId, messageId, hash) {
      await db
        .update(discordServerChannels)
        .set({ statusMessageId: messageId, lastRenderedHash: hash, updatedAt: new Date() })
        .where(eq(discordServerChannels.serverId, serverId));
    },

    async deleteServerChannel(serverId) {
      await db.delete(discordServerChannels).where(eq(discordServerChannels.serverId, serverId));
    },
  };
}

export interface PanelAccounts {
  /** Verknüpft, freigeschaltet und nicht gesperrt: Konto → Discord-Id. */
  readonly linkedDiscordIds: Map<string, string>;
  /**
   * Konten, die auf Discord **alle** Server-Kanäle sehen: das Owner-Konto und
   * freigeschaltete Konten mit `server.manage.any`.
   */
  readonly adminUserIds: Set<string>;
}

/**
 * Das Recht, das auf Discord zum Blick in fremde Server-Kanäle berechtigt.
 *
 * Bewusst **nicht** `server.view.any` (Befund des Betreibers, 2026-09-23): Auf
 * dieser Instanz trägt die Rolle „Nutzer" `server.view.any`, damit jeder die
 * Serverliste im Panel lesen kann. Mit diesem Recht als Maßstab sah auf
 * Discord jeder Nutzer jede Kategorie. Gemeint war „wer verwalten darf" –
 * Einsicht in die Liste des Panels ist keine Teilnahme am Bedienfeld eines
 * fremden Servers.
 */
export const DISCORD_ADMIN_PERMISSION: Permission = 'server.manage.any';

export interface AccountRow {
  readonly userId: string;
  readonly isOwner: boolean;
  readonly banned: boolean;
  readonly roleName: string | null;
  readonly permissions: readonly Permission[] | null;
}

export interface DiscordMethodRow {
  readonly userId: string;
  readonly discordUserId: string | null;
}

/**
 * Wertet Konten, Rollen und Discord-Anmeldungen aus – rein, damit die Regel
 * ohne Datenbank testbar ist.
 *
 * Dieselben Regeln wie überall (`rbac`): freigeschaltet heißt Owner oder eine
 * Rolle außer „Gast", und nie gesperrt. Admin im Sinne des Bots siehe
 * {@link DISCORD_ADMIN_PERMISSION}.
 */
export function accountsFromRows(
  kontenMitRollen: readonly AccountRow[],
  discordAnmeldungen: readonly DiscordMethodRow[],
): PanelAccounts {
  const konten = new Map<
    string,
    { isOwner: boolean; banned: boolean; roles: { name: string }[]; permissions: Set<Permission> }
  >();

  for (const zeile of kontenMitRollen) {
    const konto = konten.get(zeile.userId) ?? {
      isOwner: zeile.isOwner,
      banned: zeile.banned,
      roles: [],
      permissions: new Set<Permission>(),
    };

    if (zeile.roleName !== null) {
      konto.roles.push({ name: zeile.roleName });
      for (const recht of zeile.permissions ?? []) konto.permissions.add(recht);
    }

    konten.set(zeile.userId, konto);
  }

  const freigeschaltet = (userId: string): boolean => {
    const konto = konten.get(userId);

    return (
      konto !== undefined &&
      isApproved({
        isOwner: konto.isOwner,
        banned: konto.banned,
        hasNonGuestRole: hasNonGuestRole(konto.roles),
      })
    );
  };

  const linkedDiscordIds = new Map<string, string>();

  for (const anmeldung of discordAnmeldungen) {
    if (anmeldung.discordUserId && freigeschaltet(anmeldung.userId)) {
      linkedDiscordIds.set(anmeldung.userId, anmeldung.discordUserId);
    }
  }

  const adminUserIds = new Set<string>();

  for (const [userId, konto] of konten) {
    if (
      freigeschaltet(userId) &&
      (konto.isOwner || konto.permissions.has(DISCORD_ADMIN_PERMISSION))
    ) {
      adminUserIds.add(userId);
    }
  }

  return { linkedDiscordIds, adminUserIds };
}

/** Liest Konten, Rollen und Discord-Anmeldungen in zwei Abfragen. */
export async function loadPanelAccounts(db: Database): Promise<PanelAccounts> {
  const [kontenMitRollen, discordAnmeldungen] = await Promise.all([
    db
      .select({
        userId: users.id,
        isOwner: users.isOwner,
        banned: users.banned,
        roleName: roles.name,
        permissions: roles.permissions,
      })
      .from(users)
      .leftJoin(userRoles, eq(userRoles.userId, users.id))
      .leftJoin(roles, eq(roles.id, userRoles.roleId)),
    db
      .select({ userId: authMethods.userId, discordUserId: authMethods.providerUserId })
      .from(authMethods)
      .where(eq(authMethods.type, 'discord')),
  ]);

  return accountsFromRows(kontenMitRollen, discordAnmeldungen);
}
