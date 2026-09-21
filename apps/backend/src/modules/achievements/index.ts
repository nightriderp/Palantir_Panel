/**
 * Erfolge, Titel und Stufen (Betreiber-Wunsch 21.09.2026).
 *
 * Öffentliche Schnittstelle des Moduls: der Service, seine Drizzle-Umsetzung
 * und die Routen-Registrierung.
 *
 * **Warum ein eigenes Modul und kein Anbau an B8 (Audit) oder F8 (Arcade).**
 * Das Modul hört auf beide – auf protokollierte Vorgänge und auf abgeschickte
 * Spielergebnisse – und gehört deshalb in keines von beiden hinein. Die
 * Richtung bleibt so eindeutig: Audit und Arcade wissen nichts von Abzeichen,
 * sie melden nur, dass etwas geschehen ist (`server.ts` verbindet beides). Ein
 * Anbau hätte die umgekehrte Abhängigkeit gebraucht – das Audit-Log, das
 * Abzeichen kennt.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '../../db/index.js';
import { createDrizzleAchievementRepository } from './repository.js';
import { registerAchievementRoutes } from './routes.js';
import { type AchievementService, createAchievementService } from './service.js';

export { AchievementError } from './errors.js';
export {
  type AchievementQueries,
  type AchievementRepository,
  type AuditCountFilter,
  type UnlockedAchievement,
  createDrizzleAchievementRepository,
} from './repository.js';
export {
  ACHIEVEMENT_RULES,
  type AchievementRule,
  type AchievementTrigger,
  type RuleContext,
  rulesForArcadeScore,
  rulesForAuditAction,
  stundeInInstanzZeit,
} from './rules.js';
export {
  type AchievementLogger,
  type AchievementService,
  type AchievementServiceOptions,
  createAchievementService,
} from './service.js';
export { type AchievementRoutesOptions, registerAchievementRoutes } from './routes.js';

export interface AchievementModuleOptions {
  readonly db: Database;
  /** Konto-Id des Aufrufers (Arbeitspaket B1). */
  resolveUserId(request: FastifyRequest): string | null;
}

/**
 * Baut den Erfolgs-Service und hängt seine Routen ein.
 *
 * Der Logger kommt von Fastify: Fehler beim Vergeben werden verschluckt (der
 * auslösende Vorgang darf nicht daran scheitern), sollen aber nicht spurlos
 * verschwinden.
 */
export async function registerAchievements(
  app: FastifyInstance,
  options: AchievementModuleOptions,
): Promise<AchievementService> {
  const achievements = createAchievementService({
    repository: createDrizzleAchievementRepository(options.db),
    logger: app.log,
  });

  await app.register(
    registerAchievementRoutes({ achievements, resolveUserId: options.resolveUserId }),
  );

  return achievements;
}
