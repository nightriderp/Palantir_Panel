/**
 * Die Serverkarte zeichnet nur neu, wenn sich ihre eigenen Angaben ändern
 * (Leistungsbericht 19.09.2026, Punkt 3).
 *
 * Geprüft wird die Hülle, nicht das Aussehen: Eine Live-Meldung für einen
 * anderen Server ließ bisher jede Karte der Übersicht neu zeichnen.
 */

import { type GameServerDto, type ServerLiveStats } from '@palantir/contracts';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ServerCard } from './ServerCard';

afterEach(cleanup);

const SERVER = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Die OGs',
  gameType: 'minecraft-vanilla',
  gameTypeName: 'Minecraft',
  gameVersion: '1.21.4',
  status: 'running',
  statusMessage: null,
  ownerId: '22222222-2222-4222-8222-222222222222',
  ownerDisplayName: 'Besitzerin',
  hostName: 'Homeserver',
  hostCpuCores: 8,
  hostRamMb: 32_768,
  address: null,
  assignedPorts: [],
  resourceLimits: { ramMb: 4096 },
  autoShutdownEnabled: false,
  autoShutdownTimeoutMinutes: null,
  startupParameters: '',
  config: {},
  dockerContainerId: null,
  pendingRestart: false,
  updateAvailable: false,
  imageVersion: '9',
  latestImageVersion: '9',
  memberCount: 1,
  pinned: false,
  lastStartedAt: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  permissions: {
    canView: true,
    canViewAddress: true,
    canStart: true,
    canStop: true,
    canRestart: true,
    canUpdate: false,
    canDelete: false,
    canManageFiles: false,
    canManageSettings: false,
    canManageMembers: false,
    canManageBackups: false,
    canUseConsole: false,
  },
} as unknown as GameServerDto;

const STATS = {
  cpuPercent: 120,
  memoryUsedMb: 2048,
  memoryLimitMb: 4096,
  diskUsedMb: 10_240,
  playersOnline: 3,
  playersMax: 20,
  pingMs: 12,
  uptimeSeconds: 600,
} as unknown as ServerLiveStats;

describe('ServerCard – Memoisierung', () => {
  it('ist als memoisierte Komponente ausgeliefert', () => {
    /*
     * Direkt an der Huelle geprueft statt ueber gezaehlte Durchlaeufe: React
     * bietet keinen Weg, das Ueberspringen eines Renders von aussen zu
     * beobachten, und ein selbstgebauter Zaehler zaehlte am Ende die
     * Testhuelle statt der Karte.
     */
    expect((ServerCard as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'));
  });

  it('zeichnet neu, sobald sich die eigenen Werte ändern', () => {
    const stabil = (): void => undefined;
    const { container, rerender } = render(
      <ServerCard server={SERVER} stats={STATS} onOpen={stabil} onCopyAddress={stabil} />,
    );

    expect(container.textContent).toContain('Die OGs');

    const umbenannt = { ...SERVER, name: 'Zweitserver' };

    rerender(
      <ServerCard server={umbenannt} stats={STATS} onOpen={stabil} onCopyAddress={stabil} />,
    );

    expect(container.textContent).toContain('Zweitserver');
  });
});
