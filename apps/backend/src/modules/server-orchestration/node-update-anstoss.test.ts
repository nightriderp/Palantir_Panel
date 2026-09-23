import { describe, expect, it, vi } from 'vitest';
import {
  brauchtUpdateAnstoss,
  standAusAgentVersion,
  stosseNodeUpdateAn,
  type UpdateAnstossDeps,
} from './node-update-anstoss.js';

const BACKEND = 'dce821c77236aaaabbbbccccddddeeeeffff0000';
const GLEICH = '0.6.0+dce821c77236';
const AELTER = '0.6.0+0123456789ab';

function deps(teil: Partial<UpdateAnstossDeps> = {}) {
  const send = vi.fn(async () => ({ signaled: true }));
  const log = { info: vi.fn(), warn: vi.fn() };

  return {
    send,
    log,
    deps: { backendCommit: BACKEND, agentVersion: AELTER, send, log, ...teil },
  };
}

describe('standAusAgentVersion (Gefundener Punkt 342)', () => {
  it('liest den Commit aus den SemVer-Baumetadaten', () => {
    expect(standAusAgentVersion(GLEICH)).toBe('dce821c77236');
  });

  it.each(['0.6.0', 'unbekannt', '0.6.0+', '0.6.0+kein-commit'])('kennt bei "%s" keinen', (v) => {
    expect(standAusAgentVersion(v)).toBeNull();
  });
});

describe('brauchtUpdateAnstoss (Gefundener Punkt 342)', () => {
  it('klingelt nicht bei gleichem Stand', () => {
    expect(brauchtUpdateAnstoss(GLEICH, BACKEND)).toBe(false);
  });

  it('klingelt bei abweichendem Stand', () => {
    expect(brauchtUpdateAnstoss(AELTER, BACKEND)).toBe(true);
  });

  it('klingelt, wenn der Agent keinen Stand meldet', () => {
    // Start von Hand ohne update.sh - ohne Anstoss bliebe die Node stehen.
    expect(brauchtUpdateAnstoss('0.6.0', BACKEND)).toBe(true);
  });

  it('klingelt nie, wenn das Backend seinen eigenen Stand nicht kennt', () => {
    expect(brauchtUpdateAnstoss(AELTER, undefined)).toBe(false);
    expect(brauchtUpdateAnstoss('0.6.0', undefined)).toBe(false);
  });
});

describe('stosseNodeUpdateAn (Gefundener Punkt 342)', () => {
  it('schickt UPDATE_AVAILABLE mit dem eigenen Commit, wenn die Node aelter ist', async () => {
    const { send, log, deps: d } = deps();

    await expect(stosseNodeUpdateAn('node-1', d)).resolves.toBe(true);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ targetCommit: BACKEND });
    expect(log.info).toHaveBeenCalledTimes(1);
  });

  it('schickt nichts bei gleicher Version', async () => {
    const { send, deps: d } = deps({ agentVersion: GLEICH });

    await expect(stosseNodeUpdateAn('node-1', d)).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('schickt nichts ohne eigenen Stand', async () => {
    const { send, deps: d } = deps({ backendCommit: undefined });

    await expect(stosseNodeUpdateAn('node-1', d)).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('schickt nichts, solange kein hello vorliegt', async () => {
    const { send, deps: d } = deps({ agentVersion: null });

    await expect(stosseNodeUpdateAn('node-1', d)).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('warnt, wenn die Node keinen Anstoss-Ordner kennt', async () => {
    const send = vi.fn(async () => ({ signaled: false }));
    const { log, deps: d } = deps({ send });

    await expect(stosseNodeUpdateAn('node-1', d)).resolves.toBe(false);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('reicht einen Fehler beim Senden an den Aufrufer weiter', async () => {
    const send = vi.fn(async () => {
      throw new Error('AGENT_COMMAND_TIMEOUT');
    });
    const { deps: d } = deps({ send });

    await expect(stosseNodeUpdateAn('node-1', d)).rejects.toThrow('AGENT_COMMAND_TIMEOUT');
  });
});
