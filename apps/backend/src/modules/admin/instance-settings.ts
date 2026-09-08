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
 *
 * **Seit S-2 stehen hier auch die gewählten Schriften** (`uiFontId`,
 * `monospaceFontId`). Sie werden gegen den Bestand geprüft, bevor sie
 * gespeichert werden; die Schriften selbst verwaltet `modules/fonts`.
 */

import { type InstanceSettingsDto } from '@palantir/contracts';
import { type InstanceSettingsInput } from '@palantir/validation';
import { eq } from 'drizzle-orm';
import { type DbConnection } from '../../db/client.js';
import { instanceSettings } from '../../db/schema.js';
import { hasPermission, type PermissionActor } from '../rbac/index.js';
import { type AuditService, entryFor } from './audit.js';
import { type AdminContext } from './context.js';
import { AdminError } from './errors.js';

/** Die eine Zeile; der Wert hat keine Bedeutung außer „diese eine". */
const SINGLETON_ID = 1;

/** Vorgaben, solange nichts gesetzt wurde. */
export const DEFAULT_INSTANCE_SETTINGS = Object.freeze({
  selfRegistrationEnabled: true,
  /** `null` heißt „Vorgabe des Design-Systems", nicht „irgendeine Schrift". */
  uiFontId: null,
  monospaceFontId: null,
});

/** Der gespeicherte Zustand – vollständig, nie eine Teilmenge. */
export interface InstanceSettingsRecord {
  readonly selfRegistrationEnabled: boolean;
  readonly uiFontId: string | null;
  readonly monospaceFontId: string | null;
  readonly updatedAt: Date | null;
}

/** Was geschrieben wird: der vollständige neue Zustand. */
export type InstanceSettingsSaveData = Omit<InstanceSettingsRecord, 'updatedAt'>;

export interface InstanceSettingsRepository {
  load(): Promise<InstanceSettingsRecord>;
  save(data: InstanceSettingsSaveData, updatedById: string | null): Promise<void>;
}

/**
 * Prüfung, ob es eine Schrift zu einer Kennung gibt (S-2).
 *
 * Bewusst ein schmaler Port und keine Abhängigkeit auf das ganze
 * Schriften-Modul: Die Einstellungen brauchen von ihm genau diese eine Frage.
 * Die Gegenrichtung – „ist diese Schrift gerade gewählt?" – läuft über
 * {@link InstanceSettingsService.selectedFontIds}.
 */
export interface FontDirectory {
  exists(fontId: string): Promise<boolean>;
}

export interface InstanceSettingsService {
  /** Einstellungen samt Rechteblock – verlangt `user.manage`. */
  get(actor: PermissionActor): Promise<InstanceSettingsDto>;
  set(ctx: AdminContext, input: InstanceSettingsInput): Promise<InstanceSettingsDto>;
  /**
   * Nimmt die Instanz Selbstregistrierungen an?
   *
   * Ohne Rechteprüfung: Diese Frage stellt die Registrierung selbst, und die
   * hat naturgemäß keine Sitzung.
   */
  selfRegistrationEnabled(): Promise<boolean>;
  /**
   * Die gerade gewählten Schrift-Kennungen (ohne `null`).
   *
   * Ebenfalls ohne Rechteprüfung: Die Frage stellt der Löschschutz des
   * Schriften-Moduls, nicht ein Aufrufer von außen.
   */
  selectedFontIds(): Promise<readonly string[]>;
  /**
   * Dieselbe Auswahl, aber **je Rolle** – für das erzeugte Stylesheet (S-3).
   *
   * Ebenfalls ohne Rechteprüfung, und aus demselben Grund: Welche Schrift die
   * Oberfläche benutzt, sieht ohnehin jeder, der sie aufruft. Die Route, die
   * daraus CSS macht, ist bewusst ohne Sitzung erreichbar – sonst stünde die
   * Anmeldeseite ohne die Schrift der Instanz da.
   */
  selectedFontRoles(): Promise<{ uiFontId: string | null; monospaceFontId: string | null }>;
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
        uiFontId: row.uiFontId,
        monospaceFontId: row.monospaceFontId,
        updatedAt: row.updatedAt,
      };
    },

    async save(data, updatedById) {
      const werte = {
        selfRegistrationEnabled: data.selfRegistrationEnabled,
        uiFontId: data.uiFontId,
        monospaceFontId: data.monospaceFontId,
        updatedAt: new Date(),
        updatedById,
      };

      await db
        .insert(instanceSettings)
        .values({ id: SINGLETON_ID, ...werte })
        .onConflictDoUpdate({ target: instanceSettings.id, set: werte });
    },
  };
}

export interface InstanceSettingsDependencies {
  readonly repository: InstanceSettingsRepository;
  /**
   * Bestand der Schriften (S-2). Ohne diesen Anschluss lässt sich keine Schrift
   * auswählen – jede Kennung gilt dann als unbekannt (`FONT_NOT_FOUND`). Das
   * ist die sichere Vorgabe: Eine ungeprüft gespeicherte Kennung ließe die
   * Oberfläche auf eine Schrift zeigen, die es nicht gibt.
   */
  readonly fonts?: FontDirectory;
  /**
   * Audit-Log (Pflichtenheft §6). Das Ab- und Anschalten der Selbstregistrierung
   * und der Wechsel der Schriften sind instanzweite Änderungen;
   * `updated_by_id` hält nur den **letzten** Änderer, nicht die Historie.
   */
  readonly audit?: AuditService;
}

export function createInstanceSettingsService(
  deps: InstanceSettingsDependencies,
): InstanceSettingsService {
  function toDto(actor: PermissionActor, record: InstanceSettingsRecord): InstanceSettingsDto {
    return {
      selfRegistrationEnabled: record.selfRegistrationEnabled,
      uiFontId: record.uiFontId,
      monospaceFontId: record.monospaceFontId,
      updatedAt: record.updatedAt?.toISOString() ?? null,
      permissions: { canEdit: hasPermission(actor, 'user.manage') },
    };
  }

  function requireUserManage(actor: PermissionActor): void {
    if (!hasPermission(actor, 'user.manage')) {
      throw new AdminError('PERMISSION_DENIED');
    }
  }

  /**
   * Wendet ein Schrift-Feld der Eingabe an.
   *
   * Drei Fälle, wie im Vertrag beschrieben: Feld fehlt → unverändert;
   * ausdrückliches `null` → zurück auf die Vorgabe; eine Kennung → sie muss
   * existieren, sonst `FONT_NOT_FOUND`.
   */
  async function schriftUebernehmen(
    bisher: string | null,
    eingabe: string | null | undefined,
  ): Promise<string | null> {
    if (eingabe === undefined) {
      return bisher;
    }

    if (eingabe === null) {
      return null;
    }

    if (!(await (deps.fonts?.exists(eingabe) ?? Promise.resolve(false)))) {
      throw new AdminError('FONT_NOT_FOUND');
    }

    return eingabe;
  }

  return {
    async get(actor) {
      requireUserManage(actor);

      return toDto(actor, await deps.repository.load());
    },

    async set(ctx, input) {
      requireUserManage(ctx.actor);

      const bisher = await deps.repository.load();
      const neu: InstanceSettingsSaveData = {
        selfRegistrationEnabled: input.selfRegistrationEnabled,
        uiFontId: await schriftUebernehmen(bisher.uiFontId, input.uiFontId),
        monospaceFontId: await schriftUebernehmen(bisher.monospaceFontId, input.monospaceFontId),
      };

      await deps.repository.save(neu, ctx.userId);

      /*
       * Ein Eintrag für die ganze Änderung, nicht je Feld (siehe
       * `AUDIT_TARGET_TYPES` im Vertrag): Die Auswahl einer Schrift ist eine
       * geänderte Instanz-Einstellung, keine Änderung an der Schrift. Die
       * Metadaten nennen nur die Felder, die sich tatsächlich bewegt haben –
       * sonst stünde bei jedem Speichern derselbe Block im Log.
       */
      const geaendert: Record<string, unknown> = {};

      if (neu.selfRegistrationEnabled !== bisher.selfRegistrationEnabled) {
        geaendert.selfRegistrationEnabled = neu.selfRegistrationEnabled;
      }

      if (neu.uiFontId !== bisher.uiFontId) {
        geaendert.uiFontId = neu.uiFontId;
      }

      if (neu.monospaceFontId !== bisher.monospaceFontId) {
        geaendert.monospaceFontId = neu.monospaceFontId;
      }

      if (deps.audit && Object.keys(geaendert).length > 0) {
        await deps.audit.record(
          entryFor(ctx, {
            action: 'instance.settingsChanged',
            targetType: 'instanceSettings',
            targetId: null,
            metadata: geaendert,
          }),
        );
      }

      return toDto(ctx.actor, await deps.repository.load());
    },

    async selfRegistrationEnabled() {
      return (await deps.repository.load()).selfRegistrationEnabled;
    },

    async selectedFontIds() {
      const { uiFontId, monospaceFontId } = await deps.repository.load();

      return [uiFontId, monospaceFontId].filter((id): id is string => id !== null);
    },

    async selectedFontRoles() {
      const { uiFontId, monospaceFontId } = await deps.repository.load();

      return { uiFontId, monospaceFontId };
    },
  };
}
