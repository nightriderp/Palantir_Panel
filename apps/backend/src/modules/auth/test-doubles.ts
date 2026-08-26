/**
 * Test-Doubles des Auth-Moduls – **nur für Tests**, nie im Betrieb verwendet.
 *
 * Bewusst als eigene Datei statt doppelt in `service.test.ts` und
 * `routes.test.ts`: beide brauchen dieselbe Ablage im Arbeitsspeicher, und ein
 * zweiter, leicht abweichender Nachbau würde die Tests gegeneinander laufen
 * lassen. Die Fakes bilden ausschließlich das nach, was die echten Tabellen
 * zusichern (Eindeutigkeit des Anzeigenamens, je Konto eine Methode pro Typ).
 */

import { randomUUID } from 'node:crypto';
import { GUEST_ROLE_NAME, type Permission } from '@palantir/contracts';
import type { RoleRecord, RoleRepository } from '../rbac/index.js';
import { AuthError } from './errors.js';
import type { AuthMethodRecord, AuthRepository, SessionRecord, UserRecord } from './types.js';
import type { ProviderAdapter, ProviderIdentity, ProviderRegistry } from './providers.js';

export interface FakeAuthRepository extends AuthRepository {
  readonly users: UserRecord[];
  readonly methods: AuthMethodRecord[];
  readonly sessions: SessionRecord[];
}

export function createFakeAuthRepository(): FakeAuthRepository {
  const users: UserRecord[] = [];
  const methods: AuthMethodRecord[] = [];
  const sessions: SessionRecord[] = [];

  const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

  return {
    users,
    methods,
    sessions,

    findUserById: (id) => Promise.resolve(users.find((user) => user.id === id) ?? null),

    findUserByUsername: (username) =>
      Promise.resolve(
        users.find((user) => user.username !== null && sameName(user.username, username)) ?? null,
      ),

    usernameExists: (username) =>
      Promise.resolve(
        users.some((user) => user.username !== null && sameName(user.username, username)),
      ),

    createUser: (data) => {
      const wanted = data.username;

      if (
        wanted !== null &&
        users.some((user) => user.username !== null && sameName(user.username, wanted))
      ) {
        // Bildet den Unique-Index `users_username_lower_idx` nach.
        return Promise.reject(new Error('Benutzername bereits vergeben.'));
      }

      const user: UserRecord = {
        id: randomUUID(),
        username: data.username,
        displayName: data.displayName,
        isOwner: false,
        banned: false,
        createdAt: new Date('2026-08-26T10:00:00Z'),
      };

      users.push(user);

      return Promise.resolve(user);
    },

    findOwner: () => Promise.resolve(users.find((user) => user.isOwner) ?? null),

    setOwner: (id) => {
      const index = users.findIndex((user) => user.id === id);
      const current = users[index];

      if (!current) {
        return Promise.reject(new Error('Konto nicht gefunden.'));
      }

      if (users.some((user) => user.isOwner && user.id !== id)) {
        // Bildet den partiellen Unique-Index `users_single_owner_idx` nach:
        // die Datenbank lässt kein zweites Owner-Konto zu (Lastenheft §2).
        return Promise.reject(new Error('Es gibt bereits ein Owner-Konto.'));
      }

      const updated: UserRecord = { ...current, isOwner: true };
      users[index] = updated;

      return Promise.resolve(updated);
    },

    setUsername: (id, username) => {
      const index = users.findIndex((user) => user.id === id);
      const current = users[index];

      if (!current) {
        return Promise.reject(new Error('Konto nicht gefunden.'));
      }

      const updated: UserRecord = { ...current, username };
      users[index] = updated;

      return Promise.resolve(updated);
    },

    deleteUser: (id) => {
      // Bildet ON DELETE CASCADE nach (Pflichtenheft §6).
      for (const list of [users, methods, sessions] as { userId?: string; id: string }[][]) {
        for (let index = list.length - 1; index >= 0; index -= 1) {
          const row = list[index];

          if (row && (row.id === id || row.userId === id)) {
            list.splice(index, 1);
          }
        }
      }

      return Promise.resolve();
    },

    listAuthMethods: (userId) =>
      Promise.resolve(methods.filter((method) => method.userId === userId)),

    findAuthMethod: (userId, type) =>
      Promise.resolve(
        methods.find((method) => method.userId === userId && method.type === type) ?? null,
      ),

    findAuthMethodByProvider: (type, providerUserId) =>
      Promise.resolve(
        methods.find(
          (method) => method.type === type && method.providerUserId === providerUserId,
        ) ?? null,
      ),

    createAuthMethod: (data) => {
      if (methods.some((m) => m.userId === data.userId && m.type === data.type)) {
        // Bildet den Unique-Index `auth_methods_user_type_idx` nach.
        return Promise.reject(new Error('Methode je Konto nur einmal.'));
      }

      const method: AuthMethodRecord = {
        id: randomUUID(),
        userId: data.userId,
        type: data.type,
        providerUserId: data.providerUserId ?? null,
        passwordHash: data.passwordHash ?? null,
        providerDisplayName: data.providerDisplayName ?? null,
        providerAvatarUrl: data.providerAvatarUrl ?? null,
        mustChangePassword: data.mustChangePassword ?? false,
        totpSecret: null,
        totpConfirmedAt: null,
        createdAt: new Date('2026-08-26T10:00:00Z'),
        lastUsedAt: null,
      };

      methods.push(method);

      return Promise.resolve(method);
    },

    updateAuthMethod: (id, data) => {
      const index = methods.findIndex((method) => method.id === id);
      const current = methods[index];

      if (!current) {
        return Promise.reject(new Error('Methode nicht gefunden.'));
      }

      const updated: AuthMethodRecord = {
        ...current,
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
      };

      methods[index] = updated;

      return Promise.resolve(updated);
    },

    deleteAuthMethod: (id) => {
      const index = methods.findIndex((method) => method.id === id);

      if (index >= 0) {
        methods.splice(index, 1);
      }

      return Promise.resolve();
    },

    createSession: (data) => {
      const session: SessionRecord = {
        id: randomUUID(),
        userId: data.userId,
        refreshTokenHash: data.refreshTokenHash,
        previousRefreshTokenHash: null,
        deviceInfo: data.deviceInfo,
        ipHint: data.ipHint,
        createdAt: new Date('2026-08-26T10:00:00Z'),
        lastUsedAt: new Date('2026-08-26T10:00:00Z'),
        expiresAt: data.expiresAt,
        revokedAt: null,
      };

      sessions.push(session);

      return Promise.resolve(session);
    },

    findSessionById: (id) => Promise.resolve(sessions.find((session) => session.id === id) ?? null),

    findSessionByTokenHash: (hash) =>
      Promise.resolve(sessions.find((session) => session.refreshTokenHash === hash) ?? null),

    findSessionByPreviousTokenHash: (hash) =>
      Promise.resolve(
        sessions.find((session) => session.previousRefreshTokenHash === hash) ?? null,
      ),

    listActiveSessions: (userId, nowMs) =>
      Promise.resolve(
        sessions.filter(
          (session) =>
            session.userId === userId &&
            session.revokedAt === null &&
            session.expiresAt.getTime() > nowMs,
        ),
      ),

    rotateSession: (id, data) => {
      const index = sessions.findIndex((session) => session.id === id);
      const current = sessions[index];

      if (!current) {
        return Promise.reject(new Error('Sitzung nicht gefunden.'));
      }

      const updated: SessionRecord = { ...current, ...data };
      sessions[index] = updated;

      return Promise.resolve(updated);
    },

    revokeSession: (id, revokedAt) => {
      const index = sessions.findIndex((session) => session.id === id);
      const current = sessions[index];

      if (current && current.revokedAt === null) {
        sessions[index] = { ...current, revokedAt };
      }

      return Promise.resolve();
    },

    revokeAllSessions: (userId, revokedAt) => {
      sessions.forEach((session, index) => {
        if (session.userId === userId && session.revokedAt === null) {
          sessions[index] = { ...session, revokedAt };
        }
      });

      return Promise.resolve();
    },
  };
}

export interface FakeRoleRepository extends RoleRepository {
  readonly assignments: { userId: string; roleId: string }[];
  readonly roles: RoleRecord[];
}

/**
 * Rollen-Ablage mit der geschützten Systemrolle „Gast" – so, wie sie nach
 * `db:seed` vorliegt (Pflichtenheft §8).
 */
export function createFakeRoleRepository(
  extraRoles: { name: string; permissions: Permission[] }[] = [],
): FakeRoleRepository {
  const roles: RoleRecord[] = [
    {
      id: randomUUID(),
      name: GUEST_ROLE_NAME,
      description: null,
      permissions: [],
      isProtected: true,
      createdAt: new Date('2026-08-26T09:00:00Z'),
    },
    ...extraRoles.map((role) => ({
      id: randomUUID(),
      name: role.name,
      description: null,
      permissions: role.permissions,
      isProtected: false,
      createdAt: new Date('2026-08-26T09:00:00Z'),
    })),
  ];
  const assignments: { userId: string; roleId: string }[] = [];

  const notNeeded = (): never => {
    throw new Error('In den Auth-Tests nicht benötigt.');
  };

  return {
    roles,
    assignments,

    listAll: () => Promise.resolve(roles),
    findById: (id) => Promise.resolve(roles.find((role) => role.id === id) ?? null),
    findByName: (name) =>
      Promise.resolve(roles.find((role) => role.name.toLowerCase() === name.toLowerCase()) ?? null),
    create: notNeeded,
    update: notNeeded,
    remove: notNeeded,
    countMembers: () => Promise.resolve(new Map<string, number>()),

    listRolesForUser: (userId) =>
      Promise.resolve(
        assignments
          .filter((assignment) => assignment.userId === userId)
          .map((assignment) => roles.find((role) => role.id === assignment.roleId))
          .filter((role): role is RoleRecord => role !== undefined),
      ),

    assignToUser: (userId, roleId) => {
      if (!assignments.some((a) => a.userId === userId && a.roleId === roleId)) {
        assignments.push({ userId, roleId });
      }

      return Promise.resolve();
    },

    removeFromUser: (userId, roleId) => {
      const index = assignments.findIndex((a) => a.userId === userId && a.roleId === roleId);

      if (index >= 0) {
        assignments.splice(index, 1);
      }

      return Promise.resolve();
    },
  };
}

/**
 * Anbieter-Registry, die eine feste Identität zurückgibt – ohne Netzzugang.
 *
 * `state` und PKCE-Verifier werden trotzdem erzeugt und geprüft, damit die
 * Absicherung des Rücksprungs mitgetestet wird.
 */
export function createFakeProviderRegistry(
  identities: Partial<Record<string, ProviderIdentity>> = {},
): ProviderRegistry {
  const build = (provider: 'discord' | 'twitch' | 'steam'): ProviderAdapter => ({
    provider,
    isConfigured: () => true,
    buildAuthorization: () => ({
      authorizationUrl: `https://example.invalid/${provider}/authorize`,
      state: `state-${provider}`,
      codeVerifier: provider === 'steam' ? null : `verifier-${provider}`,
    }),
    completeLogin: (query, pending) => {
      const state = query.state;

      if (state !== pending.state) {
        // Wie die echten Adapter: ein benannter Fehlercode, kein Serverfehler.
        return Promise.reject(new AuthError('AUTH_OAUTH_STATE_INVALID'));
      }

      return Promise.resolve(
        identities[provider] ?? {
          provider,
          providerUserId: `${provider}-1234`,
          displayName: `${provider}-nutzer`,
          avatarUrl: null,
        },
      );
    },
  });

  return { discord: build('discord'), twitch: build('twitch'), steam: build('steam') };
}
