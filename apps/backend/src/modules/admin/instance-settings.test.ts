/**
 * Instanz-Einstellungen, insbesondere die Auswahl der Schriften (S-2).
 *
 * Die drei Fälle des Vertrags stehen hier nebeneinander, weil sie sich nur um
 * ein `undefined` unterscheiden und genau deshalb leicht verwechselt werden:
 * **Feld fehlt** heißt „unverändert", **`null`** heißt „zurück auf die Vorgabe",
 * und eine **Kennung** muss es geben, sonst `FONT_NOT_FOUND`.
 */

import { describe, expect, it } from 'vitest';
import { createAuditService } from './audit.js';
import { contextOf } from './context.js';
import { isAdminError } from './errors.js';
import {
  type FontDirectory,
  type InstanceSettingsRecord,
  type InstanceSettingsRepository,
  createInstanceSettingsService,
} from './instance-settings.js';
import { actorWith, createFakeAuditRepository } from './test-support.js';

const ADMIN = contextOf(actorWith('user.manage'), {
  userId: '33333333-3333-4333-8333-333333333333',
  displayName: 'Test-Admin',
  ipHint: '10.0.0.x',
});

const NUTZER = contextOf(actorWith());

const SCHRIFT_ID = '44444444-4444-4444-8444-444444444444';

interface FakeRepository extends InstanceSettingsRepository {
  readonly stand: () => InstanceSettingsRecord;
}

function createFakeRepository(seed: Partial<InstanceSettingsRecord> = {}): FakeRepository {
  let stand: InstanceSettingsRecord = {
    selfRegistrationEnabled: true,
    uiFontId: null,
    monospaceFontId: null,
    updatedAt: null,
    ...seed,
  };

  return {
    stand: () => stand,
    async load() {
      return stand;
    },
    async save(data) {
      stand = { ...data, updatedAt: new Date('2026-03-04T05:06:07.000Z') };
    },
  };
}

/** Kennt genau die eine Schrift – alles andere gibt es nicht. */
const bestand: FontDirectory = { exists: async (id) => id === SCHRIFT_ID };

function aufbauen(
  seed: Partial<InstanceSettingsRecord> = {},
  fonts: FontDirectory | null = bestand,
) {
  const repository = createFakeRepository(seed);
  const audit = createFakeAuditRepository();
  const service = createInstanceSettingsService({
    repository,
    audit: createAuditService(audit),
    ...(fonts ? { fonts } : {}),
  });

  return { repository, audit, service };
}

async function fehlercode(arbeit: () => Promise<unknown>): Promise<string | null> {
  try {
    await arbeit();

    return null;
  } catch (fehler: unknown) {
    return isAdminError(fehler) ? fehler.code : null;
  }
}

describe('Instanz-Einstellungen: Schriftauswahl', () => {
  it('lässt ein fehlendes Feld unverändert', async () => {
    const { service, repository } = aufbauen({ uiFontId: SCHRIFT_ID, monospaceFontId: SCHRIFT_ID });

    const dto = await service.set(ADMIN, { selfRegistrationEnabled: true });

    expect(dto.uiFontId).toBe(SCHRIFT_ID);
    expect(repository.stand().monospaceFontId).toBe(SCHRIFT_ID);
  });

  it('setzt mit ausdrücklichem null auf die Vorgabe zurück', async () => {
    const { service, repository } = aufbauen({ uiFontId: SCHRIFT_ID, monospaceFontId: SCHRIFT_ID });

    const dto = await service.set(ADMIN, { selfRegistrationEnabled: true, uiFontId: null });

    expect(dto.uiFontId).toBeNull();
    // Nur das genannte Feld – das andere bleibt stehen.
    expect(repository.stand().monospaceFontId).toBe(SCHRIFT_ID);
  });

  it('übernimmt eine vorhandene Kennung', async () => {
    const { service, repository } = aufbauen();

    const dto = await service.set(ADMIN, {
      selfRegistrationEnabled: true,
      monospaceFontId: SCHRIFT_ID,
    });

    expect(dto.monospaceFontId).toBe(SCHRIFT_ID);
    expect(repository.stand().monospaceFontId).toBe(SCHRIFT_ID);
  });

  it('lehnt eine unbekannte Kennung mit FONT_NOT_FOUND ab', async () => {
    const { service, repository } = aufbauen();

    expect(
      await fehlercode(() =>
        service.set(ADMIN, { selfRegistrationEnabled: true, uiFontId: 'bundled-gibt-es-nicht' }),
      ),
    ).toBe('FONT_NOT_FOUND');
    // Und speichert dabei gar nichts – auch nicht den Registrierungsschalter.
    expect(repository.stand().updatedAt).toBeNull();
  });

  it('lehnt jede Kennung ab, solange der Anschluss an die Schriften fehlt', async () => {
    const { service } = aufbauen({}, null);

    expect(
      await fehlercode(() =>
        service.set(ADMIN, { selfRegistrationEnabled: true, uiFontId: SCHRIFT_ID }),
      ),
    ).toBe('FONT_NOT_FOUND');
  });

  it('nennt die gewählten Kennungen für den Löschschutz des Schriften-Moduls', async () => {
    const { service } = aufbauen({ uiFontId: SCHRIFT_ID, monospaceFontId: null });

    expect(await service.selectedFontIds()).toEqual([SCHRIFT_ID]);
  });
});

describe('Instanz-Einstellungen: Audit-Log', () => {
  it('protokolliert nur die Felder, die sich wirklich geändert haben', async () => {
    const { service, audit } = aufbauen();

    await service.set(ADMIN, { selfRegistrationEnabled: false, uiFontId: SCHRIFT_ID });

    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.action).toBe('instance.settingsChanged');
    expect(audit.rows[0]?.targetType).toBe('instanceSettings');
    expect(audit.rows[0]?.metadata).toEqual({
      selfRegistrationEnabled: false,
      uiFontId: SCHRIFT_ID,
    });
    expect(audit.rows[0]?.actorDisplayName).toBe('Test-Admin');
  });

  it('schreibt nichts, wenn sich nichts geändert hat', async () => {
    const { service, audit } = aufbauen();

    await service.set(ADMIN, { selfRegistrationEnabled: true });

    expect(audit.rows).toHaveLength(0);
  });
});

describe('Instanz-Einstellungen: Berechtigungen', () => {
  it('verlangt user.manage zum Lesen und zum Schreiben', async () => {
    const { service } = aufbauen();

    expect(await fehlercode(() => service.get(NUTZER.actor))).toBe('PERMISSION_DENIED');
    expect(await fehlercode(() => service.set(NUTZER, { selfRegistrationEnabled: false }))).toBe(
      'PERMISSION_DENIED',
    );
  });

  it('beantwortet die Frage nach der Selbstregistrierung ohne Rechteprüfung', async () => {
    const { service } = aufbauen({ selfRegistrationEnabled: false });

    expect(await service.selfRegistrationEnabled()).toBe(false);
  });
});
