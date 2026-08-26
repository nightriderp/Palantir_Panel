import { type GameConfigField, type GameTypeDefinition } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { type ServerOrchestrationError } from './errors.js';
import {
  GAME_TYPE_DEFINITIONS,
  TEST_GAME_TYPE,
  buildContainerEnv,
  buildServerConfig,
  createGameRegistry,
  primaryPortOf,
  requiresRestartAfterChange,
  toGameTypeDto,
} from './game-registry.js';

const PHASE_2_GAME: GameTypeDefinition = {
  ...TEST_GAME_TYPE,
  id: 'zukunftsspiel',
  name: 'Zukunftsspiel',
  phase: 2,
};

describe('Spiele-Registry (Pflichtenheft §11)', () => {
  it('enthält den minimalen Test-Typ für Phase 1 (Lastenheft §3.5)', () => {
    expect(TEST_GAME_TYPE.phase).toBe(1);
    expect(GAME_TYPE_DEFINITIONS).toContain(TEST_GAME_TYPE);
  });

  it('prüft den Test-Typ über einen generischen Port-Connect-Test', () => {
    expect(TEST_GAME_TYPE.query).toEqual({ kind: 'portConnect', containerPort: 8080 });
  });

  it('nutzt für den Test-Typ ein read-only Root-Filesystem (Pflichtenheft §2.3)', () => {
    expect(TEST_GAME_TYPE.readOnlyRootFilesystem).toBe(true);
  });

  it('führt genau einen primären Port je Definition', () => {
    for (const definition of GAME_TYPE_DEFINITIONS) {
      expect(definition.ports.filter((port) => port.primary)).toHaveLength(1);
      expect(primaryPortOf(definition)).toBeGreaterThan(0);
    }
  });

  it('lehnt doppelte Kennungen ab', () => {
    expect(() => createGameRegistry(1, [TEST_GAME_TYPE, TEST_GAME_TYPE])).toThrow(
      /doppelte Kennungen/,
    );
  });
});

describe('Nachschlagen', () => {
  const registry = createGameRegistry(1, [TEST_GAME_TYPE, PHASE_2_GAME]);

  it('findet eine bekannte Definition', () => {
    expect(registry.require('test-echo')).toBe(TEST_GAME_TYPE);
  });

  it('meldet eine unbekannte Kennung als GAME_TYPE_NOT_FOUND', () => {
    try {
      registry.require('gibt-es-nicht');
      expect.unreachable('Die Kennung hätte abgelehnt werden müssen.');
    } catch (error: unknown) {
      expect((error as ServerOrchestrationError).code).toBe('GAME_TYPE_NOT_FOUND');
    }
  });

  it('trennt „gibt es nicht" von „kommt später"', () => {
    try {
      registry.requireSelectable('zukunftsspiel');
      expect.unreachable('Das Spiel hätte als noch nicht verfügbar gelten müssen.');
    } catch (error: unknown) {
      expect((error as ServerOrchestrationError).code).toBe('GAME_TYPE_NOT_AVAILABLE');
    }
  });

  it('gibt ein Spiel frei, sobald die Ausbaustufe erreicht ist', () => {
    const phase2 = createGameRegistry(2, [TEST_GAME_TYPE, PHASE_2_GAME]);

    expect(phase2.requireSelectable('zukunftsspiel')).toBe(PHASE_2_GAME);
  });
});

describe('DTO (Pflichtenheft §5.2)', () => {
  it('liefert keine Betriebsinterna des Homeservers', () => {
    const dto = toGameTypeDto(TEST_GAME_TYPE, 1) as unknown as Record<string, unknown>;

    for (const forbidden of [
      'dockerImage',
      'defaultEnv',
      'defaultCommand',
      'dataVolumeContainerPath',
    ]) {
      expect(dto[forbidden]).toBeUndefined();
    }
  });

  it('markiert Spiele späterer Phasen als nicht auswählbar', () => {
    expect(toGameTypeDto(PHASE_2_GAME, 1).available).toBe(false);
    expect(toGameTypeDto(PHASE_2_GAME, 2).available).toBe(true);
  });

  it('listet alle Definitionen, auch die noch nicht nutzbaren', () => {
    const registry = createGameRegistry(1, [TEST_GAME_TYPE, PHASE_2_GAME]);

    expect(registry.toDtoList().map((dto) => dto.id)).toEqual(['test-echo', 'zukunftsspiel']);
  });
});

describe('Konfiguration', () => {
  it('füllt fehlende Felder mit den Vorgabewerten', () => {
    expect(buildServerConfig(TEST_GAME_TYPE)).toEqual({
      greeting: 'Palantir Test-Server',
      motdEnabled: true,
    });
  });

  it('übernimmt Nutzereingaben', () => {
    expect(buildServerConfig(TEST_GAME_TYPE, { greeting: 'Hallo' }).greeting).toBe('Hallo');
  });

  it('verwirft Schlüssel, die nicht im configFields stehen', () => {
    // Ein durchgereichter Fremdschlüssel landete sonst als Umgebungsvariable
    // im Container.
    const config = buildServerConfig(TEST_GAME_TYPE, { LD_PRELOAD: '/böse.so' });

    expect(config.LD_PRELOAD).toBeUndefined();
  });
});

describe('Umgebungsvariablen', () => {
  const field = (key: string, label: string): GameConfigField => ({
    key,
    label,
    type: 'text',
    defaultValue: '',
    description: null,
    required: false,
    options: [],
    min: null,
    max: null,
    lockedAfterCreate: false,
  });

  const definition: GameTypeDefinition = {
    ...TEST_GAME_TYPE,
    defaultEnv: { TZ: 'Europe/Berlin' },
    configFields: [field('maxPlayers', 'Maximale Spielerzahl'), field('nurAnzeige', 'Nur Anzeige')],
    envMapping: { maxPlayers: 'MAX_PLAYERS' },
    restartRequiredFields: [],
  };

  it('übernimmt die Vorgaben der Definition', () => {
    expect(buildContainerEnv(definition, {}).TZ).toBe('Europe/Berlin');
  });

  it('schreibt nur Felder aus envMapping in eine Variable', () => {
    // Ein Feld ohne Zuordnung landet nicht im Container – sonst käme jede
    // Formulareingabe als Umgebungsvariable an.
    const env = buildContainerEnv(definition, { maxPlayers: 20, nurAnzeige: 'y' });

    expect(env.MAX_PLAYERS).toBe('20');
    expect(Object.values(env)).not.toContain('y');
  });
});

describe('requiresRestartAfterChange() (Lastenheft §3.3)', () => {
  it('meldet eine Änderung an einem neustartpflichtigen Feld', () => {
    expect(
      requiresRestartAfterChange(
        TEST_GAME_TYPE,
        { greeting: 'alt', motdEnabled: true },
        { greeting: 'neu', motdEnabled: true },
      ),
    ).toBe(true);
  });

  it('meldet nichts, wenn sich nichts geändert hat', () => {
    const config = { greeting: 'gleich', motdEnabled: true };

    expect(requiresRestartAfterChange(TEST_GAME_TYPE, config, { ...config })).toBe(false);
  });

  it('ignoriert Felder, die nicht in restartRequiredFields stehen', () => {
    const definition: GameTypeDefinition = {
      ...TEST_GAME_TYPE,
      restartRequiredFields: [],
    };

    expect(requiresRestartAfterChange(definition, { greeting: 'a' }, { greeting: 'b' })).toBe(
      false,
    );
  });
});
