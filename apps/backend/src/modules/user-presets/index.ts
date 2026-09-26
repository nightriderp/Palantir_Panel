/**
 * Eigene Profile: Dienst und Port-Beschreibungen (Idee P / A2, 26.09.2026).
 *
 * Ein Profil gehört genau einem Konto. Fremde Profile gibt es für den Dienst
 * nicht – ein fremdes antwortet wie ein fehlendes (`USER_PRESET_NOT_FOUND`),
 * damit niemand erfährt, dass es existiert.
 *
 * Die Werte prüft derselbe Weg wie die Live-Steuerung (`pruefeLiveWerte`): nur
 * Felder, die ein Spiel live ändern lässt, nur zulässige Werte. Ein Profil
 * kann damit nichts, was die Steuerung nicht auch könnte.
 */

import {
  type GameConfigValues,
  type GameTypeDefinition,
  USER_PRESET_LIMIT,
  type UserPresetDto,
} from '@palantir/contracts';
import {
  type CreateUserPresetInput,
  type UpdateUserPresetInput,
  type UserPresetQuery,
} from '@palantir/validation';
import { isUniqueViolation } from '../../db/errors.js';
import { pruefeLiveWerte } from '../server-orchestration/live-controls.js';
import { UserPresetError } from './errors.js';

export { UserPresetError, isUserPresetError } from './errors.js';

export interface UserPresetRecord {
  readonly id: string;
  readonly userId: string;
  readonly gameType: string;
  readonly name: string;
  readonly values: GameConfigValues;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface UserPresetRepository {
  listByUser(userId: string, gameType: string): Promise<UserPresetRecord[]>;
  countByUser(userId: string, gameType: string): Promise<number>;
  findById(id: string): Promise<UserPresetRecord | null>;
  create(input: {
    userId: string;
    gameType: string;
    name: string;
    values: GameConfigValues;
  }): Promise<UserPresetRecord>;
  update(
    id: string,
    changes: { name?: string; values?: GameConfigValues; updatedAt: Date },
  ): Promise<UserPresetRecord | null>;
  delete(id: string): Promise<boolean>;
}

export interface UserPresetService {
  listOwn(userId: string, query: UserPresetQuery): Promise<UserPresetDto[]>;
  create(userId: string, input: CreateUserPresetInput): Promise<UserPresetDto>;
  update(userId: string, id: string, input: UpdateUserPresetInput): Promise<UserPresetDto>;
  remove(userId: string, id: string): Promise<void>;
}

export interface UserPresetDependencies {
  readonly repository: UserPresetRepository;
  /** Spieltyp aus der Registry; `null`, wenn es ihn nicht gibt. */
  readonly findGameType: (id: string) => GameTypeDefinition | null;
  readonly now?: () => Date;
}

export function toUserPresetDto(record: UserPresetRecord): UserPresetDto {
  return {
    id: record.id,
    gameType: record.gameType,
    name: record.name,
    values: { ...record.values },
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    // Der Dienst gibt nur eigene Profile heraus.
    permissions: { canEdit: true, canDelete: true },
  };
}

export function createUserPresetService(deps: UserPresetDependencies): UserPresetService {
  const now = deps.now ?? (() => new Date());

  function werte(gameType: string, eingabe: GameConfigValues): GameConfigValues {
    const definition = deps.findGameType(gameType);

    if (definition === null) {
      throw new UserPresetError('VALIDATION_FAILED', `Den Spieltyp „${gameType}“ gibt es nicht.`);
    }

    try {
      return pruefeLiveWerte(definition, eingabe);
    } catch (error) {
      // Dieselbe Meldung wie in der Steuerung („… lässt sich nicht live ändern“).
      throw new UserPresetError(
        'VALIDATION_FAILED',
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  async function eigenes(userId: string, id: string): Promise<UserPresetRecord> {
    const record = await deps.repository.findById(id);

    if (record === null || record.userId !== userId) {
      throw new UserPresetError('USER_PRESET_NOT_FOUND');
    }

    return record;
  }

  async function mitEindeutigemNamen<T>(arbeit: () => Promise<T>): Promise<T> {
    try {
      return await arbeit();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new UserPresetError('USER_PRESET_NAME_TAKEN');
      }

      throw error;
    }
  }

  return {
    async listOwn(userId, query) {
      const liste = await deps.repository.listByUser(userId, query.gameType);

      return liste.map(toUserPresetDto);
    },

    async create(userId, input) {
      const values = werte(input.gameType, input.values);

      if ((await deps.repository.countByUser(userId, input.gameType)) >= USER_PRESET_LIMIT) {
        throw new UserPresetError('USER_PRESET_LIMIT_REACHED');
      }

      const record = await mitEindeutigemNamen(() =>
        deps.repository.create({ userId, gameType: input.gameType, name: input.name, values }),
      );

      return toUserPresetDto(record);
    },

    async update(userId, id, input) {
      const record = await eigenes(userId, id);
      const values = input.values === undefined ? undefined : werte(record.gameType, input.values);

      const neu = await mitEindeutigemNamen(() =>
        deps.repository.update(id, {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(values === undefined ? {} : { values }),
          updatedAt: now(),
        }),
      );

      if (neu === null) {
        throw new UserPresetError('USER_PRESET_NOT_FOUND');
      }

      return toUserPresetDto(neu);
    },

    async remove(userId, id) {
      await eigenes(userId, id);

      if (!(await deps.repository.delete(id))) {
        throw new UserPresetError('USER_PRESET_NOT_FOUND');
      }
    },
  };
}
