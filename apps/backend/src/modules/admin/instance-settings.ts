/**
 * Einstellungen der Instanz (Mockup-Abgleich 12.1.1).
 *
 * Bisher gab es nichts dergleichen: Die Instanz nahm immer Registrierungen an,
 * und die Nutzerseite des Entwurfs zeigte einen Schalter, der nirgends
 * hinführte. Hier liegt der Schalter.
 *
 * Genau eine Zeile in der Datenbank (`id = 1`). Fehlt sie, gelten die
 * Vorgaben – die Instanz verhält sich dann wie vor dieser Tabelle, und niemand
 * muss eine Zeile anlegen, damit die Anmeldung funktioniert.
 */

import { type InstanceSettingsDto } from '@palantir/contracts';
import { type InstanceSettingsInput } from '@palantir/validation';
import { eq } from 'drizzle-orm';
import { type DbConnection } from '../../db/client.js';
import { instanceSettings } from '../../db/schema.js';
import { hasPermission, type PermissionActor } from '../rbac/index.js';
import { AdminError } from './errors.js';

/** Die eine Zeile; der Wert hat keine Bedeutung außer „diese eine". */
const SINGLETON_ID = 1;

/** Vorgaben, solange nichts gesetzt wurde. */
export const DEFAULT_INSTANCE_SETTINGS = Object.freeze({
  selfRegistrationEnabled: true,
});

export interface InstanceSettingsRepository {
  load(): Promise<{ selfRegistrationEnabled: boolean; updatedAt: Date | null }>;
  save(input: InstanceSettingsInput, updatedById: string | null): Promise<void>;
}

export interface InstanceSettingsService {
  /** Einstellungen samt Rechteblock – verlangt `user.manage`. */
  get(actor: PermissionActor): Promise<InstanceSettingsDto>;
  set(
    actor: PermissionActor,
    input: InstanceSettingsInput,
    actorUserId: string | null,
  ): Promise<InstanceSettingsDto>;
  /**
   * Nimmt die Instanz Selbstregistrierungen an?
   *
   * Ohne Rechteprüfung: Diese Frage stellt die Registrierung selbst, und die
   * hat naturgemäß keine Sitzung.
   */
  selfRegistrationEnabled(): Promise<boolean>;
}

export function createDrizzleInstanceSettingsRepository(
  db: DbConnection,
): InstanceSettingsRepository {
  return {
    async load() {
      const [row] = await db
        .select()
        .from(instanceSettings)
        .where(eq(instanceSettings.id, SINGLETON_ID))
        .limit(1);

      if (!row) {
        return { ...DEFAULT_INSTANCE_SETTINGS, updatedAt: null };
      }

      return {
        selfRegistrationEnabled: row.selfRegistrationEnabled,
        updatedAt: row.updatedAt,
      };
    },

    async save(input, updatedById) {
      await db
        .insert(instanceSettings)
        .values({
          id: SINGLETON_ID,
          selfRegistrationEnabled: input.selfRegistrationEnabled,
          updatedAt: new Date(),
          updatedById,
        })
        .onConflictDoUpdate({
          target: instanceSettings.id,
          set: {
            selfRegistrationEnabled: input.selfRegistrationEnabled,
            updatedAt: new Date(),
            updatedById,
          },
        });
    },
  };
}

export interface InstanceSettingsDependencies {
  readonly repository: InstanceSettingsRepository;
}

export function createInstanceSettingsService(
  deps: InstanceSettingsDependencies,
): InstanceSettingsService {
  function toDto(
    actor: PermissionActor,
    record: { selfRegistrationEnabled: boolean; updatedAt: Date | null },
  ): InstanceSettingsDto {
    return {
      selfRegistrationEnabled: record.selfRegistrationEnabled,
      updatedAt: record.updatedAt?.toISOString() ?? null,
      permissions: { canEdit: hasPermission(actor, 'user.manage') },
    };
  }

  function requireUserManage(actor: PermissionActor): void {
    if (!hasPermission(actor, 'user.manage')) {
      throw new AdminError('PERMISSION_DENIED');
    }
  }

  return {
    async get(actor) {
      requireUserManage(actor);

      return toDto(actor, await deps.repository.load());
    },

    async set(actor, input, actorUserId) {
      requireUserManage(actor);

      await deps.repository.save(input, actorUserId);

      return toDto(actor, await deps.repository.load());
    },

    async selfRegistrationEnabled() {
      return (await deps.repository.load()).selfRegistrationEnabled;
    },
  };
}
