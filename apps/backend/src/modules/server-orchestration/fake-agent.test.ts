import { describe, expect, it, vi } from 'vitest';
import { type AgentContainerStatus } from '@palantir/contracts';
import { fakeAgentEnabled, fakeCommandResult } from './fake-agent.js';

/**
 * Die Attrappe darf im Betrieb unter keinen Umständen anspringen: Sie meldete
 * dort Erfolge, die nie stattgefunden haben. Die Verriegelung ist deshalb der
 * wichtigste Teil dieser Datei.
 */
describe('fakeAgentEnabled', () => {
  it('bleibt ohne die Variable aus', () => {
    expect(fakeAgentEnabled({})).toBe(false);
  });

  it('verlangt genau "true" – nicht "1" oder "yes"', () => {
    expect(fakeAgentEnabled({ DEV_FAKE_AGENT: '1' })).toBe(false);
    expect(fakeAgentEnabled({ DEV_FAKE_AGENT: 'yes' })).toBe(false);
    expect(fakeAgentEnabled({ DEV_FAKE_AGENT: 'true' })).toBe(true);
  });

  it('bleibt im Betrieb aus, auch wenn die Variable gesetzt ist – und sagt es', () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    expect(fakeAgentEnabled({ DEV_FAKE_AGENT: 'true', NODE_ENV: 'production' }, log)).toBe(false);
    expect(log.error).toHaveBeenCalledTimes(1);
  });
});

describe('fakeCommandResult', () => {
  const jetzt = new Date('2026-09-13T18:00:00.000Z');

  function zustand(): Map<string, AgentContainerStatus> {
    return new Map<string, AgentContainerStatus>();
  }

  it('legt an, startet und stoppt – nur im eigenen Gedächtnis', () => {
    const state = zustand();

    const angelegt = fakeCommandResult('CREATE', 'server-1', {}, state, jetzt);
    expect(angelegt.success).toBe(true);

    const containerId = [...state.keys()][0] ?? '';
    expect(containerId).not.toBe('');
    expect(state.get(containerId)).toBe('created');

    fakeCommandResult('START', 'server-1', { containerId }, state, jetzt);
    expect(state.get(containerId)).toBe('running');

    fakeCommandResult('STOP', 'server-1', { containerId }, state, jetzt);
    expect(state.get(containerId)).toBe('exited');

    fakeCommandResult('DELETE', 'server-1', { containerId }, state, jetzt);
    expect(state.has(containerId)).toBe(false);
  });

  it('liefert Messwerte, die sich bewegen, aber im Rahmen bleiben', () => {
    const antwort = fakeCommandResult('GET_STATS', 'server-1', {}, zustand(), jetzt);

    expect(antwort.success).toBe(true);
    const daten = antwort.data as { cpuPercent: number; memoryLimitBytes: number };
    expect(daten.cpuPercent).toBeGreaterThan(0);
    expect(daten.cpuPercent).toBeLessThan(100);
    expect(daten.memoryLimitBytes).toBeGreaterThan(0);
  });

  it('nennt einen Verzeichnisinhalt mit Pfad', () => {
    const antwort = fakeCommandResult(
      'FILE_LIST',
      'server-1',
      { path: '/daten' },
      zustand(),
      jetzt,
    );

    expect(antwort.success).toBe(true);
    const daten = antwort.data as { path: string; entries: readonly unknown[] };
    expect(daten.path).toBe('/daten');
    expect(daten.entries.length).toBeGreaterThan(0);
  });

  it('sagt ab, statt einen Erfolg zu erfinden', () => {
    const antwort = fakeCommandResult('CREATE_BACKUP', 'server-1', {}, zustand(), jetzt);

    expect(antwort.success).toBe(false);
    expect(antwort.error?.code).toBe('AGENT_COMMAND_FAILED');
  });
});
