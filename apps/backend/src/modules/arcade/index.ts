/**
 * F8 – Spielhalle (Pflichtenheft §17, Lastenheft §3.9; Neubau 26.09.2026).
 *
 * Öffentliche Schnittstelle des Backend-Teils:
 *
 *  - **Bestenliste** mit nachgerechneten Einsendungen (`service.ts`,
 *    `verify.ts`, `verifier.ts`): Startwert ausgeben, Band bzw. Züge im Worker
 *    nachspielen, nur den errechneten Stand speichern.
 *  - **Online-Räume** der rundenbasierten Spiele (`rooms*.ts`): Der Server ist
 *    Schiedsrichter, Computergegner zieht der Bot-Läufer (`bot-runner.ts`),
 *    Änderungen meldet der Live-Kanal `/arcade/live` (`live.ts`).
 *  - **Musik** je Spiel (`tracks*.ts`).
 *
 * Die Spielregeln selbst liegen in `@palantir/arcade` und laufen im Browser
 * wie hier.
 */

import type { ArcadeGameId } from '@palantir/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '../../db/index.js';
import { createArcadeBotRunner } from './bot-runner.js';
import { ArcadeLiveHub, registerArcadeLiveRoute } from './live.js';
import { createDrizzleArcadeRepository } from './repository.js';
import { createDrizzleArcadeRoomRepository } from './rooms-repository.js';
import { type ArcadeRoomService, createArcadeRoomService } from './rooms-service.js';
import { registerArcadeRoomRoutes } from './rooms-routes.js';
import { registerArcadeRoutes } from './routes.js';
import { type ArcadeService, createArcadeService } from './service.js';
import { createDrizzleArcadeTrackRepository } from './tracks-repository.js';
import { registerArcadeTrackRoutes } from './tracks-routes.js';
import { createArcadeTrackService } from './tracks.js';
import { createArcadeVerifier } from './verifier.js';

export { ArcadeError } from './errors.js';
export {
  type ArcadeLeaderboardRow,
  type ArcadePersonalRow,
  type ArcadeQueries,
  type ArcadeRepository,
  type InsertArcadeScore,
  createDrizzleArcadeRepository,
} from './repository.js';
export { type ArcadeService, type ArcadeServiceOptions, createArcadeService } from './service.js';
export { type ArcadeRoutesOptions, registerArcadeRoutes } from './routes.js';
export { ArcadeLiveHub } from './live.js';
export { ARCADE_LIVE_CLOSE_CODE_UNAUTHORIZED } from '@palantir/contracts';
export { type ArcadeRoomService } from './rooms-service.js';

/** Takt für Aufräumen und Fortsetzen der Online-Räume. */
const MAINTENANCE_INTERVAL_MS = 60_000;

export interface ArcadeModuleOptions {
  readonly db: Database;
  /** Konto-Id des Aufrufers (Arbeitspaket B1). */
  resolveUserId(request: FastifyRequest): string | null;
  /** Konto samt Anzeigename (Räume, Chat). */
  resolveViewer(request: FastifyRequest): { id: string; displayName: string } | null;
  /** Freischaltung für den Live-Kanal; im Zweifel zu. */
  isApproved(request: FastifyRequest): boolean;
  /** Wiederkehrende Sitzungsprüfung am Live-Kanal. */
  isSessionValid?(request: FastifyRequest): Promise<boolean>;
  /** Panel-Adresse für die Herkunftsprüfung des WebSocket-Handshakes. */
  readonly allowedOrigin?: string;
  /**
   * Anschluss an das Erfolgs-Modul (Betreiber-Wunsch 21.09.2026) – gerufen
   * nach jedem gespeicherten Ergebnis.
   */
  readonly onScoreSubmitted?: (userId: string, gameId: ArcadeGameId) => void;
}

export interface ArcadeModule {
  readonly arcade: ArcadeService;
  readonly rooms: ArcadeRoomService;
  readonly hub: ArcadeLiveHub;
}

/**
 * Baut die Dienste der Spielhalle und hängt ihre Routen ein.
 *
 * Der Takt der Räume startet erst mit `onReady` (nicht beim bloßen Aufbau):
 * Der Routen-Abgleich in `rbac/routen-rechte.test.ts` baut den Server ohne
 * erreichbare Datenbank auf und darf dabei keine Abfrage auslösen.
 */
export async function registerArcade(
  app: FastifyInstance,
  options: ArcadeModuleOptions,
): Promise<ArcadeModule> {
  const verifier = createArcadeVerifier({ logger: app.log });
  const arcade = createArcadeService({
    repository: createDrizzleArcadeRepository(options.db),
    verifier,
    logger: app.log,
    ...(options.onScoreSubmitted ? { onScoreSubmitted: options.onScoreSubmitted } : {}),
  });
  const hub = new ArcadeLiveHub();
  // Läufer und Dienst kennen sich gegenseitig; der Läufer kommt nach.
  let schedule: (roomId: string) => void = () => undefined;
  const rooms = createArcadeRoomService({
    repository: createDrizzleArcadeRoomRepository(options.db),
    live: hub,
    recordResults: (results) => arcade.recordRoomResults(results),
    scheduleBot: (roomId) => {
      schedule(roomId);
    },
    logger: app.log,
  });
  const runner = createArcadeBotRunner({
    step: (roomId) => rooms.botStep(roomId),
    logger: app.log,
  });
  schedule = (roomId) => {
    runner.schedule(roomId);
  };
  const tracks = createArcadeTrackService(createDrizzleArcadeTrackRepository(options.db));

  await app.register(registerArcadeRoutes({ arcade, resolveUserId: options.resolveUserId }));
  await app.register(registerArcadeRoomRoutes({ rooms, resolveViewer: options.resolveViewer }));
  await app.register(registerArcadeTrackRoutes({ tracks, resolveUserId: options.resolveUserId }));
  registerArcadeLiveRoute(app, {
    hub,
    resolveUserId: options.resolveUserId,
    isApproved: options.isApproved,
    ...(options.isSessionValid ? { isSessionValid: options.isSessionValid } : {}),
    ...(options.allowedOrigin === undefined ? {} : { allowedOrigin: options.allowedOrigin }),
  });

  let takt: ReturnType<typeof setInterval> | null = null;

  const pflegen = (): void => {
    rooms.maintain().catch((error: unknown) => {
      app.log.warn({ err: error }, 'Arcade: Pflege der Online-Räume ist gescheitert.');
    });
  };

  app.addHook('onReady', async () => {
    // Beim Start: Räume, in denen ein Computer am Zug war, laufen weiter.
    pflegen();
    takt = setInterval(pflegen, MAINTENANCE_INTERVAL_MS);
    takt.unref();
  });

  app.addHook('onClose', async () => {
    if (takt) clearInterval(takt);
    runner.stop();
    await verifier.close();
  });

  return { arcade, rooms, hub };
}
