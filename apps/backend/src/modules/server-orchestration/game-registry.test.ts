import { type GameConfigField, type GameTypeDefinition } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { type ServerOrchestrationError } from './errors.js';
import {
  GAME_TYPE_DEFINITIONS,
  MINECRAFT_PAPER_GAME_TYPE,
  TEST_GAME_TYPE,
  TEST_MINECRAFT_GAME_TYPE,
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

  it('bildet jedes Konfigurationsfeld auf eine Umgebungsvariable ab', () => {
    for (const definition of GAME_TYPE_DEFINITIONS) {
      for (const feld of definition.configFields) {
        expect(definition.envMapping?.[feld.key]).toBeTruthy();
      }
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

describe('Test-Typ mit Minecraft-Protokoll (Gefundener Punkt 113)', () => {
  it('ist erst ab Ausbaustufe 2 auswaehlbar', () => {
    // Phase 1 kennt ihn, darf ihn aber nicht anlegen - das ist der Schalter des
    // Betreibers (`INSTALLATION_PHASE`), keine Entscheidung im Code.
    expect(() => createGameRegistry(1).requireSelectable('test-minecraft')).toThrow();
    expect(createGameRegistry(2).requireSelectable('test-minecraft').id).toBe('test-minecraft');
  });

  it('wird ueber gamedig abgefragt, nicht ueber einen offenen Port', () => {
    // Ein offener Port sagt beim Hochlauf noch nichts; erst die Antwort auf den
    // Server-List-Ping beweist, dass der Server bereit ist.
    expect(TEST_MINECRAFT_GAME_TYPE.query).toEqual({
      kind: 'gamedig',
      protocol: 'minecraft',
      containerPort: 25_565,
    });
  });

  it('nimmt einen Port aus dem Bereich, solange kein Hostname-Router laeuft', () => {
    expect(TEST_MINECRAFT_GAME_TYPE.supportsVirtualHostRouting).toBe(false);
  });

  it('zeigt jedes Konfigurationsfeld auf eine Umgebungsvariable', () => {
    const felder = TEST_MINECRAFT_GAME_TYPE.configFields.map((feld) => feld.key).sort();

    expect(Object.keys(TEST_MINECRAFT_GAME_TYPE.envMapping ?? {}).sort()).toEqual(felder);
    // Alle vier liest der Server beim Start - geaendert wirken sie erst danach.
    expect([...(TEST_MINECRAFT_GAME_TYPE.restartRequiredFields ?? [])].sort()).toEqual(felder);
  });
});

describe('Minecraft (Paper) – erstes echtes Spiel (Lastenheft §7, Ausbaustufe 2)', () => {
  it('ist erst ab Ausbaustufe 2 auswählbar', () => {
    expect(() => createGameRegistry(1).requireSelectable('minecraft-paper')).toThrow();
    expect(createGameRegistry(2).requireSelectable('minecraft-paper').id).toBe('minecraft-paper');
  });

  it('zeigt auf eine feste Fassung des eigenen Images', () => {
    // Ein Spiel-Image-Tag wird nie überschrieben (game-images.yml). Wer
    // `images/game/minecraft/VERSION` erhöht, muss diese Zeile nachziehen – sonst
    // liefe die Node weiter auf der alten Fassung, ohne dass es auffiele. Der
    // Name folgt dem Schema `palantir-<Kategorie>-<Name>` (images/README.md).
    expect(MINECRAFT_PAPER_GAME_TYPE.dockerImage).toBe(
      'ghcr.io/nightriderp/palantir-game-minecraft:3',
    );
  });

  it('bringt Schnellbefehle für die Live-Konsole mit – vollständige Zeilen, keine Platzhalter', () => {
    const befehle = MINECRAFT_PAPER_GAME_TYPE.consoleQuickCommands ?? [];

    expect(befehle.map((b) => b.command)).toContain('list');
    expect(befehle.map((b) => b.command)).toContain('stop');
    // Ein Befehl, der eine Eingabe braucht (`say <Text>`), gehört ins Feld,
    // nicht auf einen Knopf.
    for (const befehl of befehle) {
      expect(befehl.command).not.toMatch(/[<>]/u);
      expect(befehl.label.length).toBeGreaterThan(0);
    }
  });

  it('läuft über den Hostname-Router und bekommt deshalb keinen Port (Fundpunkt 192)', () => {
    // Der Router läuft seit 2026-09-09 auf der Gamenode. Steht das wieder auf
    // `false`, bekämen Minecraft-Server erneut einen Pool-Port, und bestehende
    // verlören beim nächsten Start ihre Adresse ohne Port.
    expect(MINECRAFT_PAPER_GAME_TYPE.supportsVirtualHostRouting).toBe(true);
  });

  it('spricht die Konsole über RCON an (P2-9)', () => {
    // Port und Datei müssen zu `images/game/minecraft/start.sh` passen: Das
    // Skript setzt `rcon.port` und legt das Passwort genau dort ab.
    expect(MINECRAFT_PAPER_GAME_TYPE.console).toEqual({
      kind: 'rcon',
      port: 25_575,
      passwordFile: '.palantir/rcon.password',
    });
  });

  it('wird über gamedig abgefragt', () => {
    expect(MINECRAFT_PAPER_GAME_TYPE.query).toEqual({
      kind: 'gamedig',
      protocol: 'minecraft',
      containerPort: 25_565,
    });
  });

  it('erlaubt den Import bestehender Weltdaten', () => {
    expect(MINECRAFT_PAPER_GAME_TYPE.supportsWorldImport).toBe(true);
  });

  it('bildet jedes Konfigurationsfeld ab und verlangt für jedes einen Neustart', () => {
    const felder = MINECRAFT_PAPER_GAME_TYPE.configFields.map((feld) => feld.key).sort();

    expect(Object.keys(MINECRAFT_PAPER_GAME_TYPE.envMapping ?? {}).sort()).toEqual(felder);
    // Alle liest das Startskript einmalig beim Start aus der Umgebung.
    expect([...(MINECRAFT_PAPER_GAME_TYPE.restartRequiredFields ?? [])].sort()).toEqual(felder);
  });

  it('lässt die EULA von Mojang unangenommen, bis der Betreiber zustimmt', () => {
    const feld = MINECRAFT_PAPER_GAME_TYPE.configFields.find((eintrag) => eintrag.key === 'eula');

    expect(feld?.type).toBe('toggle');
    expect(feld?.defaultValue).toBe(false);
    expect(feld?.required).toBe(true);
    // Nachträglich zustimmen können muss möglich sein, ohne den Server neu
    // anzulegen.
    expect(feld?.lockedAfterCreate).toBe(false);
  });

  it('reicht die Zustimmung als EULA an den Container durch', () => {
    // Genau diese Zeichenkette vergleicht `images/game/minecraft/start.sh`. Ein
    // umbenanntes Feld oder eine andere Variable ließe den Server dauerhaft mit
    // „EULA nicht angenommen" stehenbleiben.
    const ohne = buildContainerEnv(
      MINECRAFT_PAPER_GAME_TYPE,
      buildServerConfig(MINECRAFT_PAPER_GAME_TYPE),
    );

    expect(ohne.EULA).toBe('false');

    const mit = buildContainerEnv(
      MINECRAFT_PAPER_GAME_TYPE,
      buildServerConfig(MINECRAFT_PAPER_GAME_TYPE, { eula: true }),
    );

    expect(mit.EULA).toBe('true');
  });

  it('schreibt nur in den Datenordner und ein tmpfs', () => {
    expect(MINECRAFT_PAPER_GAME_TYPE.readOnlyRootFilesystem).toBe(true);
    expect(MINECRAFT_PAPER_GAME_TYPE.dataVolumeContainerPath).toBe('/data');
    expect(MINECRAFT_PAPER_GAME_TYPE.tmpfsPaths).toEqual(['/tmp']);
  });

  it('lässt dem ersten Start Zeit und dem Herunterfahren Kulanz', () => {
    // Der erste Start lädt den Server von Mojang nach, patcht ihn und erzeugt
    // die Welt; das Herunterfahren speichert sie.
    expect(MINECRAFT_PAPER_GAME_TYPE.startupTimeoutSeconds).toBeGreaterThanOrEqual(600);
    expect(MINECRAFT_PAPER_GAME_TYPE.stopTimeoutSeconds ?? 0).toBeGreaterThanOrEqual(60);
  });

  it('empfiehlt Ressourcen, mit denen Paper wirklich läuft', () => {
    // Mit den 256 MiB des Prüfstands startet keine JVM sinnvoll.
    expect(MINECRAFT_PAPER_GAME_TYPE.resourceDefaults.ramMb).toBeGreaterThanOrEqual(2_048);
    expect(MINECRAFT_PAPER_GAME_TYPE.resourceDefaults.cpuCores).toBeGreaterThanOrEqual(1);
  });
});
