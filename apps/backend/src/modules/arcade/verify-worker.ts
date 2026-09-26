/**
 * Worker-Einstieg für das Nachrechnen (siehe `verifier.ts`).
 *
 * Läuft in einem eigenen `worker_threads`-Faden: Ein Bot-Zug auf Stufe
 * „schwer" braucht Rechenzeit, und eine Schachpartie mit achtzig davon hielte
 * den Event-Loop des Backends sonst sekundenlang an. Der Faden kennt nur das
 * echte Register – Tests mit Mini-Spielen rechnen direkt (`verify.ts`).
 */

import { parentPort } from 'node:worker_threads';
import { type ArcadeVerifyRequest, defaultArcadeRegistry, verifyArcadeRun } from './verify.js';

interface WorkerJob {
  id: number;
  request: ArcadeVerifyRequest;
}

parentPort?.on('message', (job: WorkerJob) => {
  const result = verifyArcadeRun(defaultArcadeRegistry, job.request);

  parentPort?.postMessage({ id: job.id, result });
});
