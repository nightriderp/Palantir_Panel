import { type HostNodeDto } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { buildSharedAgentTokenWarning } from './sharedAgentTokenWarning';

/**
 * Warnung vor dem Anlegen einer weiteren Node (Fundpunkt 160).
 *
 * Sie ist genau dann fällig, wenn eine bestehende Node noch am gemeinsamen
 * `AGENT_TOKEN` hängt – dann und nur dann kostet eine zweite Node sie ihren
 * Zugang.
 */

function node(overrides: Partial<HostNodeDto> = {}): HostNodeDto {
  const total = { ramMb: 16_384, cpuCores: 8, diskMb: 512_000 };

  return {
    id: 'node-1',
    name: 'Wohnzimmer-PC',
    wireguardIp: '10.10.0.2',
    status: 'online',
    statusMessage: null,
    capacity: { total, allocated: { ramMb: 0, cpuCores: 0, diskMb: 0 }, available: total },
    usage: null,
    serverCount: 0,
    lastSeenAt: null,
    hasAgentToken: false,
    createdAt: '2026-08-01T10:00:00.000Z',
    permissions: { canView: true, canManage: true, canManageStorage: true },
    ...overrides,
  };
}

describe('buildSharedAgentTokenWarning', () => {
  it('warnt, wenn eine bestehende Node kein eigenes Agent-Token hat', () => {
    const warnung = buildSharedAgentTokenWarning([node({ hasAgentToken: false })]);

    expect(warnung).not.toBeNull();
    expect(warnung?.affectedNames).toEqual(['Wohnzimmer-PC']);
    expect(warnung?.headline).toContain('Wohnzimmer-PC');
    expect(warnung?.headline).toContain('AGENT_TOKEN');
  });

  it('warnt nicht, wenn noch gar keine Node besteht', () => {
    expect(buildSharedAgentTokenWarning([])).toBeNull();
  });

  it('warnt nicht, wenn alle bestehenden Nodes ein eigenes Token haben', () => {
    const nodes = [
      node({ id: 'node-1', name: 'Keller', hasAgentToken: true }),
      node({ id: 'node-2', name: 'Dachboden', hasAgentToken: true }),
    ];

    expect(buildSharedAgentTokenWarning(nodes)).toBeNull();
  });

  it('liest ein fehlendes hasAgentToken wie false (das Feld ist im Vertrag optional)', () => {
    expect(buildSharedAgentTokenWarning([node({ hasAgentToken: undefined })])).not.toBeNull();
  });

  it('nennt die Folge, den Weg heraus mit Pfad und Maschine, und das einmalige Token', () => {
    const warnung = buildSharedAgentTokenWarning([node()]);
    const text = warnung?.paragraphs.join(' ') ?? '';

    // Was passiert: erst beim nächsten Verbindungsaufbau, nicht sofort.
    expect(text).toContain('Close-Code 4401');
    expect(text).toContain('beim nächsten Verbindungsaufbau');
    // Was zu tun ist – mit exaktem Pfad und Maschine (CLAUDE.md §9).
    expect(text).toContain('Agent-Token');
    expect(text).toContain('Homeserver');
    expect(text).toContain('/opt/palantir/.env');
    expect(text).toContain('Agent-Stack dort neu starten');
    expect(text).toContain('genau einmal');
    // Und dass die umgekehrte Reihenfolge nichts zerstört.
    expect(text).toContain('verloren geht dabei nichts');
  });

  it('sagt bei bereits zwei Nodes, dass das gemeinsame Token schon jetzt abgelehnt wird', () => {
    const nodes = [
      node({ id: 'node-1', name: 'Keller', hasAgentToken: false }),
      node({ id: 'node-2', name: 'Dachboden', hasAgentToken: true }),
    ];

    const text = buildSharedAgentTokenWarning(nodes)?.paragraphs.join(' ') ?? '';

    expect(text).toContain('schon jetzt nicht mehr herein');
    expect(text).not.toContain('beim nächsten Verbindungsaufbau');
  });

  it('zählt mehrere tokenlose Nodes auf und formuliert sie im Plural', () => {
    const nodes = [
      node({ id: 'node-1', name: 'Keller', hasAgentToken: false }),
      node({ id: 'node-2', name: 'Dachboden', hasAgentToken: false }),
    ];

    const warnung = buildSharedAgentTokenWarning(nodes);

    expect(warnung?.affectedNames).toEqual(['Keller', 'Dachboden']);
    expect(warnung?.headline).toContain('„Keller“ und „Dachboden“');
    expect(warnung?.headline).toContain('hängen');
    expect(warnung?.acknowledgeDescription).toContain('bleiben ohne Zugang');
  });
});
