/**
 * `GET /health` für den Docker-Healthcheck (`deploy/vps/docker-compose.yml`).
 *
 * Bis zum Review 2026-09-16 (Befund 8.8) antwortete die Route statisch mit
 * `ok`: Der Healthcheck erkannte nur einen toten Prozess, nicht ein Backend,
 * dessen Datenbankverbindung weg ist – und genau das ist der Zustand, in dem
 * jede Anfrage scheitert, während der Container „healthy" bleibt.
 *
 * Jetzt fragt die Route die Datenbank mit `SELECT 1` und knapper Frist. Ohne
 * Antwort kommt 503 mit derselben Hülle (Pflichtenheft §5.1), und Docker
 * startet nach den eingestellten Wiederholungen neu. Die Probe ist optional,
 * damit `buildServer()` in Tests ohne Datenbank gültig bleibt.
 */

import { type ApiResponse, fail, ok } from '@palantir/contracts';
import type { FastifyInstance } from 'fastify';

interface HealthPayload {
  status: 'ok';
  service: 'backend';
  /** `ok`, `failed` oder `skipped`, wenn keine Probe hinterlegt ist. */
  database: 'ok' | 'failed' | 'skipped';
}

export interface HealthRouteOptions {
  /** Wirft, wenn die Datenbank nicht antwortet. */
  readonly probeDatabase?: () => Promise<void>;
  /** Frist für die Probe; Vorgabe 2 s – der Healthcheck selbst wartet 5 s. */
  readonly probeTimeoutMs?: number;
}

export const HEALTH_PROBE_TIMEOUT_MS = 2_000;

export async function registerHealthRoutes(
  app: FastifyInstance,
  options: HealthRouteOptions = {},
): Promise<void> {
  const timeoutMs = options.probeTimeoutMs ?? HEALTH_PROBE_TIMEOUT_MS;

  async function datenbankAntwortet(): Promise<boolean> {
    const probe = options.probeDatabase;

    if (probe === undefined) {
      return true;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const frist = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });

    try {
      const ausgang = await Promise.race([probe().then(() => 'ok' as const), frist]);

      return ausgang === 'ok';
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  app.get('/health', async (_request, reply): Promise<ApiResponse<HealthPayload>> => {
    if (options.probeDatabase === undefined) {
      return ok({ status: 'ok', service: 'backend', database: 'skipped' });
    }

    if (await datenbankAntwortet()) {
      return ok({ status: 'ok', service: 'backend', database: 'ok' });
    }

    // 503 mit dem bestehenden Katalogcode: Ein eigener Code brächte dem
    // Healthcheck nichts, er liest nur den Status.
    reply.status(503);

    return fail('INTERNAL_ERROR', 'Die Datenbank antwortet nicht.');
  });
}
