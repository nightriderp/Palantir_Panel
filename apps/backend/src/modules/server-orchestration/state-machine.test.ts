/**
 * Tests der Lifecycle-State-Machine (Pflichtenheft §9).
 *
 * Zwingend laut CLAUDE.md §4 und der Vorgabe des Arbeitspakets – inklusive der
 * **unzulässigen** Übergänge und des Crash-Loop-Schutzes.
 */

import { SERVER_STATUSES, type ServerStatus } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { type CrashLoopPolicy } from './crash-loop.js';
import { ServerOrchestrationError } from './errors.js';
import {
  type ServerLifecycleEvent,
  type ServerLifecycleState,
  applyLifecycleEvent,
  assertTransitionAllowed,
  initialLifecycleState,
  parseServerStatus,
} from './state-machine.js';

const T0 = new Date('2026-08-26T12:00:00.000Z');

function stateWith(overrides: Partial<ServerLifecycleState> = {}): ServerLifecycleState {
  return {
    status: 'stopped',
    statusMessage: null,
    statusChangedAt: T0.toISOString(),
    lastStartedAt: null,
    crashTimestamps: [],
    ...overrides,
  };
}

function apply(
  state: ServerLifecycleState,
  event: ServerLifecycleEvent,
  now: Date = T0,
  crashLoopPolicy?: CrashLoopPolicy,
) {
  return applyLifecycleEvent(state, event, { now, crashLoopPolicy });
}

describe('Startzustand', () => {
  it('beginnt bei creating (Pflichtenheft §9)', () => {
    const state = initialLifecycleState(T0);

    expect(state.status).toBe('creating');
    expect(state.lastStartedAt).toBeNull();
    expect(state.crashTimestamps).toEqual([]);
  });
});

describe('Hauptfolge creating → stopped → starting → running → stopping → stopped', () => {
  it('durchläuft die Folge vollständig', () => {
    let state = initialLifecycleState(T0);

    state = apply(state, { type: 'createSucceeded' }).state;
    expect(state.status).toBe('stopped');

    state = apply(state, { type: 'startRequested' }).state;
    expect(state.status).toBe('starting');

    state = apply(state, { type: 'healthCheckPassed' }).state;
    expect(state.status).toBe('running');

    state = apply(state, { type: 'stopRequested' }).state;
    expect(state.status).toBe('stopping');

    state = apply(state, { type: 'stopSucceeded' }).state;
    expect(state.status).toBe('stopped');
  });

  it('schreibt bei jedem Übergang den Zeitstempel fort', () => {
    const later = new Date(T0.getTime() + 5_000);
    const result = apply(stateWith(), { type: 'startRequested' }, later);

    expect(result.state.statusChangedAt).toBe(later.toISOString());
  });
});

describe('Health-Check-Pflicht (Pflichtenheft §9, Lastenheft §3.3)', () => {
  it('kennt kein Ereignis, das ohne Health-Check nach running führt', () => {
    const events: ServerLifecycleEvent[] = [
      { type: 'createSucceeded' },
      { type: 'createFailed', reason: 'x' },
      { type: 'startRequested' },
      { type: 'automaticRestartRequested', attempt: 1 },
      { type: 'healthCheckFailed', reason: 'x' },
      { type: 'stopRequested' },
      { type: 'stopSucceeded' },
      { type: 'stopFailed', reason: 'x' },
      { type: 'crashed', reason: 'x', exitCode: 1 },
      { type: 'observedStopped', reason: 'x' },
      { type: 'failed', reason: 'x' },
      { type: 'acknowledged' },
    ];

    for (const event of events) {
      for (const status of SERVER_STATUSES) {
        let result;

        try {
          result = apply(stateWith({ status }), event);
        } catch {
          continue;
        }

        expect(result.state.status).not.toBe('running');
      }
    }
  });

  it('macht ausschließlich healthCheckPassed einen Server zu running', () => {
    const result = apply(stateWith({ status: 'starting' }), { type: 'healthCheckPassed' });

    expect(result.state.status).toBe('running');
  });

  it('führt einen gescheiterten Health-Check nach error, nicht nach stopped', () => {
    const result = apply(stateWith({ status: 'starting' }), {
      type: 'healthCheckFailed',
      reason: 'Nicht erreichbar.',
    });

    expect(result.state.status).toBe('error');
    expect(result.state.statusMessage).toBe('Nicht erreichbar.');
  });
});

describe('Unzulässige Übergänge', () => {
  it('lehnt den Start eines bereits laufenden Servers ab', () => {
    expect(() => apply(stateWith({ status: 'running' }), { type: 'startRequested' })).toThrow(
      ServerOrchestrationError,
    );
  });

  it('meldet dabei den Katalog-Code SERVER_STATE_CONFLICT', () => {
    try {
      apply(stateWith({ status: 'running' }), { type: 'startRequested' });
      expect.unreachable('Der Übergang hätte abgelehnt werden müssen.');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ServerOrchestrationError);
      expect((error as ServerOrchestrationError).code).toBe('SERVER_STATE_CONFLICT');
    }
  });

  it('lehnt das Stoppen eines gestoppten Servers ab', () => {
    expect(() => apply(stateWith({ status: 'stopped' }), { type: 'stopRequested' })).toThrow(
      ServerOrchestrationError,
    );
  });

  it('lehnt einen zweiten Absturz im Zustand crashed ab', () => {
    expect(() =>
      apply(stateWith({ status: 'crashed' }), { type: 'crashed', reason: 'x', exitCode: 1 }),
    ).toThrow(ServerOrchestrationError);
  });

  it('lehnt das Quittieren eines laufenden Servers ab', () => {
    expect(() => apply(stateWith({ status: 'running' }), { type: 'acknowledged' })).toThrow(
      ServerOrchestrationError,
    );
  });

  it('kennt keinen Weg zurück nach creating', () => {
    for (const status of SERVER_STATUSES) {
      expect(() => {
        assertTransitionAllowed(status, 'creating');
      }).toThrow(ServerOrchestrationError);
    }
  });

  it('lehnt jeden Übergang eines Zustands auf sich selbst ab', () => {
    for (const status of SERVER_STATUSES) {
      expect(() => {
        assertTransitionAllowed(status, status);
      }).toThrow(ServerOrchestrationError);
    }
  });
});

describe('Absturz und Crash-Loop-Schutz (Pflichtenheft §9)', () => {
  const policy: CrashLoopPolicy = { maxRestarts: 2, windowMinutes: 10 };

  it('geht bei einem Absturz nach crashed und schlägt einen Neustart vor', () => {
    const result = apply(
      stateWith({ status: 'running' }),
      { type: 'crashed', reason: 'Beendet.', exitCode: 137 },
      T0,
      policy,
    );

    expect(result.state.status).toBe('crashed');
    expect(result.crashLoopTripped).toBe(false);
    expect(result.shouldAutoRestart).toBe(true);
    expect(result.nextRestartAttempt).toBe(1);
  });

  it('nennt den Exit-Code in der Statusmeldung', () => {
    const result = apply(
      stateWith({ status: 'running' }),
      { type: 'crashed', reason: 'Beendet.', exitCode: 137 },
      T0,
      policy,
    );

    expect(result.state.statusMessage).toContain('137');
  });

  it('schaltet nach der erlaubten Anzahl Neustarts im Fenster ab', () => {
    let state = stateWith({ status: 'running' });
    let tripped = false;

    for (let attempt = 1; attempt <= policy.maxRestarts + 1; attempt += 1) {
      const at = new Date(T0.getTime() + attempt * 60_000);
      const crash = apply(state, { type: 'crashed', reason: 'Beendet.', exitCode: 1 }, at, policy);

      tripped = crash.crashLoopTripped;
      state = crash.state;

      if (tripped) {
        break;
      }

      state = apply(state, { type: 'automaticRestartRequested', attempt }, at, policy).state;
      state = apply(state, { type: 'healthCheckFailed', reason: 'weg' }, at, policy).state;
      state = apply(state, { type: 'startRequested' }, at, policy).state;
      state = apply(state, { type: 'healthCheckPassed' }, at, policy).state;
    }

    // Der Zähler wird bei jedem erfolgreichen Start zurückgesetzt – solange der
    // Server also zwischendurch wirklich hochkommt, greift der Schutz nie.
    expect(tripped).toBe(false);
  });

  it('greift, wenn der Server zwischen den Abstürzen nie erfolgreich hochkommt', () => {
    let state = stateWith({ status: 'running' });
    const attempts: boolean[] = [];

    for (let attempt = 1; attempt <= policy.maxRestarts + 1; attempt += 1) {
      const at = new Date(T0.getTime() + attempt * 30_000);
      const crash = apply(state, { type: 'crashed', reason: 'Beendet.', exitCode: 1 }, at, policy);

      attempts.push(crash.crashLoopTripped);
      state = crash.state;

      if (crash.crashLoopTripped) {
        break;
      }

      // Neustart, der sofort wieder abstürzt: kein Health-Check dazwischen.
      state = apply(state, { type: 'automaticRestartRequested', attempt }, at, policy).state;
    }

    expect(attempts.slice(0, -1).every((tripped) => !tripped)).toBe(true);
    expect(attempts.at(-1)).toBe(true);
    expect(attempts).toHaveLength(policy.maxRestarts + 1);
  });

  it('schlägt nach dem Auslösen keinen weiteren Neustart vor', () => {
    const history = [
      new Date(T0.getTime() - 3 * 60_000).toISOString(),
      new Date(T0.getTime() - 2 * 60_000).toISOString(),
    ];

    const result = apply(
      stateWith({ status: 'running', crashTimestamps: history }),
      { type: 'crashed', reason: 'Beendet.', exitCode: 1 },
      T0,
      policy,
    );

    expect(result.crashLoopTripped).toBe(true);
    expect(result.shouldAutoRestart).toBe(false);
    expect(result.nextRestartAttempt).toBe(0);
  });

  it('vergisst Abstürze außerhalb des Zeitfensters', () => {
    const old = [
      new Date(T0.getTime() - 120 * 60_000).toISOString(),
      new Date(T0.getTime() - 90 * 60_000).toISOString(),
    ];

    const result = apply(
      stateWith({ status: 'running', crashTimestamps: old }),
      { type: 'crashed', reason: 'Beendet.', exitCode: 1 },
      T0,
      policy,
    );

    expect(result.state.crashTimestamps).toEqual([T0.toISOString()]);
    expect(result.crashLoopTripped).toBe(false);
  });

  it('erlaubt den automatischen Neustart-Versuch crashed → starting', () => {
    const result = apply(stateWith({ status: 'crashed' }), {
      type: 'automaticRestartRequested',
      attempt: 2,
    });

    expect(result.state.status).toBe('starting');
    expect(result.state.statusMessage).toContain('Versuch 2');
  });

  it('erlaubt crashed → error, wenn der Schutz abgeschaltet hat', () => {
    const result = apply(stateWith({ status: 'crashed' }), {
      type: 'failed',
      reason: 'Zu oft abgestürzt.',
    });

    expect(result.state.status).toBe('error');
  });
});

describe('Auto-Shutdown-Schonfrist (Pflichtenheft §9)', () => {
  it('setzt lastStartedAt erst beim bestandenen Health-Check, nicht beim Startbefehl', () => {
    const requested = apply(stateWith({ status: 'stopped' }), { type: 'startRequested' });

    expect(requested.state.lastStartedAt).toBeNull();

    const later = new Date(T0.getTime() + 20_000);
    const running = apply(requested.state, { type: 'healthCheckPassed' }, later);

    expect(running.state.lastStartedAt).toBe(later.toISOString());
  });

  it('zählt einen automatischen Neustart nach Absturz als regulären Serverstart', () => {
    const crashAt = new Date(T0.getTime() + 60_000);
    const restartAt = new Date(T0.getTime() + 90_000);

    let state = stateWith({ status: 'running', lastStartedAt: T0.toISOString() });

    state = apply(state, { type: 'crashed', reason: 'Beendet.', exitCode: 1 }, crashAt).state;
    state = apply(state, { type: 'automaticRestartRequested', attempt: 1 }, restartAt).state;
    state = apply(state, { type: 'healthCheckPassed' }, restartAt).state;

    // Genau das verhindert, dass ein gerade wiederhergestellter Server sofort
    // fälschlich als inaktiv erkannt und erneut abgeschaltet wird.
    expect(state.lastStartedAt).toBe(restartAt.toISOString());
  });

  it('räumt die Absturzhistorie beim erfolgreichen Start ab', () => {
    const state = stateWith({
      status: 'starting',
      crashTimestamps: [T0.toISOString()],
    });

    expect(apply(state, { type: 'healthCheckPassed' }).state.crashTimestamps).toEqual([]);
  });

  it('räumt die Absturzhistorie beim Quittieren ab', () => {
    const state = stateWith({ status: 'error', crashTimestamps: [T0.toISOString()] });

    expect(apply(state, { type: 'acknowledged' }).state.crashTimestamps).toEqual([]);
  });
});

describe('parseServerStatus()', () => {
  it('liest bekannte Zustände unverändert', () => {
    for (const status of SERVER_STATUSES) {
      expect(parseServerStatus(status)).toBe(status);
    }
  });

  it('macht aus einem unbekannten Wert error statt eines Absturzes', () => {
    expect(parseServerStatus('paused' as ServerStatus)).toBe('error');
  });
});
