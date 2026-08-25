import { env } from './config/env.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const app = await buildServer();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Backend wird beendet');
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: env.BACKEND_HOST, port: env.BACKEND_PORT });
}

main().catch((error: unknown) => {
  console.error('Backend konnte nicht gestartet werden:', error);
  process.exit(1);
});
