import { type ApiResponse, ok } from '@palantir/contracts';
import type { FastifyInstance } from 'fastify';

interface HealthPayload {
  status: 'ok';
  service: 'backend';
}

/**
 * Minimaler Health-Endpunkt für Reverse-Proxy und Container-Healthcheck.
 *
 * Das Antwortformat kommt aus `@palantir/contracts` (Pflichtenheft §5.1) –
 * kein lokal geformter Envelope (CLAUDE.md §3).
 */
export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (): Promise<ApiResponse<HealthPayload>> =>
    ok({ status: 'ok', service: 'backend' }),
  );
}
