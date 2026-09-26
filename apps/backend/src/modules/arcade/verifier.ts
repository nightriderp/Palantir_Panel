/**
 * Warteschlange fürs Nachrechnen in `worker_threads` (Neubau 26.09.2026).
 *
 * **Warum ein Worker:** Das Nachrechnen einer Partie gegen den Computer spielt
 * jeden Bot-Zug noch einmal – bei Schach auf Stufe „schwer" über achtzig Züge
 * sind das Sekunden reiner Rechenzeit. Im Hauptfaden stünde währenddessen das
 * ganze Backend (Konsole, Chat, Agent-Kanal). Der Worker nimmt die Last weg,
 * die Warteschlange begrenzt sie auf `concurrency` Fäden, und ein Zeitlimit
 * beendet einen hängenden Lauf hart (`terminate`).
 *
 * **Welche Datei geladen wird:** Im gebauten Backend (`dist`, Docker) liegt
 * `verify-worker.js` neben dieser Datei. Unter `tsx` (Entwicklung) und in
 * Vitest ist diese Datei selbst `.ts`; dann wird `verify-worker.ts` geladen,
 * und der Faden bekommt den `tsx`-Lader mit – geerbt, wenn der Hauptprozess
 * ihn schon trägt (`tsx watch`), sonst über `--import tsx`.
 *
 * **Rückfall:** Lässt sich kein Worker starten (Lader fehlt, Flags nicht
 * erlaubt), rechnet die Warteschlange direkt im Hauptfaden und meldet das
 * einmal als Warnung. Der Rückfall greift nur, solange noch nie ein Worker
 * geantwortet hat: Stirbt ein Worker, der schon lief, war es der Auftrag – und
 * den im Hauptfaden zu wiederholen, hieße das Backend mit ihm abstürzen zu
 * lassen.
 */

import { Worker } from 'node:worker_threads';
import {
  type ArcadeRuleRegistry,
  type ArcadeVerifyRequest,
  type ArcadeVerifyResult,
  defaultArcadeRegistry,
  verifyArcadeRun,
} from './verify.js';

/** Zeitlimit je Nachrechnung. */
export const ARCADE_VERIFY_TIMEOUT_MS = 20_000;
/** Gleichzeitige Nachrechnungen. Mehr Fäden als zwei nähmen dem Rest die Kerne. */
export const ARCADE_VERIFY_CONCURRENCY = 2;

export type ArcadeVerifyPath = 'worker' | 'inline';

export interface ArcadeVerifier {
  verify(request: ArcadeVerifyRequest): Promise<ArcadeVerifyResult>;
  /** Beendet alle Fäden; offene Aufträge laufen noch zu Ende. */
  close(): Promise<void>;
  /** Weg des letzten fertigen Auftrags – für Tests und Diagnose. */
  lastPath(): ArcadeVerifyPath | null;
}

export interface ArcadeVerifierLogger {
  warn(details: Record<string, unknown>, message: string): void;
}

export interface ArcadeVerifierOptions {
  /** `worker` (Vorgabe) oder `inline` (Tests mit eingeschleustem Register). */
  readonly mode?: ArcadeVerifyPath;
  /** Nur für `inline` und den Rückfall; der Worker nutzt immer das echte Register. */
  readonly registry?: ArcadeRuleRegistry;
  readonly concurrency?: number;
  readonly timeoutMs?: number;
  readonly logger?: ArcadeVerifierLogger;
}

interface Job {
  request: ArcadeVerifyRequest;
  resolve: (result: ArcadeVerifyResult) => void;
}

interface WorkerTarget {
  url: URL;
  execArgv?: string[];
}

/** Welche Worker-Datei zu dieser Datei gehört (siehe Kopf). */
function workerTarget(): WorkerTarget {
  const own = import.meta.url;

  if (!own.endsWith('.ts')) {
    return { url: new URL('./verify-worker.js', own) };
  }

  // Nur ein echter Verweis auf das Paket `tsx` zählt – Pfade wie
  // `…/tsx@4.23.13_/node_modules/vitest/…` (pnpm-Store) nicht.
  const traegtTsx = process.execArgv.some((argument) => /(^|[\\/])tsx([\\/]|$)/.test(argument));

  return {
    url: new URL('./verify-worker.ts', own),
    // Ohne Angabe erbt der Faden `process.execArgv` – unter `tsx watch` samt Lader.
    ...(traegtTsx ? {} : { execArgv: ['--import', 'tsx'] }),
  };
}

export function createArcadeVerifier(options: ArcadeVerifierOptions = {}): ArcadeVerifier {
  const registry = options.registry ?? defaultArcadeRegistry;
  const concurrency = Math.max(1, options.concurrency ?? ARCADE_VERIFY_CONCURRENCY);
  const timeoutMs = options.timeoutMs ?? ARCADE_VERIFY_TIMEOUT_MS;
  const queue: Job[] = [];
  const idle: Worker[] = [];
  const all = new Set<Worker>();
  let running = 0;
  let nextId = 1;
  let workerBroken = options.mode === 'inline';
  let everAnswered = false;
  let last: ArcadeVerifyPath | null = null;
  let closed = false;

  function inline(request: ArcadeVerifyRequest): ArcadeVerifyResult {
    last = 'inline';

    return verifyArcadeRun(registry, request);
  }

  function spawn(): Worker {
    const target = workerTarget();
    const worker = new Worker(target.url, target.execArgv ? { execArgv: target.execArgv } : {});

    // Ein wartender Faden darf das Beenden des Prozesses nicht aufhalten.
    worker.unref();
    all.add(worker);
    worker.once('exit', () => {
      all.delete(worker);
      const index = idle.indexOf(worker);

      if (index >= 0) idle.splice(index, 1);
    });

    return worker;
  }

  function markBroken(error: unknown): void {
    if (workerBroken) return;
    workerBroken = true;
    options.logger?.warn(
      { err: error },
      'Nachrechnen im Worker nicht möglich – es wird im Hauptfaden gerechnet.',
    );
  }

  function inWorker(request: ArcadeVerifyRequest): Promise<ArcadeVerifyResult> {
    let worker: Worker;

    try {
      worker = idle.pop() ?? spawn();
    } catch (error) {
      markBroken(error);

      return Promise.resolve(inline(request));
    }

    const id = nextId;
    nextId += 1;

    return new Promise<ArcadeVerifyResult>((resolve) => {
      let settled = false;

      const finish = (result: ArcadeVerifyResult | null, kill: boolean, error?: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.off('message', onMessage);
        worker.off('error', onError);
        worker.off('exit', onExit);

        if (kill) {
          void worker.terminate();
        } else if (!closed) {
          idle.push(worker);
        } else {
          void worker.terminate();
        }

        if (result !== null) {
          resolve(result);

          return;
        }

        // Der Worker ist ausgefallen. Hat noch nie einer geantwortet, liegt es
        // am Start (Lader, Flags) – dann rechnet der Hauptfaden. Sonst war es
        // der Auftrag selbst, und der zählt nicht.
        if (!everAnswered) {
          markBroken(error);
          resolve(inline(request));

          return;
        }

        last = 'worker';
        resolve({ ok: false, reason: 'Nachrechnen ist abgebrochen.' });
      };

      const onMessage = (message: { id: number; result: ArcadeVerifyResult }): void => {
        if (message.id !== id) return;
        everAnswered = true;
        last = 'worker';
        finish(message.result, false);
      };
      const onError = (error: unknown): void => {
        finish(null, true, error);
      };
      const onExit = (code: number): void => {
        finish(null, true, new Error(`Worker beendet mit Code ${String(code)}.`));
      };
      const timer = setTimeout(() => {
        last = 'worker';
        finish({ ok: false, reason: 'Nachrechnen dauerte zu lange.' }, true);
      }, timeoutMs);

      worker.on('message', onMessage);
      worker.on('error', onError);
      worker.on('exit', onExit);
      worker.postMessage({ id, request });
    });
  }

  function pump(): void {
    while (running < concurrency && queue.length > 0) {
      const job = queue.shift() as Job;
      running += 1;

      const work = workerBroken
        ? Promise.resolve().then(() => inline(job.request))
        : inWorker(job.request);

      void work
        .catch((error: unknown): ArcadeVerifyResult => ({
          ok: false,
          reason: error instanceof Error ? error.message : 'Nachrechnen fehlgeschlagen.',
        }))
        .then((result) => {
          running -= 1;
          job.resolve(result);
          pump();
        });
    }
  }

  return {
    verify(request) {
      return new Promise<ArcadeVerifyResult>((resolve) => {
        queue.push({ request, resolve });
        pump();
      });
    },

    async close() {
      closed = true;
      await Promise.all([...all].map((worker) => worker.terminate()));
      all.clear();
      idle.length = 0;
    },

    lastPath() {
      return last;
    },
  };
}
