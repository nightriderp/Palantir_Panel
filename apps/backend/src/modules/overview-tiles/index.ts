/**
 * Übersichts-Kacheln ohne Server (Betreiber-Wunsch 26.09.2026).
 *
 * Eine Kachel in der Übersicht, hinter der kein Server des Panels steht – ein
 * befreundeter Server auf einer fremden Instanz, ein Community-Discord. Ein
 * Administrator legt sie an, jedes freigeschaltete Konto sieht sie. Sie kann
 * nichts außer zeigen: Name, Spiel, Adresse, ein Link.
 *
 * Der Dienst ist bewusst klein: Prüfen tut `@palantir/validation`, Rechte
 * prüfen die Routen (`instance.manage`), und ob es das Spiel gibt, weiß die
 * Registry – der Dienst fragt nur nach.
 */

import { type ErrorCode, type OverviewTileDto } from '@palantir/contracts';
import { type CreateOverviewTileInput, type UpdateOverviewTileInput } from '@palantir/validation';
import { AppError } from '../../lib/app-error.js';
import { type PermissionActor, hasPermission } from '../rbac/index.js';

export class OverviewTileError extends AppError {
  constructor(code: ErrorCode, message?: string) {
    super(code, message);
    this.name = 'OverviewTileError';
  }
}

export function isOverviewTileError(error: unknown): error is OverviewTileError {
  return error instanceof OverviewTileError;
}

export interface OverviewTileRecord {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly gameTypeId: string | null;
  readonly gameLabel: string | null;
  readonly address: string | null;
  readonly linkUrl: string | null;
  readonly linkLabel: string | null;
  readonly sortOrder: number;
  readonly enabled: boolean;
  readonly createdById: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Felder, die beim Anlegen und Ändern geschrieben werden. */
export type OverviewTileFields = Omit<
  OverviewTileRecord,
  'id' | 'createdById' | 'createdAt' | 'updatedAt'
>;

export interface OverviewTileRepository {
  /** Alle Kacheln, sortiert nach `sortOrder`, dann Titel. */
  list(): Promise<OverviewTileRecord[]>;
  find(id: string): Promise<OverviewTileRecord | null>;
  create(input: OverviewTileFields & { createdById: string | null }): Promise<OverviewTileRecord>;
  /** `null`, wenn es die Kachel nicht (mehr) gibt. */
  update(id: string, fields: Partial<OverviewTileFields>): Promise<OverviewTileRecord | null>;
  remove(id: string): Promise<boolean>;
}

export interface OverviewTileService {
  list(actor: PermissionActor): Promise<OverviewTileDto[]>;
  create(
    actor: PermissionActor,
    actorUserId: string | null,
    input: CreateOverviewTileInput,
  ): Promise<OverviewTileDto>;
  update(
    actor: PermissionActor,
    id: string,
    input: UpdateOverviewTileInput,
  ): Promise<OverviewTileDto>;
  remove(id: string): Promise<void>;
}

export interface OverviewTileDependencies {
  readonly repository: OverviewTileRepository;
  /** Gibt es diesen Spieltyp im Katalog? Verhindert Kacheln mit Tippfehler im Spiel. */
  readonly kennt: (gameTypeId: string) => boolean;
}

/**
 * `permissions`-Objekt einer Kachel (Pflichtenheft §5.2).
 *
 * Beide Flags hängen an `instance.manage`: Die Kacheln sind Teil des
 * Erscheinungsbilds der Instanz, wie Schriften und Farbschema.
 */
export function overviewTilePermissions(actor: PermissionActor): OverviewTileDto['permissions'] {
  const darfVerwalten = hasPermission(actor, 'instance.manage');

  return { canEdit: darfVerwalten, canDelete: darfVerwalten };
}

export function toOverviewTileDto(
  record: OverviewTileRecord,
  actor: PermissionActor,
): OverviewTileDto {
  return {
    id: record.id,
    title: record.title,
    subtitle: record.subtitle,
    gameTypeId: record.gameTypeId,
    gameLabel: record.gameLabel,
    address: record.address,
    linkUrl: record.linkUrl,
    linkLabel: record.linkLabel,
    sortOrder: record.sortOrder,
    enabled: record.enabled,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    permissions: overviewTilePermissions(actor),
  };
}

export function createOverviewTileService(deps: OverviewTileDependencies): OverviewTileService {
  function requireGameType(gameTypeId: string | null | undefined): void {
    if (gameTypeId !== null && gameTypeId !== undefined && !deps.kennt(gameTypeId)) {
      throw new OverviewTileError('NOT_FOUND', 'Diesen Spieltyp gibt es nicht.');
    }
  }

  return {
    async list(actor) {
      const rows = await deps.repository.list();
      /*
       * Ausgeschaltete Kacheln bekommt nur, wer sie verwalten darf: Für alle
       * anderen gibt es sie nicht – sie tauchen weder in der Übersicht noch
       * in der Antwort auf.
       */
      const sichtbar = hasPermission(actor, 'instance.manage')
        ? rows
        : rows.filter((row) => row.enabled);

      return sichtbar.map((row) => toOverviewTileDto(row, actor));
    },

    async create(actor, actorUserId, input) {
      requireGameType(input.gameTypeId);

      const record = await deps.repository.create({ ...input, createdById: actorUserId });

      return toOverviewTileDto(record, actor);
    },

    async update(actor, id, input) {
      requireGameType(input.gameTypeId);

      const record = await deps.repository.update(id, input);

      if (record === null) {
        throw new OverviewTileError('NOT_FOUND', 'Diese Kachel gibt es nicht.');
      }

      return toOverviewTileDto(record, actor);
    },

    async remove(id) {
      const entfernt = await deps.repository.remove(id);

      if (!entfernt) {
        throw new OverviewTileError('NOT_FOUND', 'Diese Kachel gibt es nicht.');
      }
    },
  };
}
