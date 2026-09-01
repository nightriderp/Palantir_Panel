/**
 * Freischalt-Warteliste („Anfragen", Lastenheft §3.1 und §3.7).
 *
 * Jedes neu registrierte Konto bekommt die geschützte Systemrolle „Gast" und
 * hat bis zur Freischaltung keinerlei Zugriff (Pflichtenheft §7). Diese Liste
 * zeigt genau diese Konten – mit den Profilangaben der verknüpften
 * Login-Methoden, damit ein Admin die Person wiedererkennt.
 *
 * **Abgrenzung zu B1 (Auth & Identity):** Registrierung, `AuthMethod` und das
 * Abholen der Profildaten beim Provider gehören zu B1. B8 liefert die
 * Admin-Sicht darauf und die Aktionen. Die Profilangaben liest die
 * Drizzle-Implementierung des Repositories aus `auth_methods` mit; die
 * Abbildung auf `LinkedAccountProfileDto` steht in `linked-profiles.ts`
 * (R1, Gefundener Punkt 39).
 *
 * **Freigabe** heißt: Gast-Rolle entziehen und die gewünschten Rollen zuweisen
 * (ohne Angabe die Seed-Rolle „Nutzer"). **Sperren** setzt `User.banned` –
 * jederzeit möglich, unabhängig von der Rolle, mit einer Ausnahme: Das
 * Owner-Konto lässt sich nicht sperren (Lastenheft §2).
 */

import {
  GUEST_ROLE_NAME,
  type LinkedAccountProfileDto,
  type RegistrationRequestDto,
  type RegistrationRequestQuota,
  type RegistrationRequestPermissions,
  type RegistrationRequestStatus,
} from '@palantir/contracts';
import type {
  ApproveRegistrationRequestInput,
  BlockRegistrationRequestInput,
  RegistrationRequestQuery,
} from '@palantir/validation';
import { type PermissionActor, type RoleService, hasPermission } from '../rbac/index.js';
import { type AuditService, entryFor } from './audit.js';
import type { AdminContext } from './context.js';
import { AdminError } from './errors.js';

/** Rolle eines Kontos, soweit die Warteliste sie braucht. */
export interface WaitlistRole {
  readonly id: string;
  readonly name: string;
  readonly isProtected: boolean;
}

/** Konto, wie es in der Warteliste erscheint. */
export interface WaitlistUserRecord {
  readonly id: string;
  readonly displayName: string;
  readonly isOwner: boolean;
  readonly banned: boolean;
  readonly createdAt: Date;
  readonly roles: readonly WaitlistRole[];
  /**
   * Profilangaben der verknüpften Login-Methoden (Lastenheft §3.1) – gefüllt
   * aus `auth_methods`. Leer bei Konten ohne verknüpftes Verfahren.
   */
  readonly profiles: readonly LinkedAccountProfileDto[];
}

export interface WaitlistPage {
  readonly rows: readonly WaitlistUserRecord[];
  readonly total: number;
}

export interface RegistrationRequestRepository {
  list(query: RegistrationRequestQuery): Promise<WaitlistPage>;
  findByUserId(userId: string): Promise<WaitlistUserRecord | null>;
  setBanned(userId: string, banned: boolean): Promise<void>;
}

/**
 * Zustand eines Kontos in der Warteliste.
 *
 * Gesperrt schlägt alles: Ein gesperrtes Konto ist keine offene Anfrage mehr,
 * auch wenn es noch die Gast-Rolle trägt.
 *
 * Der Owner wartet nie (Lastenheft §2): Sein Sonderstatus liegt außerhalb des
 * Rollensystems und gibt ihm unabhängig von seinen Rollen alle Rechte – als
 * offene Anfrage in der Warteliste zu stehen wäre schlicht falsch. Dieselbe
 * Auslegung wie `isAwaitingApproval()` im Auth-Modul (B1); gesperrt werden kann
 * er ohnehin nicht.
 */
export function statusOf(user: WaitlistUserRecord): RegistrationRequestStatus {
  if (user.banned) {
    return 'blocked';
  }

  if (user.isOwner) {
    return 'approved';
  }

  const hasOnlyGuestRole = user.roles.every((role) => role.name === GUEST_ROLE_NAME);

  return hasOnlyGuestRole ? 'pending' : 'approved';
}

export function computeRegistrationRequestPermissions(
  actor: PermissionActor,
  user: WaitlistUserRecord,
): RegistrationRequestPermissions {
  const canManage = hasPermission(actor, 'user.manage');
  const status = statusOf(user);

  return {
    canView: canManage,
    canApprove: canManage && status === 'pending',
    // Der Owner steht außerhalb des Rollensystems und darf sich nicht
    // aussperren lassen (Lastenheft §2).
    canBlock: canManage && !user.isOwner && !user.banned,
    canUnblock: canManage && user.banned,
  };
}

export function toRegistrationRequestDto(
  actor: PermissionActor,
  user: WaitlistUserRecord,
): RegistrationRequestDto {
  return {
    userId: user.id,
    displayName: user.displayName,
    status: statusOf(user),
    banned: user.banned,
    profiles: [...user.profiles],
    roleNames: user.roles.map((role) => role.name),
    // Dieselben Rollen mit Id (Gefundener Punkt 90): Die Oberflaeche muss die
    // Namen nicht mehr ueber /admin/roles zurueckrechnen.
    roles: user.roles.map((role) => ({ id: role.id, name: role.name })),
    registeredAt: user.createdAt.toISOString(),
    permissions: computeRegistrationRequestPermissions(actor, user),
  };
}

export interface RegistrationRequestService {
  list(ctx: AdminContext, query: RegistrationRequestQuery): Promise<RegistrationRequestDto[]>;
  approve(
    ctx: AdminContext,
    userId: string,
    input: ApproveRegistrationRequestInput,
  ): Promise<RegistrationRequestDto>;
  block(
    ctx: AdminContext,
    userId: string,
    input: BlockRegistrationRequestInput,
  ): Promise<RegistrationRequestDto>;
  unblock(ctx: AdminContext, userId: string): Promise<RegistrationRequestDto>;
}

/**
 * Kontingente mehrerer Konten – erfüllt vom Ressourcen-Modul (B4).
 *
 * Bewusst nur diese eine Methode statt des ganzen `ResourceService`: Die
 * Warteliste braucht Kontingente zum Anzeigen und sonst nichts aus B4, und eine
 * eigene Zählung hier wäre die Parallelstruktur, die CLAUDE.md §3 ausschließt.
 */
/**
 * Serveranzahl mehrerer Konten - erfuellt von der Server-Orchestrierung (B3).
 *
 * Wie {@link QuotaSummaryReader} bewusst nur diese eine Methode: Die Uebersicht
 * braucht eine Zahl, keine Serverliste, und eine eigene Zaehlung hier waere die
 * Parallelstruktur, die CLAUDE.md §3 ausschliesst.
 */
export interface ServerCountReader {
  countServersByOwner(userIds: readonly string[]): Promise<ReadonlyMap<string, number>>;
}

export interface QuotaSummaryReader {
  listQuotaSummaries(
    actor: PermissionActor,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, RegistrationRequestQuota>>;
}

export interface RegistrationRequestDependencies {
  readonly repository: RegistrationRequestRepository;
  /** Rollenverwaltung aus B2 – die Zuweisung läuft nicht an ihr vorbei. */
  readonly roles: RoleService;
  readonly audit: AuditService;
  /** Rolle, die eine Freigabe ohne eigene Auswahl vergibt. */
  readonly defaultRoleName?: string;
  /**
   * Kontingente für die Spalte „Kontingent" (Mockup-Abgleich 12.1.3).
   *
   * Optional: Ohne diese Abhängigkeit bleibt `quota` schlicht weg – die Liste
   * funktioniert weiter, sie zeigt nur eine Spalte weniger.
   */
  readonly quotas?: QuotaSummaryReader;
  /**
   * Serveranzahl je Konto (Gefundener Punkt 90).
   *
   * Optional wie {@link QuotaSummaryReader}: Ohne diese Abhaengigkeit bleibt
   * `serverCount` weg, die Liste funktioniert weiter.
   */
  readonly serverCounts?: ServerCountReader;
}

function requireUserManage(actor: PermissionActor): void {
  if (!hasPermission(actor, 'user.manage')) {
    throw new AdminError('PERMISSION_DENIED');
  }
}

export function createRegistrationRequestService(
  deps: RegistrationRequestDependencies,
): RegistrationRequestService {
  const defaultRoleName = deps.defaultRoleName ?? 'Nutzer';

  async function requireUser(userId: string): Promise<WaitlistUserRecord> {
    const user = await deps.repository.findByUserId(userId);

    if (!user) {
      throw new AdminError('USER_NOT_FOUND');
    }

    return user;
  }

  async function reload(ctx: AdminContext, userId: string): Promise<RegistrationRequestDto> {
    return toRegistrationRequestDto(ctx.actor, await requireUser(userId));
  }

  /**
   * Serveranzahl an die Eintraege haengen (Gefundener Punkt 90).
   *
   * Eine Abfrage fuer die ganze Seite, nicht eine je Zeile. Ein Fehler dabei
   * kostet die Spalte, nicht die Liste - genau wie beim Kontingent: Die
   * Warteliste ist der Weg, ein Konto freizugeben, und das darf nicht an einer
   * Zusatzangabe scheitern.
   */
  async function mitServeranzahl(
    eintraege: RegistrationRequestDto[],
  ): Promise<RegistrationRequestDto[]> {
    if (deps.serverCounts === undefined || eintraege.length === 0) {
      return eintraege;
    }

    try {
      const anzahl = await deps.serverCounts.countServersByOwner(
        eintraege.map((eintrag) => eintrag.userId),
      );

      return eintraege.map((eintrag) => ({
        ...eintrag,
        serverCount: anzahl.get(eintrag.userId) ?? 0,
      }));
    } catch {
      return eintraege;
    }
  }

  return {
    async list(ctx, query) {
      requireUserManage(ctx.actor);

      const page = await deps.repository.list(query);
      const roh = page.rows.map((row) => toRegistrationRequestDto(ctx.actor, row));
      const eintraege = await mitServeranzahl(roh);

      if (deps.quotas === undefined || eintraege.length === 0) {
        return eintraege;
      }

      /*
       * Kontingente in einem Aufruf für die ganze Seite – nicht je Zeile. Ein
       * Fehler dabei kostet die Spalte, nicht die Liste: Die Warteliste ist der
       * Weg, ein Konto freizugeben, und das darf nicht daran scheitern, dass
       * eine Zusatzangabe nicht ermittelbar war.
       */
      try {
        const kontingente = await deps.quotas.listQuotaSummaries(
          ctx.actor,
          eintraege.map((eintrag) => eintrag.userId),
        );

        return eintraege.map((eintrag) => ({
          ...eintrag,
          quota: kontingente.get(eintrag.userId) ?? null,
        }));
      } catch {
        return eintraege.map((eintrag) => ({ ...eintrag, quota: null }));
      }
    },

    async approve(ctx, userId, input) {
      requireUserManage(ctx.actor);

      const user = await requireUser(userId);

      if (statusOf(user) !== 'pending') {
        throw new AdminError('REGISTRATION_REQUEST_INVALID_STATE');
      }

      const roleIds = input.roleIds?.length
        ? input.roleIds
        : [await resolveDefaultRoleId(ctx.actor, deps.roles, defaultRoleName)];

      for (const roleId of roleIds) {
        await deps.roles.assignToUser(ctx.actor, user.id, roleId);
      }

      // Erst zuweisen, dann die Gast-Rolle entziehen: Ein Konto ist nie ohne
      // Rolle, falls zwischendrin etwas schiefgeht.
      for (const role of user.roles) {
        if (role.name === GUEST_ROLE_NAME) {
          await deps.roles.removeFromUser(ctx.actor, user.id, role.id);
        }
      }

      await deps.audit.record(
        entryFor(ctx, {
          action: 'user.approved',
          targetType: 'user',
          targetId: user.id,
          metadata: { roleIds: [...roleIds] },
        }),
      );

      return reload(ctx, user.id);
    },

    async block(ctx, userId, input) {
      requireUserManage(ctx.actor);

      const user = await requireUser(userId);

      if (user.isOwner) {
        throw new AdminError('OWNER_PROTECTED');
      }

      if (user.banned) {
        throw new AdminError('REGISTRATION_REQUEST_INVALID_STATE');
      }

      await deps.repository.setBanned(user.id, true);
      await deps.audit.record(
        entryFor(ctx, {
          action: 'user.banned',
          targetType: 'user',
          targetId: user.id,
          metadata: input.reason ? { reason: input.reason } : {},
        }),
      );

      return reload(ctx, user.id);
    },

    async unblock(ctx, userId) {
      requireUserManage(ctx.actor);

      const user = await requireUser(userId);

      if (!user.banned) {
        throw new AdminError('REGISTRATION_REQUEST_INVALID_STATE');
      }

      await deps.repository.setBanned(user.id, false);
      await deps.audit.record(
        entryFor(ctx, {
          action: 'user.unbanned',
          targetType: 'user',
          targetId: user.id,
        }),
      );

      return reload(ctx, user.id);
    },
  };
}

async function resolveDefaultRoleId(
  actor: PermissionActor,
  roles: RoleService,
  name: string,
): Promise<string> {
  const all = await roles.list(actor);
  const match = all.find((role) => role.name.toLowerCase() === name.toLowerCase());

  if (!match) {
    throw new AdminError(
      'ROLE_NOT_FOUND',
      `Die Standardrolle „${name}" fehlt. Bitte zuerst die Seed-Rollen anlegen (pnpm --filter @palantir/backend db:seed).`,
    );
  }

  return match.id;
}
