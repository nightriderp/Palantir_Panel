import type { GameServerPermissions } from '@palantir/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ServerOrchestrationError } from '../server-orchestration/errors.js';
import { actionId, CONSOLE_INPUT_ID, confirmId, consoleModalId } from './buttons.js';
import type { ServerControlPort, ServerControlView } from './control.js';
import { type ControlsContext, handleControlInteraction, spielerText } from './controls.js';
import type { LinkedAccount } from './interactions.js';
import { type Interaction, InteractionResponseType, InteractionType } from './types.js';

const SERVER = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const NOW = 1_800_000_000_000;

const ALLE_RECHTE: GameServerPermissions = {
  canView: true,
  canViewAddress: true,
  canStart: true,
  canStop: true,
  canRestart: true,
  canManageSettings: true,
  canDelete: true,
  canClone: true,
  canManageMembers: true,
  canManageBackups: true,
  canManageFiles: true,
  canManageSchedules: true,
  canUseConsole: true,
  canTransferOwnership: true,
  canUpdate: true,
};

const KEINE_RECHTE: GameServerPermissions = Object.fromEntries(
  Object.keys(ALLE_RECHTE).map((k) => [k, false]),
) as unknown as GameServerPermissions;

const KONTO: LinkedAccount = { userId: 'u1', displayName: 'Keyrim', banned: false, approved: true };

function view(overrides: Partial<ServerControlView> = {}): ServerControlView {
  return {
    name: 'Survival',
    status: 'running',
    permissions: ALLE_RECHTE,
    consoleEnabled: false,
    supportsConsole: true,
    ...overrides,
  };
}

function control(v: ServerControlView | null = view()): ServerControlPort & {
  [K in 'start' | 'stop' | 'restart' | 'backup' | 'console']: ReturnType<typeof vi.fn>;
} {
  return {
    load: vi.fn(async () => v),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    restart: vi.fn(async () => undefined),
    backup: vi.fn(async () => undefined),
    players: () => ({ names: ['Alex', 'Sam'], count: { online: 2, max: 20 } }),
    console: vi.fn(async () => ({ stdout: 'There are 2 players online', stderr: '' })),
  };
}

function ctx(
  c: ServerControlPort,
  overrides: Partial<ControlsContext> = {},
  konto: LinkedAccount | null = KONTO,
): ControlsContext {
  return {
    identity: { resolve: async () => konto },
    control: c,
    allowAction: () => true,
    now: () => NOW,
    log: { info: () => undefined, error: () => undefined },
    ...overrides,
  };
}

function klick(customId: string): Interaction {
  return {
    id: 'i',
    type: InteractionType.MessageComponent,
    token: 't',
    guild_id: 'g',
    member: { user: { id: 'd1' } },
    data: { custom_id: customId },
  };
}

describe('handleControlInteraction – Vorprüfung bei jedem Klick', () => {
  it('verlangt eine Verknüpfung', async () => {
    const aus = await handleControlInteraction(
      klick(actionId(SERVER, 'start')),
      ctx(control(), {}, null),
    );

    expect(aus.response.data?.content).toContain('mit keinem Palantir-Konto verknüpft');
  });

  it('bremst bei zu vielen Aktionen', async () => {
    const c = control();
    const aus = await handleControlInteraction(
      klick(actionId(SERVER, 'start')),
      ctx(c, { allowAction: () => false }),
    );

    expect(aus.response.data?.content).toContain('Zu viele Aktionen');
    expect(c.start).not.toHaveBeenCalled();
  });

  it('antwortet für einen fremden Server wie für einen, den es nicht gibt', async () => {
    const aus = await handleControlInteraction(
      klick(actionId(SERVER, 'start')),
      ctx(control(view({ permissions: KEINE_RECHTE }))),
    );

    expect(aus.response.data?.content).toBe(
      (await handleControlInteraction(klick(actionId(SERVER, 'start')), ctx(control(null))))
        .response.data?.content,
    );
  });

  it('prüft das Recht der Aktion, nicht nur das Sehen', async () => {
    const c = control(view({ permissions: { ...KEINE_RECHTE, canView: true } }));
    const aus = await handleControlInteraction(klick(actionId(SERVER, 'start')), ctx(c));

    expect(aus.response.data?.content).toContain('Berechtigung');
    expect(aus.followUp).toBeUndefined();
  });

  it('lehnt eine fremde Kennung ab', async () => {
    const aus = await handleControlInteraction(klick('srv:kaputt'), ctx(control()));

    expect(aus.response.data?.content).toContain('kenne ich nicht');
  });
});

describe('Starten, Stoppen, Neustarten (F4)', () => {
  it('startet nach vorläufiger Antwort und meldet das Ergebnis nach', async () => {
    const c = control(view({ status: 'stopped' }));
    const aus = await handleControlInteraction(klick(actionId(SERVER, 'start')), ctx(c));

    expect(aus.response.type).toBe(InteractionResponseType.DeferredChannelMessageWithSource);
    expect((await aus.followUp?.())?.content).toContain('gestartet');
    expect(c.start).toHaveBeenCalledWith(SERVER, 'u1');
  });

  it('fragt vor dem Stoppen nach und stoppt noch nicht', async () => {
    const c = control();
    const aus = await handleControlInteraction(klick(actionId(SERVER, 'stop')), ctx(c));

    expect(aus.response.data?.content).toContain('wirklich stoppen');
    expect(JSON.stringify(aus.response.data?.components)).toContain(
      confirmId(SERVER, 'stop', NOW / 1000),
    );
    expect(c.stop).not.toHaveBeenCalled();
  });

  it('stoppt nach der Bestätigung und ersetzt die Rückfrage', async () => {
    const c = control();
    const aus = await handleControlInteraction(
      klick(confirmId(SERVER, 'stop', NOW / 1000 - 10)),
      ctx(c),
    );

    expect(aus.response.type).toBe(InteractionResponseType.DeferredUpdateMessage);
    expect(await aus.followUp?.()).toMatchObject({ components: [] });
    expect(c.stop).toHaveBeenCalledWith(SERVER);
  });

  it('nimmt eine abgelaufene Bestätigung nicht an', async () => {
    const c = control();
    const aus = await handleControlInteraction(
      klick(confirmId(SERVER, 'stop', NOW / 1000 - 120)),
      ctx(c),
    );

    expect(aus.response.data?.content).toContain('abgelaufen');
    expect(c.stop).not.toHaveBeenCalled();
  });

  it('prüft das Recht beim Bestätigen erneut', async () => {
    // Zwischen Rückfrage und Bestätigung wurde das Mitglied entfernt.
    const c = control(view({ permissions: { ...KEINE_RECHTE, canView: true } }));
    const aus = await handleControlInteraction(
      klick(confirmId(SERVER, 'restart', NOW / 1000)),
      ctx(c),
    );

    expect(aus.followUp).toBeUndefined();
    expect(c.restart).not.toHaveBeenCalled();
  });

  it('gibt die Meldung eines Fachfehlers weiter', async () => {
    const c = control(view({ status: 'stopped' }));
    c.start.mockRejectedValueOnce(new ServerOrchestrationError('SERVER_STATE_CONFLICT'));
    const aus = await handleControlInteraction(klick(actionId(SERVER, 'start')), ctx(c));

    expect((await aus.followUp?.())?.content).toBe(
      new ServerOrchestrationError('SERVER_STATE_CONFLICT').message,
    );
  });

  it('verrät bei einem unerwarteten Fehler keine Interna', async () => {
    const c = control(view({ status: 'stopped' }));
    c.start.mockRejectedValueOnce(new Error('ECONNREFUSED 10.10.0.2:7777'));
    const aus = await handleControlInteraction(klick(actionId(SERVER, 'start')), ctx(c));

    expect((await aus.followUp?.())?.content).not.toContain('10.10.0.2');
  });
});

describe('Sicherung (F8)', () => {
  it('verlangt das Recht, Sicherungen zu verwalten', async () => {
    const c = control(view({ permissions: { ...ALLE_RECHTE, canManageBackups: false } }));
    const aus = await handleControlInteraction(klick(actionId(SERVER, 'backup')), ctx(c));

    expect(aus.followUp).toBeUndefined();
  });

  it('stößt die Sicherung an', async () => {
    const c = control();
    const aus = await handleControlInteraction(klick(actionId(SERVER, 'backup')), ctx(c));

    await aus.followUp?.();
    expect(c.backup).toHaveBeenCalledWith(SERVER, 'u1');
  });
});

describe('Konsole (F11)', () => {
  it('ist ohne Freischaltung für den Server gesperrt', async () => {
    const aus = await handleControlInteraction(
      klick(actionId(SERVER, 'console')),
      ctx(control(view({ consoleEnabled: false }))),
    );

    expect(aus.response.data?.content).toContain('abgeschaltet');
  });

  it('öffnet mit Freischaltung das Eingabefeld', async () => {
    const aus = await handleControlInteraction(
      klick(actionId(SERVER, 'console')),
      ctx(control(view({ consoleEnabled: true }))),
    );

    expect(aus.response.type).toBe(InteractionResponseType.Modal);
    expect(aus.response.data?.custom_id).toBe(consoleModalId(SERVER));
  });

  function modal(wert: string): Interaction {
    return {
      ...klick(consoleModalId(SERVER)),
      type: InteractionType.ModalSubmit,
      data: {
        custom_id: consoleModalId(SERVER),
        components: [{ components: [{ custom_id: CONSOLE_INPUT_ID, value: wert }] }],
      },
    };
  }

  it('führt den Befehl aus und zeigt die Ausgabe', async () => {
    const c = control(view({ consoleEnabled: true }));
    const aus = await handleControlInteraction(modal(' list '), ctx(c));
    const nachricht = await aus.followUp?.();

    expect(c.console).toHaveBeenCalledWith(SERVER, 'list');
    expect(nachricht?.content).toContain('There are 2 players online');
    expect(nachricht?.content).toContain('```');
  });

  it('prüft Freischaltung und Recht auch beim Abschicken', async () => {
    const c = control(view({ consoleEnabled: false }));
    const aus = await handleControlInteraction(modal('stop'), ctx(c));

    expect(aus.followUp).toBeUndefined();
    expect(c.console).not.toHaveBeenCalled();
  });

  it('lehnt einen Befehl mit Zeilenumbruch ab', async () => {
    const c = control(view({ consoleEnabled: true }));
    const aus = await handleControlInteraction(modal('say hi\nop jeder'), ctx(c));

    expect(aus.followUp).toBeUndefined();
    expect(c.console).not.toHaveBeenCalled();
  });

  it('lässt die Ausgabe den Codeblock nicht verlassen', async () => {
    const c = control(view({ consoleEnabled: true }));
    c.console.mockResolvedValueOnce({ stdout: '```\n@everyone', stderr: '' });
    const nachricht = await (await handleControlInteraction(modal('x'), ctx(c))).followUp?.();

    expect(nachricht?.content.match(/```/g)).toHaveLength(2);
  });
});

describe('spielerText (F10)', () => {
  it('listet Namen', () => {
    expect(spielerText({ names: ['Alex'], count: { online: 1, max: 10 } })).toContain('• Alex');
  });

  it('nennt nur die Zahl, wenn das Spiel keine Namen liefert', () => {
    expect(spielerText({ names: [], count: { online: 3, max: 10 } })).toContain('3 Spieler');
  });

  it('sagt ehrlich, wenn es nichts weiß', () => {
    expect(spielerText({ names: [], count: null })).toContain('meldet keine Spieler');
  });
});
