import { env } from './config/env.js';
import { closeDb } from './db/client.js';
import { fireAndForget } from './lib/fire-and-forget.js';
import { createShutdownController, installProcessGuards } from './lib/shutdown.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const app = await buildServer();

  // Geordnetes Beenden mit Frist und Doppel-Signal-Schutz; die Prozess-Wächter
  // fangen unbehandelte Ablehnungen und Ausnahmen (Audit W0-5, `lib/shutdown.ts`).
  const beenden = createShutdownController({
    // Erst die Routen, dann der Pool: Bis zum Review 2026-09-16 (Befund 8.4)
    // blieb `pool.end()` beim Beenden aus, offene Verbindungen liefen in ihre
    // serverseitige Frist.
    close: async () => {
      await app.close();
      await closeDb();
    },
    log: app.log,
    exit: (code) => process.exit(code),
  });

  installProcessGuards({ log: app.log, shutdown: beenden.shutdown });

  const aufSignal = (signal: string): void => {
    fireAndForget(beenden.shutdown(signal), app.log, { vorgang: 'Beenden auf Signal', signal });
  };

  process.on('SIGINT', () => aufSignal('SIGINT'));
  process.on('SIGTERM', () => aufSignal('SIGTERM'));

  await app.listen({ host: env.BACKEND_HOST, port: env.BACKEND_PORT });
}

main().catch((error: unknown) => {
  console.error('Backend konnte nicht gestartet werden:', error);
  process.exit(1);
});
