import { describe, expect, it } from 'vitest';
import {
  actionAvailable,
  actionId,
  confirmationExpired,
  confirmId,
  consoleModalId,
  parseCustomId,
  renderControls,
} from './buttons.js';

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('Kennungen der Knöpfe', () => {
  it('liest, was sie selbst schreibt', () => {
    expect(parseCustomId(actionId(ID, 'start'))).toEqual({
      kind: 'action',
      serverId: ID,
      action: 'start',
    });
    expect(parseCustomId(confirmId(ID, 'stop', 1_800_000_000))).toEqual({
      kind: 'confirm',
      serverId: ID,
      action: 'stop',
      issuedAt: 1_800_000_000,
    });
    expect(parseCustomId(consoleModalId(ID))).toEqual({ kind: 'consoleModal', serverId: ID });
  });

  it('bleibt unter Discords Grenze von 100 Zeichen', () => {
    expect(confirmId(ID, 'restart', 9_999_999_999).length).toBeLessThanOrEqual(100);
  });

  it.each([
    ['fremdes Präfix', `x:${ID}:start`],
    ['keine UUID', 'srv:123:start'],
    ['unbekannte Aktion', `srv:${ID}:loeschen`],
    ['Bestätigung für eine Aktion ohne Bestätigung', `srv:${ID}:start:ok:1`],
    ['Modal einer anderen Aktion', `srv:${ID}:start:modal`],
    ['Anhang', `srv:${ID}:start:mehr`],
    ['leer', undefined],
  ])('lehnt ab: %s', (_fall, customId) => {
    expect(parseCustomId(customId)).toBeNull();
  });
});

describe('confirmationExpired', () => {
  const jetzt = 1_800_000_000_000;

  it('gilt 60 Sekunden', () => {
    expect(confirmationExpired(jetzt / 1000 - 59, jetzt)).toBe(false);
    expect(confirmationExpired(jetzt / 1000 - 61, jetzt)).toBe(true);
  });

  it('nimmt keine Bestätigung aus der Zukunft an', () => {
    expect(confirmationExpired(jetzt / 1000 + 60, jetzt)).toBe(true);
  });
});

describe('actionAvailable', () => {
  it('lässt einen gestoppten Server nur starten', () => {
    expect(actionAvailable('start', 'stopped')).toBe(true);
    expect(actionAvailable('stop', 'stopped')).toBe(false);
    expect(actionAvailable('restart', 'stopped')).toBe(false);
  });

  it('lässt einen laufenden Server stoppen und neu starten, aber nicht starten', () => {
    expect(actionAvailable('start', 'running')).toBe(false);
    expect(actionAvailable('stop', 'running')).toBe(true);
    expect(actionAvailable('restart', 'running')).toBe(true);
  });

  it('erlaubt nach einem Absturz den Start', () => {
    expect(actionAvailable('start', 'crashed')).toBe(true);
  });
});

describe('renderControls', () => {
  const labels = (reihen: ReturnType<typeof renderControls>) =>
    reihen.map((r) => r.components.map((k) => k.label));

  it('zeigt die Konsole nur, wenn sie für den Server freigeschaltet ist', () => {
    const basis = {
      serverId: ID,
      status: 'running' as const,
      supportsPlayers: true,
      supportsConsole: true,
    };

    expect(labels(renderControls({ ...basis, consoleEnabled: false }))[1]).toEqual([
      'Sicherung jetzt',
      'Spieler',
    ]);
    expect(labels(renderControls({ ...basis, consoleEnabled: true }))[1]).toContain('Konsole');
  });

  it('graut aus, was im Zustand keinen Sinn ergibt', () => {
    const [lebenszyklus] = renderControls({
      serverId: ID,
      status: 'stopped',
      consoleEnabled: false,
      supportsPlayers: false,
      supportsConsole: false,
    });

    expect(lebenszyklus?.components.map((k) => [k.label, k.disabled])).toEqual([
      ['Starten', false],
      ['Stoppen', true],
      ['Neustarten', true],
    ]);
  });
});
