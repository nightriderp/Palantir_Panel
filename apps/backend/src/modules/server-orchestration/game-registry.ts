/**
 * Spiele-Registry (Pflichtenheft §11, Lastenheft §3.5).
 *
 * „Neue Spiele werden in Version 1 per Code/Deployment ergänzt, nicht über eine
 * Admin-Oberfläche." Genau deshalb steht die Registry hier als Code und nicht
 * als Tabelle: Es gibt keinen Schreibpfad, den man absichern müsste, und eine
 * neue Definition durchläuft Review und Build wie jeder andere Code.
 *
 * Die Form von `GameTypeDefinition` steht in `@palantir/contracts`; hier stehen
 * die konkreten Definitionen.
 *
 * **Phase 1** braucht laut Lastenheft §3.5 nur einen minimalen Test-Typ –
 * „einfacher Container, der auf einem Port lauscht" – um die gesamte
 * Orchestrierungs-Pipeline ohne echtes Spiel zu prüfen.
 *
 * **Minecraft stand hier schon einmal** (`itzg/minecraft-server`, Ausbaustufe 2)
 * und ist bewusst wieder herausgenommen: Das fremde Image startet als `root`,
 * will seinen Datenordner umschreiben und danach den Benutzer wechseln. Beides
 * scheitert an der Härtung aus Pflichtenheft §2.3 – `CapDrop: ALL` und
 * `no-new-privileges` – mit „operation not permitted", noch bevor der Server
 * hochläuft. Die Härtung dafür aufzuweichen wäre der falsche Handel.
 *
 * Die eigenen Spiel-Images werden deshalb so gebaut, dass sie ohne diesen
 * Umweg auskommen: fester Benutzer im Image, kein `chown` im Startskript, kein
 * Benutzerwechsel zur Laufzeit. Die Abfrage über `gamedig` bleibt eingehängt
 * und wartet auf die erste Definition mit `query.kind: 'gamedig'`
 * (WORK_STATUS.md, Gefundener Punkt 113).
 */

import { type GameTypeDefinition, type GameTypeDto } from '@palantir/contracts';
import { ServerOrchestrationError } from './errors.js';

/**
 * Minimaler Test-Typ für Phase 1.
 *
 * Nutzt ein sehr kleines, allgemein verfügbares Image, das einen HTTP-Server
 * auf einem Port startet. Damit lässt sich die vollständige Kette prüfen:
 * anlegen, starten, Health-Check über einen Port-Connect, Live-Stats, Logs,
 * Konsole, stoppen, löschen. Ein echtes Spieleprotokoll ist dafür nicht nötig.
 *
 * `readOnlyRootFilesystem` ist gesetzt, weil das Image nichts außerhalb seines
 * Datenordners schreibt – Pflichtenheft §2.3 verlangt es „wo vom Spiel
 * unterstützt", und der Test-Typ ist der einfachste Fall davon.
 */
export const TEST_GAME_TYPE: GameTypeDefinition = {
  id: 'test-echo',
  name: 'Test-Server (Echo)',
  description:
    'Minimaler Testtyp für Phase 1: ein Container, der auf einem Port lauscht. Dient dazu, die gesamte Orchestrierung ohne echtes Spiel zu prüfen.',
  dockerImage: 'ghcr.io/nginxinc/nginx-unprivileged:1.27-alpine',
  defaultEnv: {},
  ports: [
    {
      containerPort: 8080,
      protocol: 'tcp',
      primary: true,
      label: 'Test-Port',
    },
  ],
  configFields: [
    {
      key: 'greeting',
      label: 'Begrüßungstext',
      type: 'text',
      defaultValue: 'Palantir Test-Server',
      description: 'Wird beim Start in die Startseite des Test-Servers geschrieben.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'motdEnabled',
      label: 'Begrüßung anzeigen',
      type: 'toggle',
      defaultValue: true,
      description: null,
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
  ],
  envMapping: {
    greeting: 'PALANTIR_TEST_GREETING',
    motdEnabled: 'PALANTIR_TEST_MOTD_ENABLED',
  },
  restartRequiredFields: ['greeting', 'motdEnabled'],
  resourceDefaults: {
    ramMb: 256,
    cpuCores: 0.5,
    diskMb: 1_024,
  },
  query: {
    kind: 'portConnect',
    containerPort: 8080,
  },
  iconUrl: null,
  coverImageUrl: null,
  supportsVirtualHostRouting: false,
  supportsWorldImport: false,
  dataVolumeContainerPath: '/usr/share/nginx/html',
  readOnlyRootFilesystem: true,
  tmpfsPaths: ['/tmp', '/var/cache/nginx', '/var/run'],
  stopTimeoutSeconds: 10,
  startupTimeoutSeconds: 60,
  phase: 1,
};

/**
 * Test-Spielserver mit Minecraft-Protokoll (WORK_STATUS.md, Gefundener Punkt 113).
 *
 * **Der Unterschied zum Echo-Typ oben:** Der prüft die Orchestrierung ohne
 * Spieleprotokoll. Dieser prüft alles, was erst mit einem Spiel dazukommt —
 * `gamedig`-Abfrage statt Port-Connect, ein Client, der sich verbinden kann,
 * und die Subdomain, die im Handshake mitkommt. Beides nebeneinander, weil das
 * eine ohne Spiel auskommt und das andere eines nachstellt.
 *
 * **Kein echter Spielserver.** Das Image spricht genau so viel Minecraft, wie
 * für diese Prüfung nötig ist (`images/test-minecraft`); es hält aber dieselben
 * Regeln ein wie ein echtes Spiel-Image, sonst wäre die Prüfung wertlos.
 *
 * **`supportsVirtualHostRouting` ist `false`**, obwohl Minecraft der Fall wäre,
 * für den das Hostname-Routing gedacht ist: Der dafür nötige Router (Infrared
 * auf `MINECRAFT_ROUTER_PORT`) läuft noch nicht. So bekommt der Server einen
 * Port aus dem Bereich 25000–25564, und genau der Weg — Portvergabe, frpc,
 * frps, öffentlicher Port — soll hier ohnehin geprüft werden.
 *
 * **`supportsWorldImport` ist `true`**, damit sich auch der Weltdaten-Import
 * ausprobieren lässt: Das Archiv landet im Datenordner, und ob das Spiel etwas
 * damit anfängt, ist für den Weg dorthin ohne Belang.
 */
export const TEST_MINECRAFT_GAME_TYPE: GameTypeDefinition = {
  id: 'test-minecraft',
  name: 'Test-Server (Minecraft-Protokoll)',
  description:
    'Prüfstand für die Kette bis zum Spieler: antwortet auf den Server-List-Ping, erscheint in der Minecraft-Serverliste und weist eine Anmeldung mit einer erklärenden Meldung ab. Kein Spielserver — dafür kommt ein eigenes Image.',
  dockerImage: 'ghcr.io/nightriderp/palantir-test-minecraft:1',
  defaultEnv: {},
  ports: [
    {
      containerPort: 25_565,
      protocol: 'tcp',
      primary: true,
      label: 'Spiel-Port',
    },
  ],
  configFields: [
    {
      key: 'motd',
      label: 'Serverbeschreibung',
      type: 'text',
      defaultValue: 'Palantir – Test-Server',
      description: 'Steht in der Serverliste des Spielers unter dem Namen.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'maxPlayers',
      label: 'Spieler höchstens',
      type: 'number',
      defaultValue: 20,
      description: null,
      required: false,
      options: [],
      min: 1,
      max: 200,
      lockedAfterCreate: false,
    },
    {
      key: 'fakePlayers',
      label: 'Gemeldete Spielerzahl',
      type: 'number',
      defaultValue: 0,
      description:
        'Was der Server als Spielerzahl meldet. Zur Laufzeit über die Konsole änderbar (`players 3`) — damit lässt sich der automatische Stopp bei 0 Spielern auslösen, ohne dass jemand spielt.',
      required: false,
      options: [],
      min: 0,
      max: 200,
      lockedAfterCreate: false,
    },
    {
      key: 'startupDelaySeconds',
      label: 'Startverzögerung (Sekunden)',
      type: 'number',
      defaultValue: 0,
      description:
        'Der Server antwortet erst nach dieser Zeit. Damit lässt sich der Übergang „startet" → „läuft" beobachten und die Startzeit-Grenze prüfen.',
      required: false,
      options: [],
      min: 0,
      max: 120,
      lockedAfterCreate: false,
    },
  ],
  envMapping: {
    motd: 'MOTD',
    maxPlayers: 'MAX_PLAYERS',
    fakePlayers: 'FAKE_PLAYERS',
    startupDelaySeconds: 'STARTUP_DELAY_SECONDS',
  },
  // Alle vier Werte liest der Server beim Start aus der Umgebung; geändert
  // wirken sie deshalb erst nach einem Neustart.
  restartRequiredFields: ['motd', 'maxPlayers', 'fakePlayers', 'startupDelaySeconds'],
  resourceDefaults: {
    ramMb: 256,
    cpuCores: 0.5,
    diskMb: 1_024,
  },
  query: {
    kind: 'gamedig',
    protocol: 'minecraft',
    containerPort: 25_565,
  },
  iconUrl: null,
  coverImageUrl: null,
  supportsVirtualHostRouting: false,
  supportsWorldImport: true,
  dataVolumeContainerPath: '/data',
  // Das Image schreibt ausschliesslich in den Datenordner; `/tmp` braucht Node
  // fuer sich selbst.
  readOnlyRootFilesystem: true,
  tmpfsPaths: ['/tmp'],
  stopTimeoutSeconds: 15,
  startupTimeoutSeconds: 120,
  phase: 2,
};

/**
 * Alle bekannten Spiele-Definitionen.
 *
 * Reihenfolge = Anzeigereihenfolge im Server-erstellen-Wizard (F3).
 */
export const GAME_TYPE_DEFINITIONS: readonly GameTypeDefinition[] = [
  TEST_GAME_TYPE,
  TEST_MINECRAFT_GAME_TYPE,
];

/** Ausbaustufe, die diese Installation erreicht hat (Lastenheft §3.5). */
export type InstallationPhase = 1 | 2 | 3;

export interface GameRegistry {
  /** Alle Definitionen, auch die noch nicht nutzbaren. */
  list(): readonly GameTypeDefinition[];
  /** Definition zu einer Kennung; wirft `GAME_TYPE_NOT_FOUND`, wenn es sie nicht gibt. */
  require(id: string): GameTypeDefinition;
  /**
   * Wie {@link require}, prüft zusätzlich die Ausbaustufe und wirft
   * `GAME_TYPE_NOT_AVAILABLE`, wenn das Spiel noch nicht nutzbar ist.
   */
  requireSelectable(id: string): GameTypeDefinition;
  /** DTOs für das Frontend – ohne Betriebsinterna des Homeservers. */
  toDtoList(): readonly GameTypeDto[];
}

/** Wandelt eine Definition in ihr DTO (Pflichtenheft §5.2, §11). */
export function toGameTypeDto(
  definition: GameTypeDefinition,
  phase: InstallationPhase,
): GameTypeDto {
  const available = definition.phase <= phase;

  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    iconUrl: definition.iconUrl,
    coverImageUrl: definition.coverImageUrl,
    supportsVirtualHostRouting: definition.supportsVirtualHostRouting,
    supportsWorldImport: definition.supportsWorldImport,
    // Der DTO zeigt die Ports, die der Spieler kennen muss – die Zuordnung auf
    // Protokoll und Container-Port ist Betriebssache.
    defaultPorts: definition.ports.map((port) => port.containerPort),
    resourceDefaults: definition.resourceDefaults,
    configFields: [...definition.configFields],
    available,
    unavailableReason: available
      ? null
      : `Kommt in Ausbaustufe ${String(definition.phase)} (Lastenheft §3.5).`,
  };
}

/**
 * Baut die Registry.
 *
 * @param definitions bewusst überschreibbar, damit Tests mit eigenen
 *   Definitionen arbeiten können, ohne die echte Liste anzufassen.
 */
export function createGameRegistry(
  phase: InstallationPhase = 1,
  definitions: readonly GameTypeDefinition[] = GAME_TYPE_DEFINITIONS,
): GameRegistry {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));

  if (byId.size !== definitions.length) {
    throw new Error('Die Spiele-Registry enthält doppelte Kennungen.');
  }

  function require(id: string): GameTypeDefinition {
    const definition = byId.get(id);

    if (definition === undefined) {
      throw new ServerOrchestrationError('GAME_TYPE_NOT_FOUND', undefined, { gameType: id });
    }

    return definition;
  }

  return {
    list: () => definitions,
    require,
    requireSelectable(id: string): GameTypeDefinition {
      const definition = require(id);

      if (definition.phase > phase) {
        throw new ServerOrchestrationError('GAME_TYPE_NOT_AVAILABLE', undefined, {
          gameType: id,
          requiredPhase: definition.phase,
          currentPhase: phase,
        });
      }

      return definition;
    },
    toDtoList: () => definitions.map((definition) => toGameTypeDto(definition, phase)),
  };
}

/**
 * Der Port, den der Spieler benutzt.
 *
 * Jede Definition hat genau einen; fehlt er, ist die Definition fehlerhaft und
 * das soll beim ersten Zugriff auffallen und nicht in einer halb angelegten
 * Portzuweisung enden.
 */
export function primaryPortOf(definition: GameTypeDefinition): number {
  const primary = definition.ports.find((port) => port.primary);

  if (primary === undefined) {
    throw new Error(`Die Spiele-Definition "${definition.id}" hat keinen primären Port.`);
  }

  return primary.containerPort;
}

/**
 * Vollständige Konfiguration aus Vorgabewerten und Nutzereingaben.
 *
 * Unbekannte Schlüssel werden verworfen statt übernommen: Das `configFields`
 * ist die Vertragsgrenze zum Frontend, und ein durchgereichter Fremdschlüssel
 * landete sonst als Umgebungsvariable im Container.
 */
export function buildServerConfig(
  definition: GameTypeDefinition,
  overrides: Readonly<Record<string, string | number | boolean>> = {},
): Record<string, string | number | boolean> {
  const config: Record<string, string | number | boolean> = {};

  for (const field of definition.configFields) {
    const override = overrides[field.key];
    config[field.key] = override === undefined ? field.defaultValue : override;
  }

  return config;
}

/**
 * Umgebungsvariablen des Containers: Vorgaben der Definition plus die Felder,
 * die laut `configFields` in eine Variable geschrieben werden.
 */
export function buildContainerEnv(
  definition: GameTypeDefinition,
  config: Readonly<Record<string, string | number | boolean>>,
): Record<string, string> {
  const env: Record<string, string> = { ...definition.defaultEnv };

  for (const [key, variable] of Object.entries(definition.envMapping ?? {})) {
    const value = config[key];

    if (value !== undefined) {
      env[variable] = String(value);
    }
  }

  return env;
}

/**
 * Prüft, ob eine Konfigurationsänderung einen Neustart verlangt
 * (Lastenheft §3.3, `GameConfigField.requiresRestart`).
 */
export function requiresRestartAfterChange(
  definition: GameTypeDefinition,
  previous: Readonly<Record<string, string | number | boolean>>,
  next: Readonly<Record<string, string | number | boolean>>,
): boolean {
  return (definition.restartRequiredFields ?? []).some((key) => previous[key] !== next[key]);
}
