import { describe, expect, it } from 'vitest';
import {
  compareServers,
  groupServers,
  isOnlineStatus,
  matchesFilter,
  matchesSearch,
} from './serverList';
import { server } from './testFixtures';

describe('isOnlineStatus', () => {
  it('zählt laufende und umschaltende Zustände als online', () => {
    expect(isOnlineStatus('running')).toBe(true);
    expect(isOnlineStatus('starting')).toBe(true);
    expect(isOnlineStatus('stopping')).toBe(true);
  });

  it('zählt ruhende und gestörte Zustände als offline', () => {
    expect(isOnlineStatus('stopped')).toBe(false);
    expect(isOnlineStatus('creating')).toBe(false);
    expect(isOnlineStatus('error')).toBe(false);
    expect(isOnlineStatus('crashed')).toBe(false);
  });
});

describe('matchesFilter', () => {
  const running = server({ id: 'a', status: 'running' });
  const stopped = server({ id: 'b', status: 'stopped' });

  it('lässt bei „Alle" jeden durch', () => {
    expect(matchesFilter(running, 'all')).toBe(true);
    expect(matchesFilter(stopped, 'all')).toBe(true);
  });

  it('trennt online und offline', () => {
    expect(matchesFilter(running, 'online')).toBe(true);
    expect(matchesFilter(running, 'offline')).toBe(false);
    expect(matchesFilter(stopped, 'offline')).toBe(true);
    expect(matchesFilter(stopped, 'online')).toBe(false);
  });
});

describe('matchesSearch', () => {
  const target = server({
    id: 'a',
    name: 'Survival Runde',
    subdomain: 'survival',
    gameTypeName: 'Minecraft (Paper)',
    ownerDisplayName: 'Alex',
    hostName: 'Node Alpha',
  });

  it('findet über Name, Spiel, Subdomain, Besitzer und Node', () => {
    for (const needle of ['survival', 'MINECRAFT', 'alex', 'node alpha']) {
      expect(matchesSearch(target, needle)).toBe(true);
    }
  });

  it('lässt bei leerem Begriff alles durch', () => {
    expect(matchesSearch(target, '')).toBe(true);
    expect(matchesSearch(target, '   ')).toBe(true);
  });

  it('meldet keinen Treffer bei fremdem Begriff', () => {
    expect(matchesSearch(target, 'creative')).toBe(false);
  });
});

describe('compareServers', () => {
  it('stellt Störungen und Übergänge vor ruhende Server', () => {
    const sorted = [
      server({ id: '1', name: 'A', status: 'stopped' }),
      server({ id: '2', name: 'B', status: 'crashed' }),
      server({ id: '3', name: 'C', status: 'running' }),
      server({ id: '4', name: 'D', status: 'starting' }),
    ].sort(compareServers);

    expect(sorted.map((entry) => entry.status)).toEqual([
      'crashed',
      'starting',
      'running',
      'stopped',
    ]);
  });

  it('sortiert bei gleichem Zustand nach Name', () => {
    const sorted = [
      server({ id: '1', name: 'Zeta', status: 'running' }),
      server({ id: '2', name: 'Alpha', status: 'running' }),
      server({ id: '3', name: 'Ärger', status: 'running' }),
    ].sort(compareServers);

    expect(sorted.map((entry) => entry.name)).toEqual(['Alpha', 'Ärger', 'Zeta']);
  });
});

describe('groupServers', () => {
  const own = server({ id: 'own-1', name: 'Meiner', ownerId: 'me' });
  const foreign = server({ id: 'other-1', name: 'Fremder', ownerId: 'someone' });
  const pinnedOwn = server({ id: 'own-2', name: 'Angeheftet', ownerId: 'me' });

  it('trennt angeheftet, eigene und fremde Server', () => {
    const result = groupServers({
      servers: [own, foreign, pinnedOwn],
      filter: 'all',
      search: '',
      currentUserId: 'me',
      pinnedIds: ['own-2'],
    });

    expect(result.groups.map((group) => group.key)).toEqual(['pinned', 'own', 'other']);
    expect(result.groups[0]?.servers.map((entry) => entry.id)).toEqual(['own-2']);
    expect(result.groups[1]?.servers.map((entry) => entry.id)).toEqual(['own-1']);
    expect(result.groups[2]?.servers.map((entry) => entry.id)).toEqual(['other-1']);
  });

  it('zeigt einen angehefteten Server nur einmal', () => {
    const result = groupServers({
      servers: [own, pinnedOwn],
      filter: 'all',
      search: '',
      currentUserId: 'me',
      pinnedIds: ['own-2'],
    });

    const ids = result.groups.flatMap((group) => group.servers.map((entry) => entry.id));
    expect(ids).toEqual(['own-2', 'own-1']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lässt leere Gruppen weg', () => {
    const result = groupServers({
      servers: [own],
      filter: 'all',
      search: '',
      currentUserId: 'me',
      pinnedIds: [],
    });

    expect(result.groups.map((group) => group.key)).toEqual(['own']);
  });

  it('meldet Gesamtzahl und gefilterte Anzahl getrennt', () => {
    const result = groupServers({
      servers: [own, foreign, pinnedOwn],
      filter: 'all',
      search: 'Fremder',
      currentUserId: 'me',
      pinnedIds: ['own-2'],
    });

    expect(result.totalCount).toBe(3);
    expect(result.visibleCount).toBe(1);
    expect(result.groups.map((group) => group.key)).toEqual(['other']);
  });

  it('zählt ohne angemeldeten Nutzer alles als fremde Server', () => {
    const result = groupServers({
      servers: [own, foreign],
      filter: 'all',
      search: '',
      currentUserId: null,
      pinnedIds: [],
    });

    expect(result.groups.map((group) => group.key)).toEqual(['other']);
    expect(result.groups[0]?.servers).toHaveLength(2);
  });
});
