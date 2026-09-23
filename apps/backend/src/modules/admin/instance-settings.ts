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
import { hasAnyPermission, hasPermission, type PermissionActor } from '../rbac/index.js';
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
  /** Ohne Angabe bietet die Instanz jeden Spieltyp ihrer Ausbaustufe an. */
  disabledGameTypes: [] as readonly string[],
  /** Ohne Angabe holt jeder Server beim Start sein Update wie bisher. */
  heldUpdateGameTypes: [] as readonly string[],
  /** Ohne Angabe bietet die Instanz jede mitgelieferte Schrift an. */
  hiddenBundledFonts: [] as readonly string[],
});

/** Der gespeicherte Zustand – vollständig, nie eine Teilmenge. */
export interface InstanceSettingsRecord {
  readonly selfRegistrationEnabled: boolean;
  readonly uiFontId: string | null;
  readonly monospaceFontId: string | null;
  readonly disabledGameTypes: readonly string[];
  readonly heldUpdateGameTypes: readonly string[];
  readonly hiddenBundledFonts: readonly string[];
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
  /** Einstellungen samt Rechteblock – verlangt `instance.manage` oder `gametype.manage`. */
  get(actor: PermissionActor): Promise<InstanceSettingsDto>;
  set(ctx: AdminContext, input: InstanceSettingsInput): Promise<InstanceSettingsDto>;
  /**
   * Nimmt die Instanz Selbstregistrierungen an?
   *
   * Ohne Rechteprüfung: Diese Frage stellt die Registrierung selbst, und die
   * hat naturgemäß keine Sitzung.
   */
  selfRegistrationEnabled(): Promise<boolean>;
  /** Ausgeschaltete Spieltypen – für den Stand beim Hochfahren. */
  disabledGameTypes(): Promise<readonly string[]>;
  /** Spieltypen mit zurückgehaltenen Updates – für den Stand beim Hochfahren. */
  heldUpdateGameTypes(): Promise<readonly string[]>;
  /** Mitgelieferte Schriften, die die Instanz nicht mehr anbietet. */
  hiddenBundledFontIds(): Promise<readonly string[]>;
  /** Eine mitgelieferte Schrift aus dem Angebot nehmen (`true`) oder zurückholen. */
  setBundledFontHidden(id: string, hidden: boolean, actorId: string | null): Promise<void>;
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
        disabledGameTypes: row.disabledGameTypes,
        heldUpdateGameTypes: row.heldUpdateGameTypes,
        hiddenBundledFonts: row.hiddenBundledFonts,
        updatedAt: row.updatedAt,
      };
    },

    async save(data, updatedById) {
      const werte = {
        selfRegistrationEnabled: data.selfRegistrationEnabled,
        uiFontId: data.uiFontId,
        monospaceFontId: data.monospaceFontId,
        disabledGameTypes: [...data.disabledGameTypes],
        heldUpdateGameTypes: [...data.heldUpdateGameTypes],
        hiddenBundledFonts: [...data.hiddenBundledFonts],
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
  /**
   * Wird gerufen, nachdem die Liste der abgeschalteten Spieltypen gespeichert
   * wurde.
   *
   * Der Empfänger ist die Spiele-Registry (`GameRegistry.setDisabledGameTypes`).
   * Sie ist synchron und liest die Einstellung nicht selbst; wer sie ändert,
   * sagt es ihr. Ohne den Anschluss bleibt der Schalter wirkungslos, bis das
   * Backend neu startet – deshalb ist er in `server.ts` gesetzt und hier nur
   * optional, damit ein Test die Einstellungen ohne Registry prüfen kann.
   */
  readonly onDisabledGameTypesChanged?: (ids: readonly string[]) => void;
  /**
   * Dasselbe für die Spieltypen mit zurückgehaltenen Updates
   * (`GameRegistry.setHeldUpdateGameTypes`). Ohne den Anschluss wirkte der
   * Schalter erst nach einem Neustart des Backends.
   */
  readonly onHeldUpdateGameTypesChanged?: (ids: readonly string[]) => void;
}

/**
 * Wer die Einstellungen lesen und schreiben darf (Fundpunkt 345).
 *
 * Zwei Rechte teilen sich einen Datensatz: `instance.manage` für
 * Selbstregistrierung und Schriften, `gametype.manage` für das Spieleangebot
 * (Templates). Welche Felder wer ändern darf, prüft `set` je Feld.
 */
const SETTINGS_PERMISSIONS = ['instance.manage', 'gametype.manage'] as const;

export function createInstanceSettingsService(
  deps: InstanceSettingsDependencies,
): InstanceSettingsService {
  function toDto(actor: PermissionActor, record: InstanceSettingsRecord): InstanceSettingsDto {
    return {
      selfRegistrationEnabled: record.selfRegistrationEnabled,
      uiFontId: record.uiFontId,
      monospaceFontId: record.monospaceFontId,
      disabledGameTypes: record.disabledGameTypes,
      heldUpdateGameTypes: record.heldUpdateGameTypes,
      updatedAt: record.updatedAt?.toISOString() ?? null,
      permissions: { canEdit: hasAnyPermission(actor, SETTINGS_PERMISSIONS) },
    };
  }

  function requireSettingsAccess(actor: PermissionActor): void {
    if (!hasAnyPermission(actor, SETTINGS_PERMISSIONS)) {
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
      requireSettingsAccess(actor);

      return toDto(actor, await deps.repository.load());
    },

    async set(ctx, input) {
      requireSettingsAccess(ctx.actor);

      const bisher = await deps.repository.load();
      const neu: InstanceSettingsSaveData = {
        selfRegistrationEnabled: input.selfRegistrationEnabled,
        uiFontId: await schriftUebernehmen(bisher.uiFontId, input.uiFontId),
        monospaceFontId: await schriftUebernehmen(bisher.monospaceFontId, input.monospaceFontId),
        /*
         * Fehlt das Feld, bleibt es, wie es war – wie bei den Schriften. Ein
         * älterer Aufrufer, der die Liste nicht kennt, schaltet damit nicht
         * versehentlich alles wieder ein.
         *
         * Sortiert und ohne Dubletten, damit der Vergleich unten nicht auf
         * eine geänderte Reihenfolge anspringt.
         */
        disabledGameTypes:
          input.disabledGameTypes === undefined
            ? bisher.disabledGameTypes
            : [...new Set(input.disabledGameTypes)].sort(),
        // Dieselbe Regel für die zurückgehaltenen Updates.
        heldUpdateGameTypes:
          input.heldUpdateGameTypes === undefined
            ? bisher.heldUpdateGameTypes
            : [...new Set(input.heldUpdateGameTypes)].sort(),
        // Dieselbe Regel für die ausgeblendeten Schriften: Fehlt das Feld,
        // bleibt es, wie es war.
        hiddenBundledFonts:
          input.hiddenBundledFonts === undefined
            ? bisher.hiddenBundledFonts
            : [...new Set(input.hiddenBundledFonts)].sort(),
      };

      /*
       * Der Körper trägt immer den ganzen Stand (PUT). Geprüft wird deshalb,
       * was sich **bewegt**: Wer nur das Spieleangebot verwaltet, schickt die
       * Selbstregistrierung unverändert mit und darf das auch.
       */
      const liste = (werte: readonly string[]) => [...werte].sort().join(',');
      const instanzGeaendert =
        neu.selfRegistrationEnabled !== bisher.selfRegistrationEnabled ||
        neu.uiFontId !== bisher.uiFontId ||
        neu.monospaceFontId !== bisher.monospaceFontId ||
        liste(neu.hiddenBundledFonts) !== liste(bisher.hiddenBundledFonts);
      const angebotGeaendert =
        liste(neu.disabledGameTypes) !== liste(bisher.disabledGameTypes) ||
        liste(neu.heldUpdateGameTypes) !== liste(bisher.heldUpdateGameTypes);

      if (
        (instanzGeaendert && !hasPermission(ctx.actor, 'instance.manage')) ||
        (angebotGeaendert && !hasPermission(ctx.actor, 'gametype.manage'))
      ) {
        throw new AdminError('PERMISSION_DENIED');
      }

      await deps.repository.save(neu, ctx.userId);

      // Die Registry ist synchron und liest die Einstellung nicht selbst
      // (siehe `GameRegistry.setDisabledGameTypes`); wer sie ändert, sagt es
      // ihr.
      deps.onDisabledGameTypesChanged?.(neu.disabledGameTypes);
      deps.onHeldUpdateGameTypesChanged?.(neu.heldUpdateGameTypes);

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

      if (neu.disabledGameTypes.join(',') !== [...bisher.disabledGameTypes].sort().join(',')) {
        geaendert.disabledGameTypes = neu.disabledGameTypes;
      }

      if (neu.heldUpdateGameTypes.join(',') !== [...bisher.heldUpdateGameTypes].sort().join(',')) {
        geaendert.heldUpdateGameTypes = neu.heldUpdateGameTypes;
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

    async disabledGameTypes() {
      return (await deps.repository.load()).disabledGameTypes;
    },

    async heldUpdateGameTypes() {
      return (await deps.repository.load()).heldUpdateGameTypes;
    },

    async hiddenBundledFontIds() {
      return (await deps.repository.load()).hiddenBundledFonts;
    },

    /**
     * Eine mitgelieferte Schrift aus dem Angebot nehmen oder zurückholen
     * (Betreiber-Wunsch 20.09.2026).
     *
     * Ohne Prüfung gegen den Katalog: Den kennt dieses Modul nicht, und eine
     * Kennung, die es nicht gibt, blendet nichts aus. Geprüft hat der
     * Aufrufer – der Schriften-Dienst weiß, was es gibt und was gerade in
     * Benutzung ist.
     */
    async setBundledFontHidden(id, hidden, actorId) {
      const stand = await deps.repository.load();
      const vorher = new Set(stand.hiddenBundledFonts);

      if (hidden) {
        vorher.add(id);
      } else {
        vorher.delete(id);
      }

      await deps.repository.save(
        {
          selfRegistrationEnabled: stand.selfRegistrationEnabled,
          uiFontId: stand.uiFontId,
          monospaceFontId: stand.monospaceFontId,
          disabledGameTypes: stand.disabledGameTypes,
          heldUpdateGameTypes: stand.heldUpdateGameTypes,
          hiddenBundledFonts: [...vorher],
        },
        actorId,
      );
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
