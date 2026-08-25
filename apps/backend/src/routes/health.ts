import type { FastifyInstance } from 'fastify';

/**
 * Minimaler Health-Endpunkt für Reverse-Proxy und Container-Healthcheck.
 *
 * Das Antwortformat folgt dem Response-Envelope aus Pflichtenheft §5.1.
 * TODO(contracts): Sobald `@palantir/contracts` den Envelope-Typ und den
 * Fehlercode-Katalog bereitstellt, wird hier der Typ von dort importiert statt
 * lokal geformt (CLAUDE.md §3 – keine Parallelstrukturen).
 */
export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    success: true,
    data: { status: 'ok', service: 'backend' },
    error: null,
  }));
}
