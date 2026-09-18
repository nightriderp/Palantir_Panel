/**
 * Tests der Kapazitätsprüfung (Entwicklungsregeln §4 – zwingend für diese Logik).
 *
 * Die Rahmenwerte der Node entsprechen der Hardware aus Lastenheft §5
 * (32 GB RAM, 16 Threads, 2 TB nutzbar), stehen hier aber als Testdaten und
 * nicht als Konstante im Code – im Betrieb kommen sie aus `HostNode`.
 */

import { NO_USER_RESOURCE_LIMITS, type UserResourceLimits } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { type CapacityCheckInput, checkCapacity } from './capacity.js';

const NODE_ID = 'a1e5b6c2-0000-4000-8000-000000000001';
const AT = new Date('2026-08-26T12:00:00.000Z');

/** Node mit den Werten aus Lastenheft §5, standardmäßig leer. */
function input(overrides: {
  requested?: Partial<CapacityCheckInput['requested']>;
  userLimits?: UserResourceLimits;
  userUsage?: Partial<CapacityCheckInput['userUsage']>;
  nodeTotal?: Partial<CapacityCheckInput['node']['total']>;
  nodeUsage?: Partial<CapacityCheckInput['node']['usage']>;
  /** Gemessener freier Platz; `null` steht fuer „keine frische Messung". */
  freeDiskMb?: number | null;
  /** Gemessener freier Arbeitsspeicher; `null` steht fuer „keine frische Messung". */
  freeRamMb?: number | null;
  intent?: CapacityCheckInput['intent'];
  thresholds?: Partial<CapacityCheckInput['thresholds']>;
}): CapacityCheckInput {
  return {
    requested: { ramMb: 4096, diskMb: 20_480, ...overrides.requested },
    userLimits: overrides.userLimits ?? NO_USER_RESOURCE_LIMITS,
    userUsage: {
      runningRamMb: 0,
      runningServers: 0,
      totalServers: 0,
      ...overrides.userUsage,
    },
    node: {
      nodeId: NODE_ID,
      total: { ramMb: 32_768, cpuCores: 8, diskMb: 2_097_152, ...overrides.nodeTotal },
      usage: {
        runningRamMb: 0,
        runningServers: 0,
        totalServers: 0,
        ...overrides.nodeUsage,
      },
      freeDiskMb: overrides.freeDiskMb === undefined ? 2_000_000 : overrides.freeDiskMb,
      // Vorgabe: eine gemessene, vollstaendig freie Maschine. So schlaegt die
      // Messung nur dort an, wo ein Test sie ausdruecklich setzt.
      freeRamMb: overrides.freeRamMb === undefined ? 32_768 : overrides.freeRamMb,
    },
    intent: overrides.intent ?? 'start',
    thresholds: { nodePercent: 85, serverPercent: 90, ...overrides.thresholds },
    at: AT,
  };
}

describe('checkCapacity – kein Nutzer-Kontingent gesetzt', () => {
  it('erlaubt den Start, wenn die Node Platz hat', () => {
    const result = checkCapacity(input({}));

    expect(result.allowed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('fragt bei einer vollen Node nach, statt abzulehnen', () => {
    const result = checkCapacity(
      input({
        requested: { ramMb: 8192 },
        // Gemessen: 30 GiB belegt. Seit der weichen Zuweisung (2026-09-18)
        // zaehlt nur die Messung, nicht die Summe der Buchungen.
        freeRamMb: 2_768,
      }),
    );

    // Keine Grenze ist überschritten – die Maschine ist nur voll. Das ist eine
    // Rückfrage an den Betreiber, keine Ablehnung.
    expect(result.allowed).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.concerns).toEqual([
      {
        scope: 'nodeMeasured',
        resource: 'ram',
        unit: 'mb',
        limit: 32_768,
        used: 30_000,
        requested: 8192,
      },
    ]);
  });

  it('merkt die Summe der Buchungen nicht mehr an – sie sagt nichts ueber die Node', () => {
    // Ein Server mit 2 GiB Zuweisung darf 10 GiB belegen; umgekehrt kann eine
    // Node mit 30 GiB Buchungen fast leer sein. Ohne Messung keine Rueckfrage.
    const result = checkCapacity(
      input({ requested: { ramMb: 8192 }, nodeUsage: { runningRamMb: 30_000 }, freeRamMb: null }),
    );

    expect(result.concerns).toEqual([]);
  });

  it('behandelt einzelne null-Felder wie „kein Limit" und prüft die übrigen', () => {
    const result = checkCapacity(
      input({
        requested: { ramMb: 16_384 },
        userLimits: {
          maxRamMb: null,
          maxConcurrentServers: null,
        },
        userUsage: { runningRamMb: 60_000 },
        freeRamMb: 12_768,
      }),
    );

    // RAM ist beim Nutzer unbegrenzt – abgelehnt wird nichts, angemerkt die Node.
    expect(result.violations).toEqual([]);
    expect(result.concerns?.map((v) => `${v.scope}.${v.resource}`)).toEqual(['nodeMeasured.ram']);
  });
});

describe('checkCapacity – Limit exakt erreicht', () => {
  it('erlaubt den Start, wenn das Nutzer-Kontingent punktgenau aufgeht', () => {
    const result = checkCapacity(
      input({
        requested: { ramMb: 2048, diskMb: 10_240 },
        userLimits: {
          maxRamMb: 8192,
          maxConcurrentServers: 3,
        },
        userUsage: {
          runningRamMb: 6144,
          runningServers: 2,
        },
      }),
    );

    expect(result.allowed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('erlaubt den Start, wenn die Node punktgenau aufgeht', () => {
    const result = checkCapacity(
      input({
        requested: { ramMb: 2768, diskMb: 152 },
        nodeUsage: { runningRamMb: 30_000 },
      }),
    );

    expect(result.allowed).toBe(true);
  });

  it('prueft das RAM-Kontingent des Nutzers nicht mehr (weiche Grenze, 2026-09-18)', () => {
    // `maxRamMb` bleibt im Datensatz fuer den Altbestand, wirkt aber nicht:
    // Ein Server nimmt sich, was auf der Node frei ist.
    const result = checkCapacity(
      input({
        requested: { ramMb: 2049 },
        userLimits: { ...NO_USER_RESOURCE_LIMITS, maxRamMb: 8192 },
        userUsage: { runningRamMb: 6144 },
      }),
    );

    expect(result.allowed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('kennt keine CPU-Grenze mehr', () => {
    // Die CPU-Zuweisung ist entfallen: Ein Server nimmt sich die Kerne, die er
    // braucht. Es darf deshalb keinen Weg mehr geben, auf dem ein Start an
    // einer CPU-Schranke scheitert – weder am Kontingent noch an der Node.
    const result = checkCapacity(
      input({
        requested: { ramMb: 1024, diskMb: 1024 },
        userLimits: NO_USER_RESOURCE_LIMITS,
      }),
    );

    expect(result.allowed).toBe(true);
    expect(result.violations.map((v) => v.resource)).not.toContain('cpu');
  });
});

describe('checkCapacity – Node voll trotz freiem Nutzer-Kontingent', () => {
  it('merkt beides an, wenn Buchung und Messung eng sind', () => {
    const result = checkCapacity(
      input({
        requested: { ramMb: 8192, diskMb: 20_480 },
        userLimits: {
          maxRamMb: 65_536,
          maxConcurrentServers: 50,
        },
        userUsage: { runningRamMb: 1024 },
        // Gemessen: 31 GiB belegt und nur noch 10 GiB Platte frei – der
        // Server braucht 8 GiB bzw. 20 GiB.
        freeRamMb: 1_768,
        freeDiskMb: 10_240,
      }),
    );

    expect(result.allowed).toBe(true);
    expect(result.concerns?.map((v) => `${v.scope}.${v.resource}`)).toEqual([
      'nodeMeasured.ram',
      'nodeMeasured.disk',
    ]);
  });

  it('trennt die Grenze des Nutzers von der Enge der Node', () => {
    const result = checkCapacity(
      input({
        requested: { ramMb: 16_384 },
        userLimits: { ...NO_USER_RESOURCE_LIMITS, maxConcurrentServers: 1 },
        userUsage: { runningServers: 1 },
        freeRamMb: 2_768,
      }),
    );

    // Das Kontingent (Anzahl) lehnt ab; die volle Node steht daneben als
    // Anmerkung – ein `force` hätte hier nichts zu bestellen.
    expect(result.allowed).toBe(false);
    expect(result.violations.map((v) => `${v.scope}.${v.resource}`)).toEqual(['user.servers']);
    expect(result.concerns?.map((v) => `${v.scope}.${v.resource}`)).toEqual(['nodeMeasured.ram']);
  });
});

describe('checkCapacity – Anzahl gleichzeitiger Server', () => {
  it('lehnt den Start ab, wenn die erlaubte Anzahl erreicht ist', () => {
    const result = checkCapacity(
      input({
        userLimits: { ...NO_USER_RESOURCE_LIMITS, maxConcurrentServers: 2 },
        userUsage: { runningServers: 2 },
      }),
    );

    expect(result.violations).toEqual([
      { scope: 'user', resource: 'servers', unit: 'count', limit: 2, used: 2, requested: 1 },
    ]);
  });

  it('erlaubt den letzten freien Platz', () => {
    const result = checkCapacity(
      input({
        userLimits: { ...NO_USER_RESOURCE_LIMITS, maxConcurrentServers: 2 },
        userUsage: { runningServers: 1 },
      }),
    );

    expect(result.allowed).toBe(true);
  });

  it('lehnt bei einem Kontingent von 0 jeden Start ab – 0 ist kein „kein Limit"', () => {
    const result = checkCapacity(
      input({ userLimits: { ...NO_USER_RESOURCE_LIMITS, maxConcurrentServers: 0 } }),
    );

    expect(result.allowed).toBe(false);
    expect(result.violations[0]?.resource).toBe('servers');
  });
});

describe('checkCapacity – Speicherplatz aus der Messung', () => {
  it('lehnt das Anlegen ab, wenn der gemessene freie Platz nicht reicht', () => {
    const result = checkCapacity(
      input({
        intent: 'create',
        requested: { diskMb: 20_480 },
        // 2 TiB Gesamtgroesse, davon nur noch 10 GiB frei.
        freeDiskMb: 10_240,
      }),
    );

    expect(result.allowed).toBe(false);
    expect(result.violations[0]).toMatchObject({
      scope: 'nodeMeasured',
      resource: 'disk',
      // `used` ist der tatsaechlich belegte Platz, nicht eine Summe von
      // Zuweisungen: Gesamt minus frei.
      used: 2_097_152 - 10_240,
      requested: 20_480,
    });
  });

  it('fragt beim Start nur nach, statt abzulehnen', () => {
    const result = checkCapacity(input({ requested: { diskMb: 20_480 }, freeDiskMb: 10_240 }));

    expect(result.allowed).toBe(true);
    expect(result.concerns?.map((v) => `${v.scope}.${v.resource}`)).toEqual(['nodeMeasured.disk']);
  });

  it('laesst Gleichstand zu – erst darueber wird abgelehnt', () => {
    const anlegen = (diskMb: number) =>
      checkCapacity(input({ intent: 'create', requested: { diskMb }, freeDiskMb: 20_480 })).allowed;

    expect(anlegen(20_480)).toBe(true);
    expect(anlegen(20_481)).toBe(false);
  });

  it('prueft die Platte gar nicht, wenn keine Messung vorliegt', () => {
    /*
     * Node offline, Agent frisch gestartet, Messung veraltet: Dann gibt es
     * keine Auskunft. Das Anlegen soll daran nicht scheitern - lieber ein
     * Server, der spaeter an die Grenze laeuft, als einer, der wegen einer
     * fehlenden Zahl gar nicht erst entsteht.
     */
    const result = checkCapacity(
      input({ intent: 'create', requested: { diskMb: 999_999_999 }, freeDiskMb: null }),
    );

    expect(result.allowed).toBe(true);
    expect(result.violations.map((v) => v.resource)).not.toContain('disk');
  });

  it('kennt kein Platten-Kontingent des Nutzers mehr', () => {
    // Es summierte Zuweisungen, die es nicht mehr gibt.
    const result = checkCapacity(
      input({ requested: { diskMb: 1024 }, userLimits: NO_USER_RESOURCE_LIMITS }),
    );

    expect(result.violations.filter((v) => v.scope === 'user')).toEqual([]);
  });
});

/*
 * Die Zahl, an der ein Start wirklich scheitert: Der Kernel gibt keinen
 * Speicher her, den es nicht gibt. Die Buchhaltung kann derweil sagen, es sei
 * alles frei – wenn neben den Gameservern noch etwas anderes auf dem
 * Homeserver laeuft, stimmt das eben nicht.
 */
describe('checkCapacity – gemessener freier Arbeitsspeicher', () => {
  it('merkt an, wenn die Messung weniger frei sieht als die Buchung', () => {
    const result = checkCapacity(
      input({
        requested: { ramMb: 8192 },
        // Gebucht ist nichts, gemessen sind nur 4 GiB frei: Daneben laeuft
        // etwas, das die Buchhaltung nicht kennt.
        nodeUsage: { runningRamMb: 0 },
        freeRamMb: 4096,
      }),
    );

    expect(result.allowed).toBe(true);
    expect(result.concerns).toEqual([
      {
        scope: 'nodeMeasured',
        resource: 'ram',
        unit: 'mb',
        limit: 32_768,
        used: 32_768 - 4096,
        requested: 8192,
      },
    ]);
  });

  it('laesst Gleichstand zu – erst darueber wird gefragt', () => {
    const frei = (ramMb: number) =>
      checkCapacity(input({ requested: { ramMb }, freeRamMb: 4096 })).concerns ?? [];

    expect(frei(4096)).toEqual([]);
    expect(frei(4097)).toHaveLength(1);
  });

  it('schweigt ohne frische Messung', () => {
    const result = checkCapacity(input({ requested: { ramMb: 32_768 }, freeRamMb: null }));

    expect(result.concerns).toEqual([]);
  });

  it('fragt beim Anlegen gar nicht nach RAM – ein neuer Server laeuft nicht', () => {
    const result = checkCapacity(
      input({
        intent: 'create',
        requested: { ramMb: 32_768, diskMb: 1024 },
        userLimits: { ...NO_USER_RESOURCE_LIMITS, maxRamMb: 1024, maxConcurrentServers: 0 },
        userUsage: { runningRamMb: 30_000, runningServers: 9 },
        nodeUsage: { runningRamMb: 32_000 },
        freeRamMb: 128,
      }),
    );

    // Der Platz reicht, alles andere zaehlt erst beim Start: Das Anlegen geht
    // durch, ohne Ablehnung und ohne Rueckfrage.
    expect(result.allowed).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.concerns).toEqual([]);
  });
});

describe('checkCapacity – Warnungen', () => {
  it('warnt, wenn der Start die Node über den Schwellwert hebt', () => {
    const result = checkCapacity(
      input({
        requested: { ramMb: 4096, diskMb: 1024 },
        // Gemessen 24 GiB belegt; die Warnung rechnet die Zuweisung des neuen
        // Servers dazu.
        freeRamMb: 8_768,
      }),
    );

    expect(result.allowed).toBe(true);
    expect(result.warnings).toEqual([
      {
        scope: 'node',
        resource: 'ram',
        unit: 'mb',
        nodeId: NODE_ID,
        serverId: null,
        used: 28_096,
        total: 32_768,
        usedPercent: 85.7,
        thresholdPercent: 85,
        at: AT.toISOString(),
      },
    ]);
  });

  it('warnt nicht unterhalb des Schwellwerts', () => {
    const result = checkCapacity(input({ nodeUsage: { runningRamMb: 1024 } }));

    expect(result.warnings).toEqual([]);
  });

  it('warnt nicht zu einem Start, der abgelehnt wird', () => {
    const result = checkCapacity(
      input({
        requested: { ramMb: 40_000 },
        userLimits: { ...NO_USER_RESOURCE_LIMITS, maxConcurrentServers: 0 },
        freeRamMb: 8_768,
      }),
    );

    expect(result.allowed).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('warnt sehr wohl zu einem Start, zu dem nur nachgefragt wird', () => {
    // Die Rückfrage ist keine Ablehnung: Der Start kann stattfinden, und dann
    // steht die Node hinterher über dem Schwellwert.
    const result = checkCapacity(
      input({
        requested: { ramMb: 4096, diskMb: 1024 },
        freeRamMb: 2_768,
      }),
    );

    expect(result.concerns).toHaveLength(1);
    expect(result.warnings.map((w) => w.resource)).toEqual(['ram']);
  });
});
