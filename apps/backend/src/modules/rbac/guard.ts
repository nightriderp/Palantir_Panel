/**
 * Permission-Guard für Fastify-Routen (Pflichtenheft §8).
 *
 * Ablauf je Request:
 * 1. `registerRbac()` hängt einen `onRequest`-Hook ein, der über die vom
 *    Aufrufer gelieferte `resolveActor`-Funktion den {@link PermissionActor}
 *    ermittelt (Arbeitspaket B1 liefert ihn aus der Sitzung) und an
 *    `request.permissionActor` hängt – `null`, wenn niemand angemeldet ist.
 * 2. `requirePermission(...)` als `preHandler` einer Route prüft diesen Actor
 *    und antwortet im Envelope-Format aus Pflichtenheft §5.1:
 *    `AUTH_REQUIRED` (401), wenn niemand angemeldet ist,
 *    `PERMISSION_DENIED` (403), wenn die Permission fehlt.
 *
 * Die Trennung der beiden Codes ist Absicht: das Frontend soll „neu anmelden"
 * von „fehlende Berechtigung" unterscheiden können.
 */

import { type ErrorCode, type Permission, fail, httpStatusForErrorCode } from '@palantir/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { RbacError } from './errors.js';
import {
  type PermissionActor,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
} from './permissions.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Effektive Rechte des Aufrufers; `null`, solange niemand angemeldet ist. */
    permissionActor: PermissionActor | null;
  }
}

export interface RbacOptions {
  /**
   * Ermittelt den Handelnden zum Request – üblicherweise aus der Sitzung (B1).
   *
   * Gibt `null` zurück, wenn kein gültiges Konto am Request hängt. Fehler aus
   * dieser Funktion werden nicht abgefangen: sie gehören in den regulären
   * Fehlerpfad der Anwendung.
   */
  resolveActor(request: FastifyRequest): Promise<PermissionActor | null> | PermissionActor | null;
}

/**
 * Hängt die Actor-Auflösung in eine Fastify-Instanz ein.
 *
 * Bewusst als normale Funktion statt als Fastify-Plugin: `app.decorateRequest`
 * wirkt sonst nur innerhalb des Plugin-Kontexts, und ein zusätzliches
 * `fastify-plugin` als Abhängigkeit wäre dafür nicht gerechtfertigt
 * (CLAUDE.md §1). Auf der Wurzel-Instanz aufrufen, bevor Routen registriert
 * werden.
 */
export function registerRbac(app: FastifyInstance, options: RbacOptions): void {
  app.decorateRequest('permissionActor', null);

  app.addHook('onRequest', async (request: FastifyRequest): Promise<void> => {
    request.permissionActor = await options.resolveActor(request);
  });
}

/** Antwortet mit dem Envelope aus Pflichtenheft §5.1 und dem passenden HTTP-Status. */
export async function replyWithErrorCode(
  reply: FastifyReply,
  code: ErrorCode,
  message?: string,
): Promise<void> {
  await reply.status(httpStatusForErrorCode(code)).send(fail(code, message));
}

/** Wandelt einen {@link RbacError} in die passende Fehlerantwort um. */
export async function replyWithRbacError(reply: FastifyReply, error: RbacError): Promise<void> {
  await replyWithErrorCode(reply, error.code, error.message);
}

function createGuard(check: (actor: PermissionActor) => boolean): preHandlerHookHandler {
  return async function permissionGuard(request, reply): Promise<void> {
    const actor = request.permissionActor;

    if (!actor) {
      await replyWithErrorCode(reply, 'AUTH_REQUIRED');
      return;
    }

    if (!check(actor)) {
      await replyWithErrorCode(reply, 'PERMISSION_DENIED');
      return;
    }
  };
}

/** Route verlangt genau diese Permission. */
export function requirePermission(permission: Permission): preHandlerHookHandler {
  return createGuard((actor) => hasPermission(actor, permission));
}

/** Route verlangt mindestens eine der genannten Permissions. */
export function requireAnyPermission(
  ...permissions: readonly [Permission, ...Permission[]]
): preHandlerHookHandler {
  return createGuard((actor) => hasAnyPermission(actor, permissions));
}

/** Route verlangt alle genannten Permissions. */
export function requireAllPermissions(
  ...permissions: readonly [Permission, ...Permission[]]
): preHandlerHookHandler {
  return createGuard((actor) => hasAllPermissions(actor, permissions));
}

/**
 * Liefert den Actor eines Requests oder bricht mit `AUTH_REQUIRED` ab.
 *
 * Für Handler, die den Actor brauchen (etwa zum Berechnen des
 * `permissions`-Objekts), ohne ihn erneut auf `null` prüfen zu müssen.
 */
export function requireActor(request: FastifyRequest): PermissionActor {
  if (!request.permissionActor) {
    throw new RbacError('AUTH_REQUIRED');
  }

  return request.permissionActor;
}
