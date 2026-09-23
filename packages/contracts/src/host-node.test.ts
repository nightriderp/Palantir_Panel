import { describe, expect, it } from 'vitest';
import { NODE_UPDATE_DISPLAY_WINDOW_MS, isNodeUpdating } from './host-node.js';

describe('isNodeUpdating (Gefundener Punkt 342)', () => {
  const ANSTOSS = '2026-09-23T16:00:00.000Z';
  const kurzDanach = new Date('2026-09-23T16:02:00.000Z');

  it('meldet eine getrennte Node kurz nach dem Anstoss als aktualisierend', () => {
    expect(isNodeUpdating({ status: 'offline', updateSignaledAt: ANSTOSS }, kurzDanach)).toBe(true);
  });

  it('meldet nichts ohne Anstoss', () => {
    expect(isNodeUpdating({ status: 'offline', updateSignaledAt: null }, kurzDanach)).toBe(false);
    expect(isNodeUpdating({ status: 'offline' }, kurzDanach)).toBe(false);
  });

  it('meldet nichts fuer eine verbundene Node oder eine in Wartung', () => {
    expect(isNodeUpdating({ status: 'online', updateSignaledAt: ANSTOSS }, kurzDanach)).toBe(false);
    expect(isNodeUpdating({ status: 'maintenance', updateSignaledAt: ANSTOSS }, kurzDanach)).toBe(
      false,
    );
  });

  it('gibt nach Ablauf der Frist wieder "offline" frei', () => {
    const anstoss = Date.parse(ANSTOSS);

    expect(
      isNodeUpdating(
        { status: 'offline', updateSignaledAt: ANSTOSS },
        new Date(anstoss + NODE_UPDATE_DISPLAY_WINDOW_MS),
      ),
    ).toBe(true);
    expect(
      isNodeUpdating(
        { status: 'offline', updateSignaledAt: ANSTOSS },
        new Date(anstoss + NODE_UPDATE_DISPLAY_WINDOW_MS + 1),
      ),
    ).toBe(false);
  });

  it('nimmt einen unlesbaren oder kuenftigen Zeitpunkt nicht als Update', () => {
    expect(isNodeUpdating({ status: 'offline', updateSignaledAt: 'gestern' }, kurzDanach)).toBe(
      false,
    );
    expect(
      isNodeUpdating(
        { status: 'offline', updateSignaledAt: '2026-09-23T17:00:00.000Z' },
        kurzDanach,
      ),
    ).toBe(false);
  });
});
