import {
  type HostNodeDto,
  type ResourceKind,
  type ResourceQuotaDto,
  type SubdomainAvailabilityDto,
  resourceQuotaSlot,
} from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import {
  INITIAL_WIZARD_STATE,
  type WizardContext,
  type WizardState,
  applyGameType,
  buildSummaryRows,
  defaultConfigValues,
  missingConfigFields,
  nodeBlockReason,
  quotaBlockReason,
  stepBlockReason,
} from './wizardSteps';
import { gameType } from './testFixtures';

const NODE: HostNodeDto = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Node Alpha',
  wireguardIp: '10.10.0.2',
  status: 'online',
  statusMessage: null,
  capacity: {
    total: { ramMb: 32768, cpuCores: 16, diskMb: 1024000 },
    allocated: { ramMb: 16384, cpuCores: 8, diskMb: 512000 },
    available: { ramMb: 16384, cpuCores: 8, diskMb: 512000 },
  },
  usage: null,
  serverCount: 6,
  lastSeenAt: null,
  createdAt: '2026-08-01T10:00:00.000Z',
  permissions: { canView: true, canManage: false, canManageStorage: false },
};

/** Node mit genau den angegebenen freien Werten. */
function nodeWithFree(free: { ramMb?: number; cpuCores?: number; diskMb?: number }): HostNodeDto {
  return {
    ...NODE,
    capacity: {
      ...NODE.capacity,
      available: {
        ramMb: free.ramMb ?? NODE.capacity.available.ramMb,
        cpuCores: free.cpuCores ?? NODE.capacity.available.cpuCores,
        diskMb: free.diskMb ?? NODE.capacity.available.diskMb,
      },
    },
  };
}

const AVAILABLE: SubdomainAvailabilityDto = {
  subdomain: 'survival',
  available: true,
  reason: null,
  message: 'Diese Adresse ist frei.',
  fullHostname: 'survival.example.tld',
};

function state(overrides: Partial<WizardState> = {}): WizardState {
  return {
    ...INITIAL_WIZARD_STATE,
    gameType: 'testserver',
    name: 'Survival Runde',
    subdomain: 'survival',
    hostId: NODE.id,
    ...overrides,
  };
}

function context(overrides: Partial<WizardContext> = {}): WizardContext {
  return {
    gameType: gameType(),
    node: NODE,
    quota: null,
    subdomainCheck: AVAILABLE,
    subdomainChecking: false,
    ...overrides,
  };
}

describe('defaultConfigValues / applyGameType', () => {
  const withFields = gameType({
    resourceDefaults: { ramMb: 8192, cpuCores: 4, diskMb: 40960 },
    configFields: [
      {
        key: 'maxPlayers',
        label: 'Maximale Spieleranzahl',
        type: 'number',
        description: null,
        required: true,
        defaultValue: 20,
        options: [],
        min: 1,
        max: 100,
        lockedAfterCreate: false,
      },
      {
        key: 'pvp',
        label: 'PvP',
        type: 'toggle',
        description: null,
        required: false,
        defaultValue: true,
        options: [],
        min: null,
        max: null,
        lockedAfterCreate: false,
      },
    ],
  });

  it('übernimmt die Standardwerte des Config-Schemas', () => {
    expect(defaultConfigValues(withFields)).toEqual({ maxPlayers: 20, pvp: true });
  });

  it('übernimmt die Ressourcen-Empfehlung, behält aber die Eingaben', () => {
    const next = applyGameType(state({ name: 'Bereits getippt' }), withFields);

    expect(next.ramMb).toBe(8192);
    expect(next.cpuCores).toBe(4);
    expect(next.diskMb).toBe(40960);
    expect(next.name).toBe('Bereits getippt');
    expect(next.subdomain).toBe('survival');
    expect(next.config).toEqual({ maxPlayers: 20, pvp: true });
  });

  it('verwirft gewählte Weltdaten, wenn das Spiel keine Übernahme kann', () => {
    const withImport = state({ worldImport: { uploadId: 'x', fileName: 'welt.zip' } });
    expect(
      applyGameType(withImport, gameType({ supportsWorldImport: false })).worldImport,
    ).toBeNull();
    expect(
      applyGameType(withImport, gameType({ supportsWorldImport: true })).worldImport,
    ).not.toBeNull();
  });
});

describe('missingConfigFields', () => {
  const required = gameType({
    configFields: [
      {
        key: 'motd',
        label: 'Willkommensnachricht',
        type: 'text',
        description: null,
        required: true,
        defaultValue: '',
        options: [],
        min: null,
        max: null,
        lockedAfterCreate: false,
      },
      {
        key: 'seed',
        label: 'Welt-Seed',
        type: 'text',
        description: null,
        required: false,
        defaultValue: '',
        options: [],
        min: null,
        max: null,
        lockedAfterCreate: true,
      },
    ],
  });

  it('meldet leere Pflichtfelder, freiwillige aber nicht', () => {
    expect(missingConfigFields(required, { motd: '', seed: '' }).map((f) => f.key)).toEqual([
      'motd',
    ]);
    expect(missingConfigFields(required, { motd: '   ', seed: '' }).map((f) => f.key)).toEqual([
      'motd',
    ]);
    expect(missingConfigFields(required, { motd: 'Hallo', seed: '' })).toEqual([]);
  });

  it('meldet nichts, solange kein Spiel gewählt ist', () => {
    expect(missingConfigFields(null, {})).toEqual([]);
  });
});

describe('quotaBlockReason', () => {
  /**
   * Kontingent mit Limit und Belegung je Ressourcenart.
   *
   * Die Slots entstehen über `resourceQuotaSlot()` aus den Contracts – dieselbe
   * Ableitung „Rest = Limit − Belegung, nie negativ", die auch das Backend
   * benutzt. So prüft der Test gegen die echte Rechenregel und nicht gegen
   * einen von Hand gesetzten `remaining`-Wert.
   */
  function quota(
    limits: Partial<Record<ResourceKind, number | null>> = {},
    used: Partial<Record<ResourceKind, number>> = {},
  ): ResourceQuotaDto {
    const slot = (resource: ResourceKind) =>
      resourceQuotaSlot(resource, limits[resource] ?? null, used[resource] ?? 0);

    return {
      userId: '33333333-3333-4333-8333-333333333333',
      ram: slot('ram'),
      cpu: slot('cpu'),
      disk: slot('disk'),
      servers: slot('servers'),
      updatedAt: null,
      permissions: { canView: true, canEdit: false },
    };
  }

  it('lässt ohne gesetztes Limit alles zu (Lastenheft §3.4)', () => {
    expect(quotaBlockReason(quota(), state({ ramMb: 65536 }))).toBeNull();
    expect(quotaBlockReason(null, state({ ramMb: 65536 }))).toBeNull();
  });

  it('meldet ein ausgeschöpftes Server-Kontingent', () => {
    const reason = quotaBlockReason(quota({ servers: 2 }, { servers: 2 }), state());
    expect(reason).toContain('2 Server');
  });

  it('rechnet die bereits belegten Ressourcen mit ein', () => {
    const almostFull = quota({ ram: 8192 }, { ram: 7168 });
    expect(quotaBlockReason(almostFull, state({ ramMb: 1024 }))).toBeNull();
    expect(quotaBlockReason(almostFull, state({ ramMb: 2048 }))).toContain('RAM-Kontingent');
  });

  it('lässt den Rest exakt aufbrauchen, aber nicht überschreiten', () => {
    const rest = quota({ ram: 8192 }, { ram: 6144 });
    expect(quotaBlockReason(rest, state({ ramMb: 2048 }))).toBeNull();
    expect(quotaBlockReason(rest, state({ ramMb: 2049 }))).toContain('RAM-Kontingent');
  });

  it('meldet ein überzogenes Kontingent, statt einen negativen Rest zu rechnen', () => {
    // `remaining` ist nie negativ (Contracts); ein bereits überzogenes
    // Kontingent hat Rest 0 und blockiert damit jeden weiteren Wunsch.
    const over = quota({ ram: 4096 }, { ram: 8192 });
    expect(over.ram.remaining).toBe(0);
    expect(quotaBlockReason(over, state({ ramMb: 1 }))).toContain('RAM-Kontingent');
  });

  it('prüft CPU und Speicherplatz ebenfalls', () => {
    expect(quotaBlockReason(quota({ cpu: 2 }, { cpu: 1 }), state({ cpuCores: 2 }))).toContain(
      'CPU-Kontingent',
    );
    expect(
      quotaBlockReason(quota({ disk: 20480 }, { disk: 10240 }), state({ diskMb: 20480 })),
    ).toContain('Speicher-Kontingent');
  });
});

describe('nodeBlockReason', () => {
  it('meldet nichts bei genug freiem Platz', () => {
    expect(nodeBlockReason(NODE, state())).toBeNull();
  });

  it('unterscheidet Wartung von Nichterreichbarkeit', () => {
    expect(nodeBlockReason({ ...NODE, status: 'offline' }, state())).toContain('nicht erreichbar');
    expect(nodeBlockReason({ ...NODE, status: 'maintenance' }, state())).toContain('Wartung');
  });

  it('meldet zu wenig freien Arbeitsspeicher, CPU oder Platte', () => {
    expect(nodeBlockReason(nodeWithFree({ ramMb: 1024 }), state({ ramMb: 4096 }))).toContain(
      'Arbeitsspeicher',
    );
    expect(nodeBlockReason(nodeWithFree({ diskMb: 1024 }), state({ diskMb: 20480 }))).toContain(
      'Speicherplatz',
    );
    expect(nodeBlockReason(nodeWithFree({ cpuCores: 1 }), state({ cpuCores: 4 }))).toContain(
      'CPU-Kerne',
    );
  });

  it('lässt Gleichstand zu – erst darüber wird abgelehnt', () => {
    expect(nodeBlockReason(nodeWithFree({ ramMb: 4096 }), state({ ramMb: 4096 }))).toBeNull();
    expect(nodeBlockReason(nodeWithFree({ ramMb: 4095 }), state({ ramMb: 4096 }))).not.toBeNull();
  });
});

describe('stepBlockReason', () => {
  it('verlangt im ersten Schritt ein verfügbares Spiel', () => {
    expect(stepBlockReason('game', state({ gameType: null }), context())).toBe(
      'Wähle zuerst ein Spiel.',
    );

    const locked = gameType({ available: false, unavailableReason: 'Kommt in Phase 2.' });
    expect(stepBlockReason('game', state(), context({ gameType: locked }))).toBe(
      'Kommt in Phase 2.',
    );

    expect(stepBlockReason('game', state(), context())).toBeNull();
  });

  it('lässt die Grundlagen erst durch, wenn alles beisammen ist', () => {
    expect(stepBlockReason('basics', state(), context())).toBeNull();
  });

  it('meldet einen zu kurzen Namen', () => {
    expect(stepBlockReason('basics', state({ name: 'ab' }), context())).toContain('3 Zeichen');
  });

  it('meldet eine reservierte oder falsch geschriebene Subdomain', () => {
    expect(stepBlockReason('basics', state({ subdomain: 'admin' }), context())).toContain(
      'reserviert',
    );
    expect(stepBlockReason('basics', state({ subdomain: '-abc' }), context())).toContain(
      'Kleinbuchstaben',
    );
  });

  it('wartet auf die laufende Verfügbarkeitsprüfung', () => {
    expect(
      stepBlockReason(
        'basics',
        state(),
        context({ subdomainChecking: true, subdomainCheck: null }),
      ),
    ).toContain('geprüft');
  });

  it('übernimmt die Meldung des Backends bei belegter Subdomain', () => {
    const taken: SubdomainAvailabilityDto = {
      subdomain: 'survival',
      available: false,
      reason: 'taken',
      message: 'Diese Subdomain ist bereits vergeben.',
      fullHostname: 'survival.example.tld',
    };
    expect(stepBlockReason('basics', state(), context({ subdomainCheck: taken }))).toBe(
      'Diese Subdomain ist bereits vergeben.',
    );
  });

  it('verlangt eine Node-Wahl', () => {
    expect(stepBlockReason('basics', state({ hostId: null }), context({ node: null }))).toBe(
      'Wähle eine Node.',
    );
  });

  it('führt im letzten Schritt alle vorherigen Prüfungen erneut aus', () => {
    expect(stepBlockReason('summary', state(), context())).toBeNull();
    expect(stepBlockReason('summary', state({ name: 'ab' }), context())).toContain('3 Zeichen');
    expect(stepBlockReason('summary', state({ gameType: null }), context())).toBe(
      'Wähle zuerst ein Spiel.',
    );
  });
});

describe('buildSummaryRows', () => {
  it('fasst die Eingaben mit deutscher Beschriftung zusammen', () => {
    const rows = buildSummaryRows(state(), context(), 'example.tld');
    const byLabel = Object.fromEntries(rows.map((row) => [row.label, row.value]));

    expect(byLabel['Spiel']).toBe('Testserver');
    expect(byLabel['Name']).toBe('Survival Runde');
    expect(byLabel['Adresse']).toBe('survival.example.tld');
    expect(byLabel['Node']).toBe('Node Alpha');
    expect(byLabel['Automatisch abschalten']).toBe('An');
  });

  it('zeigt Startparameter und Weltdaten nur, wenn es sie gibt', () => {
    const plain = buildSummaryRows(state(), context(), 'example.tld');
    expect(plain.some((row) => row.label === 'Startparameter')).toBe(false);
    expect(plain.some((row) => row.label === 'Weltdaten')).toBe(false);

    const rich = buildSummaryRows(
      state({
        startupParameters: '-Xmx4G',
        worldImport: { uploadId: 'u1', fileName: 'welt.zip' },
      }),
      context(),
      'example.tld',
    );
    expect(rich.find((row) => row.label === 'Startparameter')?.value).toBe('-Xmx4G');
    expect(rich.find((row) => row.label === 'Weltdaten')?.value).toContain('welt.zip');
  });

  it('zeigt Passwortfelder verdeckt', () => {
    const withPassword = gameType({
      configFields: [
        {
          key: 'rconPassword',
          label: 'RCON-Passwort',
          type: 'password',
          description: null,
          required: false,
          defaultValue: '',
          options: [],
          min: null,
          max: null,
          lockedAfterCreate: false,
        },
      ],
    });

    const rows = buildSummaryRows(
      state({ config: { rconPassword: 'geheim' } }),
      context({ gameType: withPassword }),
      'example.tld',
    );
    expect(rows.find((row) => row.label === 'RCON-Passwort')?.value).toBe('••••••');
  });
});
