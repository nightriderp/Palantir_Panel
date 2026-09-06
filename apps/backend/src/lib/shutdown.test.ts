/**
 * Geordnetes Beenden und Prozess-Wächter (Audit W0-5, backend-core-08,
 * Fundpunkt 126).
 *
 * Geprüft ohne Fastify und ohne echten `process`: Die Frist läuft gegen
 * Vitest-Zeitgeber, der Prozess ist ein `EventEmitter`, `exit` eine Attrappe.
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  type ShutdownLogger,
  createShutdownController,
  installProcessGuards,
} from './shutdown.js';

interface LoggedLine {
  readonly level: 'info' | 'warn' | 'error';
  readonly details: Record<string, unknown>;
  readonly message: string;
}

function makeLog(): { lines: LoggedLine[]; log: ShutdownLogger } {
  const lines: LoggedLine[] = [];
  const push =
    (level: LoggedLine['level']) =>
    (details: Record<string, unknown>, message: string): void => {
      lines.push({ level, details, message });
    };

  return { lines, log: { info: push('info'), warn: push('warn'), error: push('error') } };
}

/** Ein `close()`, das nie fertig wird – der hängende Upload-Stream. */
const haengt = (): Promise<void> => new Promise<void>(() => undefined);

describe('createShutdownController()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schließt geordnet und beendet mit Exit-Code 0', async () => {
    const { lines, log } = makeLog();
    const close = vi.fn(() => Promise.resolve());
    const exit = vi.fn();
    const controller = createShutdownController({ close, log, exit, timeoutMs: 1_000 });

    expect(controller.closing).toBe(false);
    await controller.shutdown('SIGTERM');

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(controller.closing).toBe(true);
    expect(lines.map((line) => line.level)).toEqual(['info', 'info']);
    expect(lines[0]?.details).toMatchObject({ reason: 'SIGTERM', timeoutMs: 1_000 });
  });

  it('gibt den gewünschten Exit-Code weiter (uncaughtException → 1)', async () => {
    const { log } = makeLog();
    const exit = vi.fn();
    const controller = createShutdownController({
      close: () => Promise.resolve(),
      log,
      exit,
      timeoutMs: 1_000,
    });

    await controller.shutdown('uncaughtException', 1);

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('beendet hart mit 1, wenn das Schließen die Frist überschreitet', async () => {
    const { lines, log } = makeLog();
    const exit = vi.fn();
    const controller = createShutdownController({ close: haengt, log, exit, timeoutMs: 1_000 });

    const laufend = controller.shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(999);
    expect(exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await laufend;

    expect(exit).toHaveBeenCalledWith(1);
    expect(lines.at(-1)).toMatchObject({ level: 'error', details: { timeoutMs: 1_000 } });
    expect(lines.at(-1)?.message).toContain('Frist');
  });

  it('loggt einen Fehler beim Schließen und beendet mit 1, statt abzulehnen', async () => {
    const { lines, log } = makeLog();
    const exit = vi.fn();
    const controller = createShutdownController({
      close: () => Promise.reject(new Error('Plugin hängt im onClose')),
      log,
      exit,
      timeoutMs: 1_000,
    });

    await expect(controller.shutdown('SIGINT')).resolves.toBeUndefined();

    expect(exit).toHaveBeenCalledWith(1);
    expect(lines.at(-1)).toMatchObject({
      level: 'error',
      details: { reason: 'SIGINT', error: 'Plugin hängt im onClose' },
    });
  });

  it('beendet beim zweiten Signal sofort, ohne ein zweites Mal zu schließen', async () => {
    const { lines, log } = makeLog();
    const close = vi.fn(haengt);
    const exit = vi.fn();
    const controller = createShutdownController({ close, log, exit, timeoutMs: 1_000 });

    const erstes = controller.shutdown('SIGINT');
    await controller.shutdown('SIGINT');

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(lines.at(-1)?.level).toBe('warn');

    // Das erste Beenden läuft in seine Frist – aufräumen, damit nichts hängen bleibt.
    await vi.advanceTimersByTimeAsync(1_000);
    await erstes;
  });

  it('räumt den Zeitgeber der Frist nach erfolgreichem Schließen weg', async () => {
    const { log } = makeLog();
    const controller = createShutdownController({
      close: () => Promise.resolve(),
      log,
      exit: vi.fn(),
      timeoutMs: 1_000,
    });

    await controller.shutdown('SIGTERM');

    expect(vi.getTimerCount()).toBe(0);
  });

  it('nutzt zehn Sekunden als Vorgabe', () => {
    expect(DEFAULT_SHUTDOWN_TIMEOUT_MS).toBe(10_000);
  });
});

describe('installProcessGuards()', () => {
  const rejections: unknown[] = [];
  const spion = (reason: unknown): void => {
    rejections.push(reason);
  };

  beforeEach(() => {
    rejections.length = 0;
    process.on('unhandledRejection', spion);
  });

  afterEach(() => {
    process.off('unhandledRejection', spion);
  });

  it('loggt eine unbehandelte Ablehnung und lässt den Prozess weiterlaufen', () => {
    const { lines, log } = makeLog();
    const target = new EventEmitter();
    const shutdown = vi.fn(() => Promise.resolve());

    installProcessGuards({ log, shutdown, target });
    target.emit('unhandledRejection', new Error('verirrter Hintergrundlauf'), Promise.resolve());

    expect(shutdown).not.toHaveBeenCalled();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'error',
      details: { error: 'verirrter Hintergrundlauf' },
    });
    expect(lines[0]?.message).toContain('läuft weiter');
  });

  it('beendet bei einer unbehandelten Ausnahme geordnet mit Exit-Code 1', () => {
    const { lines, log } = makeLog();
    const target = new EventEmitter();
    const shutdown = vi.fn(() => Promise.resolve());

    installProcessGuards({ log, shutdown, target });
    target.emit('uncaughtException', new Error('synchron kaputt'), 'uncaughtException');

    expect(shutdown).toHaveBeenCalledWith('uncaughtException', 1);
    expect(lines[0]).toMatchObject({
      level: 'error',
      details: { error: 'synchron kaputt', origin: 'uncaughtException' },
    });
  });

  it('lässt einen Fehler im Shutdown-Weg nicht zur unbehandelten Ablehnung werden', async () => {
    const { lines, log } = makeLog();
    const target = new EventEmitter();

    installProcessGuards({
      log,
      shutdown: () => Promise.reject(new Error('close() wirft')),
      target,
    });
    target.emit('uncaughtException', new Error('kaputt'), 'uncaughtException');

    for (let i = 0; i < 3; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    expect(rejections).toEqual([]);
    expect(lines.at(-1)).toMatchObject({ details: { error: 'close() wirft' } });
  });
});
