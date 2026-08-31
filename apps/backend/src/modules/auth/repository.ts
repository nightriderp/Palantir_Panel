/**
 * Drizzle-Implementierung von {@link AuthRepository} (Pflichtenheft §6).
 *
 * Enthält ausschließlich Datenzugriff – jede fachliche Regel (Sperren,
 * Methoden-Verknüpfung, Token-Rotation) liegt im Service in `service.ts`.
 */

import { type AuthMethodType } from '@palantir/contracts';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { authMethods, sessions } from '../../db/schema/auth.js';
import { users } from '../../db/schema/users.js';
import type {
  AuthMethodRecord,
  AuthRepository,
  CreateAuthMethodData,
  CreateSessionData,
  SessionRecord,
  UpdateAuthMethodData,
  UserRecord,
} from './types.js';

type UserRow = typeof users.$inferSelect;
type AuthMethodRow = typeof authMethods.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    isOwner: row.isOwner,
    banned: row.banned,
    createdAt: row.createdAt,
  };
}

function toAuthMethod(row: AuthMethodRow): AuthMethodRecord {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    providerUserId: row.providerUserId,
    passwordHash: row.passwordHash,
    providerDisplayName: row.providerDisplayName,
    providerAvatarUrl: row.providerAvatarUrl,
    mustChangePassword: row.mustChangePassword,
    totpSecret: row.totpSecret,
    totpConfirmedAt: row.totpConfirmedAt,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

function toSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    refreshTokenHash: row.refreshTokenHash,
    previousRefreshTokenHash: row.previousRefreshTokenHash,
    deviceInfo: row.deviceInfo,
    ipHint: row.ipHint,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
  };
}

export function createDrizzleAuthRepository(db: Database): AuthRepository {
  return {
    async findUserById(id) {
      const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);

      return row ? toUser(row) : null;
    },

    async findUserByUsername(username) {
      // Vergleich ohne Rücksicht auf Groß-/Kleinschreibung – deckungsgleich mit
      // dem Unique-Index `users_username_lower_idx`.
      const [row] = await db
        .select()
        .from(users)
        .where(sql`lower(${users.username}) = lower(${username})`)
        .limit(1);

      return row ? toUser(row) : null;
    },

    async usernameExists(username) {
      const [row] = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.username}) = lower(${username})`)
        .limit(1);

      return Boolean(row);
    },

    async createUser(data) {
      const [row] = await db
        .insert(users)
        .values({ username: data.username, displayName: data.displayName })
        .returning();

      if (!row) {
        throw new Error('Konto konnte nicht angelegt werden.');
      }

      return toUser(row);
    },

    async findOwner() {
      const [row] = await db.select().from(users).where(eq(users.isOwner, true)).limit(1);

      return row ? toUser(row) : null;
    },

    async setOwner(id) {
      // Das zweite Owner-Konto verhindert der partielle Unique-Index
      // `users_single_owner_idx` (Lastenheft §2). Die fachliche Prüfung mit
      // benanntem Fehler liegt im Service; hier bleibt die Datenbank die
      // letzte Instanz, auch bei gleichzeitigen Läufen.
      const [row] = await db
        .update(users)
        .set({ isOwner: true })
        .where(eq(users.id, id))
        .returning();

      if (!row) {
        throw new Error('Konto konnte nicht aktualisiert werden.');
      }

      return toUser(row);
    },

    async setUsername(id, username) {
      const [row] = await db.update(users).set({ username }).where(eq(users.id, id)).returning();

      if (!row) {
        throw new Error('Konto konnte nicht aktualisiert werden.');
      }

      return toUser(row);
    },

    async setDisplayName(id, displayName) {
      const [row] = await db.update(users).set({ displayName }).where(eq(users.id, id)).returning();

      if (!row) {
        throw new Error('Konto konnte nicht aktualisiert werden.');
      }

      return toUser(row);
    },

    async deleteUser(id) {
      // `auth_methods`, `sessions` und `user_roles` hängen mit ON DELETE CASCADE
      // am Konto und verschwinden mit (Pflichtenheft §6).
      await db.delete(users).where(eq(users.id, id));
    },

    async listAuthMethods(userId) {
      const rows = await db
        .select()
        .from(authMethods)
        .where(eq(authMethods.userId, userId))
        .orderBy(authMethods.createdAt);

      return rows.map(toAuthMethod);
    },

    async findAuthMethod(userId, type: AuthMethodType) {
      const [row] = await db
        .select()
        .from(authMethods)
        .where(and(eq(authMethods.userId, userId), eq(authMethods.type, type)))
        .limit(1);

      return row ? toAuthMethod(row) : null;
    },

    async findAuthMethodByProvider(type: AuthMethodType, providerUserId) {
      const [row] = await db
        .select()
        .from(authMethods)
        .where(and(eq(authMethods.type, type), eq(authMethods.providerUserId, providerUserId)))
        .limit(1);

      return row ? toAuthMethod(row) : null;
    },

    async createAuthMethod(data: CreateAuthMethodData) {
      const [row] = await db
        .insert(authMethods)
        .values({
          userId: data.userId,
          type: data.type,
          providerUserId: data.providerUserId ?? null,
          passwordHash: data.passwordHash ?? null,
          providerDisplayName: data.providerDisplayName ?? null,
          providerAvatarUrl: data.providerAvatarUrl ?? null,
          mustChangePassword: data.mustChangePassword ?? false,
        })
        .returning();

      if (!row) {
        throw new Error('Login-Methode konnte nicht angelegt werden.');
      }

      return toAuthMethod(row);
    },

    async updateAuthMethod(id, data: UpdateAuthMethodData) {
      const [row] = await db
        .update(authMethods)
        .set({
          ...(data.passwordHash !== undefined ? { passwordHash: data.passwordHash } : {}),
          ...(data.providerDisplayName !== undefined
            ? { providerDisplayName: data.providerDisplayName }
            : {}),
          ...(data.providerAvatarUrl !== undefined
            ? { providerAvatarUrl: data.providerAvatarUrl }
            : {}),
          ...(data.mustChangePassword !== undefined
            ? { mustChangePassword: data.mustChangePassword }
            : {}),
          ...(data.totpSecret !== undefined ? { totpSecret: data.totpSecret } : {}),
          ...(data.totpConfirmedAt !== undefined ? { totpConfirmedAt: data.totpConfirmedAt } : {}),
          ...(data.lastUsedAt !== undefined ? { lastUsedAt: data.lastUsedAt } : {}),
        })
        .where(eq(authMethods.id, id))
        .returning();

      if (!row) {
        throw new Error('Login-Methode konnte nicht aktualisiert werden.');
      }

      return toAuthMethod(row);
    },

    async deleteAuthMethod(id) {
      await db.delete(authMethods).where(eq(authMethods.id, id));
    },

    async createSession(data: CreateSessionData) {
      const [row] = await db
        .insert(sessions)
        .values({
          userId: data.userId,
          refreshTokenHash: data.refreshTokenHash,
          deviceInfo: data.deviceInfo,
          ipHint: data.ipHint,
          expiresAt: data.expiresAt,
        })
        .returning();

      if (!row) {
        throw new Error('Sitzung konnte nicht angelegt werden.');
      }

      return toSession(row);
    },

    async findSessionById(id) {
      const [row] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);

      return row ? toSession(row) : null;
    },

    async findSessionByTokenHash(refreshTokenHash) {
      const [row] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.refreshTokenHash, refreshTokenHash))
        .limit(1);

      return row ? toSession(row) : null;
    },

    async findSessionByPreviousTokenHash(refreshTokenHash) {
      const [row] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.previousRefreshTokenHash, refreshTokenHash))
        .limit(1);

      return row ? toSession(row) : null;
    },

    async listActiveSessions(userId, nowMs) {
      const rows = await db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.userId, userId),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, new Date(nowMs)),
          ),
        )
        .orderBy(desc(sessions.lastUsedAt));

      return rows.map(toSession);
    },

    async rotateSession(id, data) {
      const [row] = await db
        .update(sessions)
        .set({
          refreshTokenHash: data.refreshTokenHash,
          previousRefreshTokenHash: data.previousRefreshTokenHash,
          expiresAt: data.expiresAt,
          lastUsedAt: data.lastUsedAt,
        })
        .where(eq(sessions.id, id))
        .returning();

      if (!row) {
        throw new Error('Sitzung konnte nicht erneuert werden.');
      }

      return toSession(row);
    },

    async revokeSession(id, revokedAt) {
      await db
        .update(sessions)
        .set({ revokedAt })
        .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)));
    },

    async revokeAllSessions(userId, revokedAt) {
      await db
        .update(sessions)
        .set({ revokedAt })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    },
  };
}
