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

  interface FastifyInstance {
    /**
     * Empfänger abgewiesener Zugriffe; `null`, wenn niemand zuhört.
     *
     * Am Server hängend statt als Modulzustand: Tests bauen mehrere Instanzen
     * nebeneinander, und eine Senke, die zwischen ihnen geteilt würde, machte
     * jeden dieser Tests von der Reihenfolge abhängig.
     */
    rbacAbweisungMelden: ((abweisung: RbacAbweisung) => void) | null;
  }
}

/**
 * Ein abgewiesener Zugriff (403), so wie ihn der Guard sieht.
 *
 * Bewusst der rohe Request statt fertiger Felder: Wer der Handelnde ist, weiß
 * das Auth-Modul (`request.authUser`), nicht die RBAC-Schicht. Diese Umkehr ist
 * dieselbe wie bei {@link RbacOptions.resolveActor} – sonst müsste `rbac` die
 * Typen von `auth` kennen, nur um einen Namen ins Log zu schreiben.
 */
export interface RbacAbweisung {
  readonly request: FastifyRequest;
  /** Die Rechte, an denen es gescheitert ist – mindestens eines. */
  readonly verlangt: readonly Permission[];
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

  /**
   * Meldet einen abgewiesenen Zugriff (Arbeitspaket HM-3, Pflichtenheft §6).
   *
   * Wird gerufen, bevor die 403-Antwort rausgeht, und **nur** bei einer
   * fehlenden Permission – nicht bei `AUTH_REQUIRED` (dann gibt es kein Konto,
   * auf das ein Eintrag zeigen könnte, und jeder Unangemeldete könnte das Log
   * füllen) und nicht bei {@link requireApproved} (siehe dort).
   *
   * Optional: Ohne Senke verhält sich der Guard wie bisher. Die Antwort hängt
   * nicht daran – wer hier etwas Langsames tut, verzögert die Abweisung.
   */
  onDenied?(abweisung: RbacAbweisung): void;
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
  app.decorate('rbacAbweisungMelden', options.onDenied ?? null);

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

/**
 * Kennzeichen an jedem hier gebauten Guard (Arbeitspaket HM-9).
 *
 * Trägt die Rechte, die der Guard verlangt – bei {@link requireApproved} eine
 * leere Liste, denn dort geht es um den Zustand des Kontos und nicht um ein
 * Recht aus dem Katalog.
 *
 * Damit lässt sich einer Route ansehen, ob sie überhaupt bewacht ist:
 * `routen-rechte.test.ts` geht beim Aufbau des Servers alle registrierten
 * Routen durch und schlägt fehl, sobald eine weder dieses Kennzeichen noch
 * einen begründeten Eintrag in seiner Ausnahmeliste trägt. Der Name der
 * Funktion taugte dafür nicht: Er ist eine Zusicherung, die niemand gibt.
 *
 * `Symbol.for` statt eines eigenen Symbols, damit die Marke auch dann passt,
 * wenn Testlauf und Anwendung dieses Modul über verschiedene Pfade laden.
 */
export const RBAC_GUARD_RECHTE = Symbol.for('palantir.rbac.guardRechte');

/** Ein Guard aus diesem Modul, an seinem Kennzeichen erkennbar. */
export interface RbacGuard extends preHandlerHookHandler {
  readonly [RBAC_GUARD_RECHTE]: readonly Permission[];
}

/** Trägt eine Route einen Guard aus diesem Modul? */
export function istRbacGuard(kandidat: unknown): kandidat is RbacGuard {
  return typeof kandidat === 'function' && RBAC_GUARD_RECHTE in kandidat;
}

/**
 * @param verlangt Die Rechte, um die es geht – sie gehen an
 *                 {@link RbacOptions.onDenied}. `null` unterdrückt die Meldung
 *                 (siehe {@link requireApproved}).
 */
function createGuard(
  check: (actor: PermissionActor) => boolean,
  verlangt: readonly Permission[] | null,
): preHandlerHookHandler {
  // Die Anmerkung traegt die Typen von `request` und `reply` herein: An einer
  // Variablen steht der Rueckgabetyp der Funktion nicht mehr daneben.
  const guard: preHandlerHookHandler = async function permissionGuard(request, reply) {
    const actor = request.permissionActor;

    if (!actor) {
      await replyWithErrorCode(reply, 'AUTH_REQUIRED');
      return;
    }

    if (!check(actor)) {
      if (verlangt) {
        request.server.rbacAbweisungMelden?.({ request, verlangt });
      }

      await replyWithErrorCode(reply, 'PERMISSION_DENIED');
      return;
    }
  };

  // Nicht aufzählbar: Der Guard soll sich beim Protokollieren oder Vergleichen
  // von Hooks genauso verhalten wie zuvor.
  Object.defineProperty(guard, RBAC_GUARD_RECHTE, {
    value: verlangt ?? [],
    enumerable: false,
  });

  return guard;
}

/** Route verlangt genau diese Permission. */
export function requirePermission(permission: Permission): preHandlerHookHandler {
  return createGuard((actor) => hasPermission(actor, permission), [permission]);
}

/** Route verlangt mindestens eine der genannten Permissions. */
export function requireAnyPermission(
  ...permissions: readonly [Permission, ...Permission[]]
): preHandlerHookHandler {
  return createGuard((actor) => hasAnyPermission(actor, permissions), permissions);
}

/** Route verlangt alle genannten Permissions. */
export function requireAllPermissions(
  ...permissions: readonly [Permission, ...Permission[]]
): preHandlerHookHandler {
  return createGuard((actor) => hasAllPermissions(actor, permissions), permissions);
}

/**
 * Route verlangt ein **freigeschaltetes** Konto (Lastenheft §3.1).
 *
 * Für Routen, die keine Permission aus dem Katalog verlangen, sondern nur eine
 * Sitzung. Ohne diesen Guard reicht dort die bloße Anmeldung – ein frisch
 * registriertes Konto mit ausschließlich der Rolle „Gast" käme durch, obwohl es
 * „keinerlei Zugriff auf Funktionen" haben soll (security-matrix-06).
 *
 * Die Regel selbst wird nicht hier ausgelegt: `actor.approved` kommt aus
 * {@link isAccountApproved} und ist damit dieselbe Regel wie
 * `AccountDto.awaitingApproval` und die Warteliste in B8.
 *
 * Antwortet mit `AUTH_REQUIRED` (401) ohne Sitzung und `PERMISSION_DENIED`
 * (403) bei einem nicht freigeschalteten Konto – dieselben zwei Codes wie
 * {@link requirePermission}, damit das Frontend nicht drei Fälle kennen muss.
 */
export function requireApproved(): preHandlerHookHandler {
  /*
   * Bewusst ohne Meldung ans Audit-Log (HM-3): Ein Konto in der Warteliste
   * prallt an JEDER Route ab, und die Oberfläche fragt nach der Anmeldung
   * weiter. Aus einem bekannten, harmlosen Zustand – die Freischaltung steht
   * aus, das Panel sagt es dem Konto selbst – entstünden so im Minutentakt
   * Einträge und begrüben die interessanten unter sich. Gemeldet wird die
   * fehlende Permission: Da hat jemand eine Rolle und will darüber hinaus.
   */
  return createGuard((actor) => actor.approved, null);
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
