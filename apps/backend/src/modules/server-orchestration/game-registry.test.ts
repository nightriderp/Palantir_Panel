import { type GameConfigField, type GameTypeDefinition } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { type ServerOrchestrationError } from './errors.js';
import {
  GAME_TYPE_DEFINITIONS,
  MINECRAFT_PAPER_GAME_TYPE,
  MINECRAFT_VANILLA_GAME_TYPE,
  TERRARIA_GAME_TYPE,
  VALHEIM_GAME_TYPE,
  TEST_GAME_TYPE,
  TEST_MINECRAFT_GAME_TYPE,
  buildContainerEnv,
  buildServerConfig,
  ALLE_GAME_TYPE_DEFINITIONS,
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
  it('bietet die Prüfstände nicht mehr als Vorlage an, behält sie aber', () => {
    // Wunsch des Betreibers 2026-09-10. Geloescht sind sie nicht: Die halbe
    // Testkette steht auf ihnen, und ein Server, der noch auf einem laeuft,
    // muss bedienbar bleiben.
    expect(TEST_GAME_TYPE.phase).toBe(1);
    expect(GAME_TYPE_DEFINITIONS).not.toContain(TEST_GAME_TYPE);
    expect(GAME_TYPE_DEFINITIONS).not.toContain(TEST_MINECRAFT_GAME_TYPE);
    expect(ALLE_GAME_TYPE_DEFINITIONS).toContain(TEST_GAME_TYPE);
    expect(ALLE_GAME_TYPE_DEFINITIONS).toContain(MINECRAFT_PAPER_GAME_TYPE);
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
    expect(() =>
      createGameRegistry(1, ALLE_GAME_TYPE_DEFINITIONS).requireSelectable('test-minecraft'),
    ).toThrow();
    expect(
      createGameRegistry(2, ALLE_GAME_TYPE_DEFINITIONS).requireSelectable('test-minecraft').id,
    ).toBe('test-minecraft');
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

describe('Valheim – erstes Spiel aus Steam (Anhang A, Phase 3)', () => {
  it('ist erst ab Ausbaustufe 3 auswählbar', () => {
    expect(() => createGameRegistry(2).requireSelectable('valheim')).toThrow();
    expect(createGameRegistry(3).requireSelectable('valheim').id).toBe('valheim');
  });

  it('spricht UDP auf zwei Ports', () => {
    // Der Tunnel legt zu jedem Pool-Port einen TCP- und einen UDP-Proxy an
    // (frpc.toml); ein UDP-Spiel braucht hier also nichts Besonderes.
    expect(VALHEIM_GAME_TYPE.ports).toEqual([
      { containerPort: 2456, protocol: 'udp', primary: true, label: 'Spiel-Port' },
      { containerPort: 2457, protocol: 'udp', primary: false, label: 'Abfrage-Port' },
    ]);
  });

  it('fragt den Abfrage-Port ab, nicht den Spiel-Port (Fundpunkt 196)', () => {
    // Valheim antwortet auf der Serverliste neben dem Spiel-Port. Steht hier
    // 2456, laeuft jeder Start in die Frist, obwohl der Server lebt.
    expect(VALHEIM_GAME_TYPE.query).toEqual({
      kind: 'gamedig',
      protocol: 'valheim',
      containerPort: 2457,
      // Und ohne `-public 1` antwortet dieser Port gar nicht (gamedig,
      // GAMES_LIST.md): Der Server meldet sich dann nicht beim
      // Steam-Verzeichnis an. Ohne diese Zeile liefe jeder private Server in
      // die Startfrist, obwohl gespielt wird.
      requiresConfigFlag: 'public',
    });
  });

  it('kennt kein Hostname-Routing und keine Konsole', () => {
    // Der Router liest den Namen aus dem Minecraft-Handshake; UDP liefert
    // nichts dergleichen. Und Valheim nimmt weder ueber die Standardeingabe
    // noch ueber RCON Befehle entgegen.
    expect(VALHEIM_GAME_TYPE.supportsVirtualHostRouting).toBe(false);
    // Ausdruecklich `none` und nicht weggelassen: Ohne Angabe gaelte `stdin`,
    // und das Panel zeigte ein Eingabefeld ohne Wirkung.
    expect(VALHEIM_GAME_TYPE.console).toEqual({ kind: 'none' });
    expect(VALHEIM_GAME_TYPE.consoleQuickCommands ?? []).toEqual([]);
  });

  it('zeigt den Server in der Serverliste, solange niemand widerspricht', () => {
    // Die zurueckhaltendere Vorgabe waere `false`. Sie ist es trotzdem nicht:
    // Ohne `-public 1` beantwortet Valheim keine Abfrage, und dann bleibt die
    // Kachel ohne Spielerzahl und ohne Ping. Wer das will, soll es waehlen -
    // nicht durch eine Vorgabe hineinrutschen.
    const oeffentlich = VALHEIM_GAME_TYPE.configFields.find((feld) => feld.key === 'public');

    expect(oeffentlich?.defaultValue).toBe(true);
    // Und die Beschreibung sagt, was daran haengt.
    expect(oeffentlich?.description).toMatch(/Spielerzahl/u);
  });

  it('verlangt ein Passwort und bildet jedes Feld auf eine Umgebungsvariable ab', () => {
    const passwort = VALHEIM_GAME_TYPE.configFields.find((feld) => feld.key === 'password');

    expect(passwort?.required).toBe(true);
    // Valheim lehnt kuerzere ab; das Startskript prueft es ein zweites Mal.
    expect(passwort?.min).toBe(5);

    const felder = VALHEIM_GAME_TYPE.configFields.map((feld) => feld.key).sort();
    expect(Object.keys(VALHEIM_GAME_TYPE.envMapping ?? {}).sort()).toEqual(felder);
    expect([...(VALHEIM_GAME_TYPE.restartRequiredFields ?? [])].sort()).toEqual(felder);
  });

  it('gibt dem ersten Start Zeit für den Download über SteamCMD', () => {
    // Gut ein Gigabyte. Mit der Frist von Minecraft (600 s) liefe der erste
    // Start auf einer langsamen Leitung in `error`, obwohl alles stimmt.
    expect(VALHEIM_GAME_TYPE.startupTimeoutSeconds).toBeGreaterThanOrEqual(1_200);
  });
});

describe('Terraria – erstes Spiel ohne Laufzeit-Basis (Anhang A, Phase 3)', () => {
  it('ist erst ab Ausbaustufe 3 auswählbar', () => {
    expect(() =>
      createGameRegistry(2, ALLE_GAME_TYPE_DEFINITIONS).requireSelectable('terraria'),
    ).toThrow();
    expect(createGameRegistry(3, ALLE_GAME_TYPE_DEFINITIONS).requireSelectable('terraria').id).toBe(
      'terraria',
    );
  });

  it('zeigt auf eine feste Fassung des eigenen Images', () => {
    expect(TERRARIA_GAME_TYPE.dockerImage).toBe('ghcr.io/nightriderp/palantir-game-terraria:1');
  });

  it('kommt mit einem Verbindungsversuch als Health-Check aus', () => {
    // Terraria spricht TCP - anders als Valheim braucht es keine
    // Spieleabfrage, um zu wissen, ob der Server da ist. Eine echte Abfrage
    // gaebe es nur mit der Erweiterung TShock und einem REST-Token.
    expect(TERRARIA_GAME_TYPE.query).toEqual({ kind: 'portConnect', containerPort: 7777 });
    expect(TERRARIA_GAME_TYPE.ports).toEqual([
      { containerPort: 7777, protocol: 'tcp', primary: true, label: 'Spiel-Port' },
    ]);
  });

  it('hat eine Konsole über die Standardeingabe, aber kein RCON', () => {
    expect(TERRARIA_GAME_TYPE.console).toEqual({ kind: 'stdin' });
    // `exit` ist bei Terraria der Befehl, der die Welt speichert - er steht
    // deshalb als Schnellbefehl da, nicht nur als Knopf "Stoppen" im Kopf.
    expect((TERRARIA_GAME_TYPE.consoleQuickCommands ?? []).map((b) => b.command)).toContain('exit');
  });

  it('gibt dem Stopp Zeit, die Welt zu speichern', () => {
    // Terraria speichert bei SIGTERM nicht; das Startskript schickt `exit` und
    // wartet. Mit einer knappen Frist käme SIGKILL mitten hinein.
    expect(TERRARIA_GAME_TYPE.stopTimeoutSeconds ?? 0).toBeGreaterThanOrEqual(120);
  });

  it('bildet jedes Feld auf eine Umgebungsvariable ab', () => {
    const felder = TERRARIA_GAME_TYPE.configFields.map((feld) => feld.key).sort();

    expect(Object.keys(TERRARIA_GAME_TYPE.envMapping ?? {}).sort()).toEqual(felder);
    expect([...(TERRARIA_GAME_TYPE.restartRequiredFields ?? [])].sort()).toEqual(felder);
  });

  it('bietet Weltgröße und Spielart als Wörter an, nicht als Zahlen', () => {
    // Terraria kennt nur 1/2/3 und 0/1/2/3. Ein Auswahlfeld mit diesen Zahlen
    // waere fuer den Betreiber nicht zu entziffern; uebersetzt wird im
    // Startskript.
    const groesse = TERRARIA_GAME_TYPE.configFields.find((feld) => feld.key === 'size');
    const spielart = TERRARIA_GAME_TYPE.configFields.find((feld) => feld.key === 'difficulty');

    expect(groesse?.options).toEqual(['klein', 'mittel', 'groß']);
    expect(spielart?.options).toEqual(['klassisch', 'experte', 'meister', 'reise']);
  });
});

describe('Minecraft (Vanilla) – zweite Ausgabe aus demselben Image', () => {
  it('ist neben Paper auswählbar, ab derselben Ausbaustufe', () => {
    const registry = createGameRegistry(2, ALLE_GAME_TYPE_DEFINITIONS);

    expect(registry.requireSelectable('minecraft-vanilla').id).toBe('minecraft-vanilla');
    expect(() =>
      createGameRegistry(1, ALLE_GAME_TYPE_DEFINITIONS).requireSelectable('minecraft-vanilla'),
    ).toThrow();
  });

  it('läuft aus demselben Image und unterscheidet sich nur über die Umgebung', () => {
    // Ein zweites Image wäre eine zweite Abschrift desselben Startskripts.
    expect(MINECRAFT_VANILLA_GAME_TYPE.dockerImage).toBe(MINECRAFT_PAPER_GAME_TYPE.dockerImage);
    expect(MINECRAFT_VANILLA_GAME_TYPE.defaultEnv).toEqual({ MINECRAFT_EDITION: 'vanilla' });
    // Paper ist die Vorgabe des Startskripts und setzt deshalb nichts.
    expect(MINECRAFT_PAPER_GAME_TYPE.defaultEnv).toEqual({});
  });

  it('übernimmt Felder, Ports, Konsole und Routing von Paper', () => {
    // Die Definition ist eine Abwandlung, keine Abschrift: Ein neues Feld bei
    // Paper gilt hier sofort mit. Dieser Test hält genau das fest.
    expect(MINECRAFT_VANILLA_GAME_TYPE.configFields).toEqual(
      MINECRAFT_PAPER_GAME_TYPE.configFields,
    );
    expect(MINECRAFT_VANILLA_GAME_TYPE.envMapping).toEqual(MINECRAFT_PAPER_GAME_TYPE.envMapping);
    expect(MINECRAFT_VANILLA_GAME_TYPE.ports).toEqual(MINECRAFT_PAPER_GAME_TYPE.ports);
    expect(MINECRAFT_VANILLA_GAME_TYPE.console).toEqual(MINECRAFT_PAPER_GAME_TYPE.console);
    expect(MINECRAFT_VANILLA_GAME_TYPE.supportsVirtualHostRouting).toBe(true);
  });

  it('bietet keinen Schnellbefehl an, den der Server von Mojang nicht kennt', () => {
    const befehle = (MINECRAFT_VANILLA_GAME_TYPE.consoleQuickCommands ?? []).map((b) => b.command);

    // `tps` ist ein Paper-Befehl; Vanilla antwortet mit „Unknown command".
    expect(befehle).not.toContain('tps');
    expect(befehle).toContain('list');
    expect(befehle).toContain('stop');
  });

  it('bekommt die Ausgabe als Umgebungsvariable in den Container', () => {
    // Der Weg vom Feld zur Umgebung: `defaultEnv` zuerst, die Felder darauf.
    const umgebung = buildContainerEnv(MINECRAFT_VANILLA_GAME_TYPE, { eula: true });

    expect(umgebung['MINECRAFT_EDITION']).toBe('vanilla');
    expect(umgebung['EULA']).toBe('true');
  });
});

describe('Minecraft (Paper) – erstes echtes Spiel (Lastenheft §7, Ausbaustufe 2)', () => {
  it('ist erst ab Ausbaustufe 2 auswählbar', () => {
    expect(() =>
      createGameRegistry(1, ALLE_GAME_TYPE_DEFINITIONS).requireSelectable('minecraft-paper'),
    ).toThrow();
    expect(
      createGameRegistry(2, ALLE_GAME_TYPE_DEFINITIONS).requireSelectable('minecraft-paper').id,
    ).toBe('minecraft-paper');
  });

  it('zeigt auf eine feste Fassung des eigenen Images', () => {
    // Ein Spiel-Image-Tag wird nie überschrieben (game-images.yml). Wer
    // `images/game/minecraft/VERSION` erhöht, muss diese Zeile nachziehen – sonst
    // liefe die Node weiter auf der alten Fassung, ohne dass es auffiele. Der
    // Name folgt dem Schema `palantir-<Kategorie>-<Name>` (images/README.md).
    expect(MINECRAFT_PAPER_GAME_TYPE.dockerImage).toBe(
      'ghcr.io/nightriderp/palantir-game-minecraft:5',
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

/**
 * Der Administrator kann Spieltypen ausschalten (Wunsch des Betreibers,
 * 2026-09-11).
 *
 * Die Registry liest die Einstellung nicht selbst – ihre Methoden sind
 * synchron, die Einstellung steht in der Datenbank. Sie bekommt sie gesagt.
 */
describe('Abgeschaltete Spieltypen', () => {
  function registryMitAbschaltung(ids: readonly string[]) {
    const registry = createGameRegistry(3, ALLE_GAME_TYPE_DEFINITIONS);
    registry.setDisabledGameTypes(ids);

    return registry;
  }

  it('nimmt einen abgeschalteten Typ aus der Auswahl', () => {
    const registry = registryMitAbschaltung(['valheim']);

    expect(() => registry.requireSelectable('valheim')).toThrow();
    expect(registry.requireSelectable('minecraft-paper').id).toBe('minecraft-paper');
  });

  it('lässt einen laufenden Server bedienbar', () => {
    // Sonst hätte der Betreiber nach dem Ausschalten einen Server, den er
    // nicht mehr stoppen könnte: `require` steht hinter jedem Lebenszyklus.
    const registry = registryMitAbschaltung(['valheim']);

    expect(registry.require('valheim').id).toBe('valheim');
    expect(registry.find('valheim')?.id).toBe('valheim');
  });

  it('nennt im DTO den Grund, und zwar den richtigen', () => {
    const registry = registryMitAbschaltung(['minecraft-paper']);
    const dtos = new Map(registry.toDtoList().map((dto) => [dto.id, dto]));

    expect(dtos.get('minecraft-paper')?.available).toBe(false);
    expect(dtos.get('minecraft-paper')?.unavailableReason).toMatch(/Administrator/u);
    expect(dtos.get('valheim')?.available).toBe(true);
  });

  it('sagt bei einer gesperrten Ausbaustufe weiter die Ausbaustufe', () => {
    // „Kommt in Ausbaustufe 3" ist eine Zusage, „ausgeschaltet" eine
    // Entscheidung. Was es hier noch gar nicht geben kann, ist nicht
    // ausgeschaltet.
    const registry = createGameRegistry(2, ALLE_GAME_TYPE_DEFINITIONS);
    registry.setDisabledGameTypes(['valheim']);

    const dto = registry.toDtoList().find((eintrag) => eintrag.id === 'valheim');

    expect(dto?.available).toBe(false);
    expect(dto?.unavailableReason).toMatch(/Ausbaustufe 3/u);
  });

  it('übergeht eine Kennung, die es im Katalog nicht gibt', () => {
    const registry = registryMitAbschaltung(['gibtsnicht']);

    expect(
      registry
        .toDtoList()
        .every((dto) => dto.unavailableReason?.includes('Administrator') !== true),
    ).toBe(true);
  });
});
