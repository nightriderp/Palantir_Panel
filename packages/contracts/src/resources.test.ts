import { describe, expect, it } from 'vitest';
import {
  HOST_NODE_STATUSES,
  NO_USER_RESOURCE_LIMITS,
  RESOURCE_UNITS,
  isHostNodeStatus,
  unitForResource,
} from './resources.js';

describe('RESOURCE_UNITS', () => {
  it('ordnet jeder Ressourcenart genau eine Einheit zu', () => {
    expect(unitForResource('ram')).toBe('mb');
    expect(unitForResource('disk')).toBe('mb');
    expect(unitForResource('cpu')).toBe('cores');
    expect(unitForResource('servers')).toBe('count');
  });

  it('deckt alle Ressourcenarten ab – ein neuer Wert ohne Einheit bricht den Build', () => {
    expect(Object.keys(RESOURCE_UNITS).sort()).toEqual(['cpu', 'disk', 'ram', 'servers']);
  });
});

describe('isHostNodeStatus', () => {
  it('erkennt die Status aus dem Katalog', () => {
    for (const status of HOST_NODE_STATUSES) {
      expect(isHostNodeStatus(status)).toBe(true);
    }
  });

  it('lehnt Freitext ab', () => {
    expect(isHostNodeStatus('degraded')).toBe(false);
    expect(isHostNodeStatus('')).toBe(false);
  });
});

describe('NO_USER_RESOURCE_LIMITS', () => {
  it('setzt jedes Feld auf null – „kein Limit" ist der Standardfall', () => {
    expect(NO_USER_RESOURCE_LIMITS).toEqual({
      maxRamMb: null,
      maxCpuCores: null,
      maxDiskMb: null,
      maxConcurrentServers: null,
    });
  });

  it('ist eingefroren, damit ein Aufrufer den geteilten Standard nicht verändert', () => {
    expect(Object.isFrozen(NO_USER_RESOURCE_LIMITS)).toBe(true);
  });
});
