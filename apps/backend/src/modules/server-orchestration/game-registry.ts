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
 *
 * **Minecraft steht seit `images/game/minecraft` wieder hier** – als eigenes Image,
 * das genau diese Regeln einhält (`MINECRAFT_PAPER_GAME_TYPE` unten).
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
 * für diese Prüfung nötig ist (`images/test/minecraft`); es hält aber dieselben
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
  dockerImage: 'ghcr.io/nightriderp/palantir-test-minecraft:2',
  // Die Befehle des Prüfstands (`images/test/minecraft/server.mjs`): `players`
  // setzt die gemeldete Spielerzahl und ist damit der Hebel für den
  // Auto-Shutdown, ohne dass jemand wirklich spielt.
  consoleQuickCommands: [
    { label: 'Hilfe', command: 'help' },
    { label: 'Status', command: 'status' },
    { label: '3 Spieler', command: 'players 3' },
    { label: '0 Spieler', command: 'players 0' },
    { label: 'Stopp', command: 'stop' },
  ],
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
 * Minecraft mit Paper – das erste echte Spiel (Lastenheft §7 „Ausbaustufe 2",
 * Anhang A nennt für die Minecraft-Familie ausdrücklich Paper).
 *
 * **Eigenes Image, kein fremdes.** `itzg/minecraft-server` stand hier schon
 * einmal und ist an der Härtung gescheitert (siehe Kopfkommentar). Das Image
 * unter `images/game/minecraft` hält die Regeln von sich aus ein: fester Benutzer
 * UID 1000, kein `chown`, kein Benutzerwechsel zur Laufzeit, geschrieben wird
 * nur in den Datenordner.
 *
 * **`supportsVirtualHostRouting` ist seit 2026-09-09 `true`** (Fundpunkt 192).
 * Minecraft ist genau der Fall, für den das Hostname-Routing gedacht ist
 * (Pflichtenheft §13), und der Router läuft seitdem auf der Gamenode: Infrared
 * lauscht auf `MINECRAFT_ROUTER_PORT`, der Agent legt je Server eine
 * Routen-Datei an, und der Platzhalter hält den Dienst am Leben, solange keine
 * existiert. Das Panel vergibt für Minecraft deshalb keinen Port mehr aus dem
 * Bereich 25000–25564; die Adresse ist der Name allein, und der DNS-Eintrag ist
 * ein CNAME auf `GAME_ROUTER_HOSTNAME` statt ein A-Eintrag auf die VPS.
 *
 * **Was das für bestehende Server heißt.** Sie behalten ihren Pool-Port und
 * ihren A-Eintrag in der Datenbank; ihr Container-Abdruck ändert sich durch die
 * neuen Beschriftungen, sie werden beim nächsten Start neu gebaut und verlieren
 * dabei die Host-Bindung. Über den Namen ohne Port bleiben sie erreichbar, über
 * die im Panel angezeigte Portnummer nicht mehr. Sauber ist, sie einmal neu
 * anzulegen.
 *
 * **Die Sperre bleibt.** Ohne `GAME_ROUTER_HOSTNAME` verweigert das Backend den
 * Start (`GAME_TYPE_NOT_AVAILABLE`, Pflichtenheft §19) – ein Server soll nicht
 * in eine Adresse starten, hinter der kein Router steht.
 *
 * **`startupTimeoutSeconds` ist großzügig**, weil der *erste* Start deutlich
 * länger dauert als jeder folgende: Die Paper-Jar liegt zwar im Image, sie holt
 * beim ersten Lauf aber den Server von Mojang nach (der darf nicht weitergegeben
 * werden), patcht ihn und erzeugt anschließend die Welt. Zehn Minuten decken das
 * auf einem Homeserver ab; spätere Starts brauchen eine knappe Minute. Der
 * Health-Check läuft neben dem Request (`service.ts`), es wartet also niemand
 * darauf.
 *
 * **Der Heap kommt aus dem RAM-Kontingent**, aber nicht über eine
 * Umgebungsvariable: Das Kontingent erreicht den Container nur als cgroup-Grenze
 * (`HostConfig.Memory`), und `start.sh` rechnet daraus „Kontingent minus
 * Rücklage". Ohne das nähme die JVM ihren Standard von einem Viertel der Grenze.
 */
export const MINECRAFT_PAPER_GAME_TYPE: GameTypeDefinition = {
  id: 'minecraft-paper',
  name: 'Minecraft (Paper)',
  description:
    'Minecraft-Server auf Basis von Paper – schneller als der Server von Mojang und mit Unterstützung für Plugins. Vor dem ersten Start muss die Endnutzer-Lizenzvereinbarung von Mojang angenommen werden.',
  dockerImage: 'ghcr.io/nightriderp/palantir-game-minecraft:6',
  // Schnellbefehle der Live-Konsole. Nur vollständige Zeilen – `say <Text>`
  // oder `op <Name>` brauchen das Feld. Die Antwort kommt über RCON zurück
  // (`console` unten, P2-9) und steht damit direkt in der Konsole.
  consoleQuickCommands: [
    { label: 'Spieler', command: 'list' },
    { label: 'TPS', command: 'tps' },
    { label: 'Speichern', command: 'save-all' },
    { label: 'Whitelist', command: 'whitelist list' },
    { label: 'Stopp', command: 'stop' },
  ],
  defaultEnv: {},
  ports: [
    {
      containerPort: 25_565,
      protocol: 'tcp',
      primary: true,
      label: 'Spiel-Port',
    },
  ],
  /*
   * Bewusst kurz gehalten. Aufgenommen ist, was ein Betreiber beim Anlegen
   * wirklich entscheidet; alles Übrige – `online-mode`, `level-seed`,
   * `spawn-protection`, Plugins, Ops – setzt er in der Konsole oder über die
   * Dateiverwaltung direkt in `server.properties`. Das Startskript fasst genau
   * die Schlüssel an, die hier stehen, und lässt die übrigen unberührt.
   */
  configFields: [
    {
      key: 'eula',
      label: 'EULA von Mojang angenommen',
      type: 'toggle',
      defaultValue: false,
      description:
        'Ein Minecraft-Server darf nur mit Zustimmung zur Endnutzer-Lizenzvereinbarung von Mojang betrieben werden (https://aka.ms/MinecraftEULA). Ohne diese Zustimmung startet der Server nicht.',
      required: true,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'motd',
      label: 'Serverbeschreibung',
      type: 'text',
      defaultValue: 'Ein Palantir-Server',
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
      key: 'gamemode',
      label: 'Spielmodus',
      type: 'select',
      defaultValue: 'survival',
      description: 'Gilt für neu verbindende Spieler.',
      required: false,
      options: ['survival', 'creative', 'adventure', 'spectator'],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'difficulty',
      label: 'Schwierigkeit',
      type: 'select',
      defaultValue: 'normal',
      description: null,
      required: false,
      options: ['peaceful', 'easy', 'normal', 'hard'],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'viewDistance',
      label: 'Sichtweite (Chunks)',
      type: 'number',
      defaultValue: 10,
      description:
        'Der größte Hebel für den Ressourcenbedarf: Jeder Chunk mehr kostet Arbeitsspeicher und Rechenzeit für jeden Spieler.',
      required: false,
      options: [],
      min: 3,
      max: 32,
      lockedAfterCreate: false,
    },
    {
      key: 'whitelist',
      label: 'Nur zugelassene Spieler',
      type: 'toggle',
      defaultValue: false,
      description:
        'Lässt nur Spieler auf der Whitelist zu. Die Liste selbst wird in der Konsole gepflegt (`palantir-console whitelist add <Name>`).',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
  ],
  envMapping: {
    eula: 'EULA',
    motd: 'MOTD',
    maxPlayers: 'MAX_PLAYERS',
    gamemode: 'GAMEMODE',
    difficulty: 'DIFFICULTY',
    viewDistance: 'VIEW_DISTANCE',
    whitelist: 'WHITELIST',
  },
  /*
   * Alle sieben Werte liest `start.sh` beim Start aus der Umgebung und schreibt
   * sie nach `server.properties`; der laufende Server sieht eine Änderung also
   * erst nach einem Neustart. Wer die Wirkung sofort will, setzt sie zusätzlich
   * über die Konsole (`difficulty hard`) – das Panel bleibt trotzdem die Quelle
   * für den nächsten Start.
   */
  restartRequiredFields: [
    'eula',
    'motd',
    'maxPlayers',
    'gamemode',
    'difficulty',
    'viewDistance',
    'whitelist',
  ],
  /*
   * Realistisch für Paper, nicht die 256 MiB des Prüfstands. 4 GiB sind die
   * übliche Empfehlung für eine Handvoll Spieler: Davon gehen laut `start.sh`
   * 3 GiB in den Heap, der Rest deckt Metaspace, Code-Cache und die
   * Direktpuffer von Netty. Mit 1 GiB liefe der Server, aber unter Last in
   * Dauer-GC. Der Betreiber kann die Werte im Wizard ändern.
   */
  resourceDefaults: {
    ramMb: 4_096,
    cpuCores: 2,
    diskMb: 10_240,
  },
  query: {
    kind: 'gamedig',
    protocol: 'minecraft',
    containerPort: 25_565,
  },
  /*
   * Konsole über RCON (P2-9) statt über die Standardeingabe: So kommt die
   * Antwort eines Befehls zurück, statt irgendwo im Log zu stehen. Das Image
   * (ab Fassung 2) schaltet RCON ein und legt bei jedem Start ein neues
   * Passwort in den Datenordner; der Port wird nie veröffentlicht und ist nur
   * aus dem Spielenetz zu erreichen – dort nur vom Agent (`egress-firewall.sh`).
   */
  console: {
    kind: 'rcon',
    port: 25_575,
    passwordFile: '.palantir/rcon.password',
  },
  iconUrl: null,
  coverImageUrl: null,
  supportsVirtualHostRouting: true,
  supportsWorldImport: true,
  dataVolumeContainerPath: '/data',
  /*
   * Das Image schreibt ausschließlich in den Datenordner – auch das temporäre
   * Verzeichnis der JVM liegt dort (`-Djava.io.tmpdir`), weil `/tmp` als
   * `noexec`-tmpfs eingehängt wird und Netty seine native Bibliothek dort
   * entpacken und ausführen würde. `/tmp` bleibt trotzdem beschreibbar: Es ist
   * der Ort, an dem eine JVM ohne weiteres Zutun landet.
   */
  readOnlyRootFilesystem: true,
  tmpfsPaths: ['/tmp'],
  /*
   * Paper speichert beim Herunterfahren die ganze Welt. 15 Sekunden wie beim
   * Prüfstand reichten dafür bei einer gewachsenen Welt nicht; danach käme
   * SIGKILL und mit ihm ein möglicher Datenverlust.
   */
  stopTimeoutSeconds: 60,
  startupTimeoutSeconds: 600,
  phase: 2,
};

/**
 * Minecraft in der Ausgabe von Mojang (Wunsch des Betreibers, 2026-09-10).
 *
 * **Dasselbe Image, ein anderer Schalter.** Beide Ausgaben laufen aus
 * `palantir-game-minecraft`; das Startskript entscheidet über
 * `MINECRAFT_EDITION`, welche Jar es startet. Alles Übrige – EULA,
 * `server.properties`, RCON, Heap, Konsole, Hostname-Routing – ist gleich, und
 * deshalb ist diese Definition eine Abwandlung der Paper-Definition und keine
 * zweite Abschrift: Ein neues Feld dort gilt hier sofort mit.
 *
 * **Die Jar kommt nicht aus dem Image.** Paper darf weitergegeben werden, der
 * Server von Mojang nicht. Er wird beim ersten Start in den Datenordner geholt
 * und gegen die Prüfsumme aus dem Image geprüft (`images/game/minecraft`). Der
 * Preis steht im Startskript: Der erste Start braucht Netz.
 *
 * **Warum überhaupt, wenn Paper schneller ist.** Paper ist ein Nachbau. Er
 * verhält sich an vielen Stellen absichtlich anders – Redstone,
 * Mob-Verhalten, Spawn-Regeln –, und wer eine Welt so spielen will, wie Mojang
 * sie meint, oder ein Datenpaket testet, braucht den Server von Mojang. Plugins
 * gibt es dafür nicht.
 */
export const MINECRAFT_VANILLA_GAME_TYPE: GameTypeDefinition = {
  ...MINECRAFT_PAPER_GAME_TYPE,
  id: 'minecraft-vanilla',
  name: 'Minecraft (Vanilla)',
  description:
    'Minecraft-Server, wie Mojang ihn ausliefert – ohne Nachbau, ohne Plugins. Die Serverdateien werden beim ersten Start geholt; der dauert deshalb länger. Vor dem ersten Start muss die Endnutzer-Lizenzvereinbarung von Mojang angenommen werden.',
  defaultEnv: { MINECRAFT_EDITION: 'vanilla' },
  /*
   * Wie bei Paper, ohne `tps`: Das ist ein Paper-Befehl, den der Server von
   * Mojang mit „Unknown command" beantwortet. Ein Schnellbefehl, der nichts
   * tut, ist schlechter als keiner.
   */
  consoleQuickCommands: [
    { label: 'Spieler', command: 'list' },
    { label: 'Speichern', command: 'save-all' },
    { label: 'Whitelist', command: 'whitelist list' },
    { label: 'Stopp', command: 'stop' },
  ],
};

/**
 * Alle bekannten Spiele-Definitionen.
 *
 * Reihenfolge = Anzeigereihenfolge im Server-erstellen-Wizard (F3).
 */
/**
 * Die Prüfstände (Wunsch des Betreibers, 2026-09-10: „entferne die Vorlagen,
 * die zum Testen da waren").
 *
 * Sie stehen **nicht** mehr in {@link GAME_TYPE_DEFINITIONS} und werden im
 * Panel deshalb nicht mehr als Vorlage angeboten. Gelöscht sind sie trotzdem
 * nicht: Die halbe Testkette des Backends steht auf ihnen – sie sind die
 * einzigen Spieltypen, die sich ohne echtes Spiel starten lassen, und
 * `test-echo` ist die Vorlage in fast jedem Test dieses Moduls. Ein Test, der
 * sie braucht, reicht {@link ALLE_GAME_TYPE_DEFINITIONS} an
 * {@link createGameRegistry} weiter.
 *
 * Ein Server, der noch auf einem Prüfstand läuft, bleibt bedienbar: `require()`
 * findet die Definition weiterhin, sobald die Liste sie enthält. Zum Zeitpunkt
 * der Umstellung gab es keinen.
 */
export const PRUEFSTAND_GAME_TYPE_DEFINITIONS: readonly GameTypeDefinition[] = [
  TEST_GAME_TYPE,
  TEST_MINECRAFT_GAME_TYPE,
];

/**
 * Valheim – das erste Spiel aus Steam (Anhang A, Phase 3).
 *
 * **Was daran neu ist**, ist nicht das Spiel, sondern woher die Serverdateien
 * kommen: Paper liegt als Jar im Image, Valheim holt SteamCMD bei jedem Start
 * in den Datenordner (`images/base/steam`). Die Fassung des Spiels hängt damit
 * an Valve, nicht am Image-Tag – der Preis dafür, dass Gigabyte an Spieldaten
 * nicht in einer Registry liegen (Entscheidung des Betreibers, 2026-09-10).
 *
 * **UDP, nicht TCP.** Valheim spricht zwei Ports: 2456 für das Spiel, 2457 für
 * die Abfrage der Serverliste. Beide gehen über den Tunnel; `frpc.toml` legt zu
 * jedem Pool-Port ohnehin einen TCP- **und** einen UDP-Proxy an.
 *
 * **Kein Hostname-Routing.** Der Router liest den Namen aus dem
 * Minecraft-Handshake; ein UDP-Spiel liefert nichts dergleichen. Valheim behält
 * deshalb seinen Port in der Adresse.
 *
 * **Keine Konsole.** Valheim liest keine Befehle von der Standardeingabe und
 * kennt kein RCON. Das Startskript legt das Rohr trotzdem an, damit sich der
 * Anschluss verhält wie überall sonst; Schnellbefehle gibt es keine.
 *
 * **Die Startfrist ist großzügig**, weil der erste Start die Serverdateien
 * herunterlädt – gut ein Gigabyte über SteamCMD. Spätere Starts prüfen nur, ob
 * etwas Neues da ist, und brauchen eine knappe Minute.
 */
export const VALHEIM_GAME_TYPE: GameTypeDefinition = {
  id: 'valheim',
  name: 'Valheim',
  description:
    'Überlebensspiel in der Welt der Wikinger. Der Server holt seine Dateien beim Start selbst über Steam; ein Passwort ist Pflicht, sonst startet Valheim nicht.',
  dockerImage: 'ghcr.io/nightriderp/palantir-game-valheim:1',
  defaultEnv: {},
  ports: [
    {
      containerPort: 2456,
      protocol: 'udp',
      primary: true,
      label: 'Spiel-Port',
    },
    {
      containerPort: 2457,
      protocol: 'udp',
      primary: false,
      label: 'Abfrage-Port',
    },
  ],
  configFields: [
    {
      key: 'serverName',
      label: 'Name in der Serverliste',
      type: 'text',
      defaultValue: 'Ein Palantir-Server',
      description: 'Unter diesem Namen taucht der Server in der Liste auf.',
      required: true,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'world',
      label: 'Welt',
      type: 'text',
      defaultValue: 'Dedicated',
      description:
        'Name der Weltdatei. Ein neuer Name legt eine neue Welt an; ein vorhandener setzt die bestehende fort.',
      required: true,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'password',
      label: 'Passwort',
      type: 'password',
      defaultValue: '',
      description:
        'Mindestens fünf Zeichen. Valheim verlangt es und lehnt es ab, wenn es im Server- oder Weltnamen vorkommt.',
      required: true,
      options: [],
      min: 5,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'public',
      label: 'In der Serverliste zeigen',
      type: 'toggle',
      // Vorgabe „an", obwohl „nur wer die Adresse kennt" die zurückhaltendere
      // Einstellung wäre: Valheim beantwortet ohne sie überhaupt keine Abfrage,
      // und dann sieht das Panel weder Spielerzahl noch Ping (`query` unten).
      // Wer sie ausschaltet, soll das entscheiden — nicht durch eine Vorgabe
      // hineinrutschen und sich wundern, warum die Kachel leer bleibt.
      defaultValue: true,
      description:
        'Aus heißt: nur wer die Adresse kennt, findet den Server — das Passwort gilt ohnehin in beiden Fällen. Valheim beantwortet dann allerdings keine Abfragen mehr: Das Panel zeigt weder Spielerzahl noch Ping, und der automatische Stopp bei 0 Spielern greift nicht.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
  ],
  envMapping: {
    serverName: 'VALHEIM_NAME',
    world: 'VALHEIM_WORLD',
    password: 'VALHEIM_PASSWORD',
    public: 'VALHEIM_PUBLIC',
  },
  // Alle vier liest das Startskript einmalig beim Start aus der Umgebung.
  restartRequiredFields: ['serverName', 'world', 'password', 'public'],
  /*
   * Valheim ist bekannt dafür, mit der Weltgröße hungrig zu werden. Vier
   * Gigabyte tragen eine Handvoll Spieler; der Betreiber kann die Werte im
   * Wizard ändern.
   */
  resourceDefaults: {
    ramMb: 4096,
    cpuCores: 2,
    diskMb: 10_240,
  },
  /*
   * Abgefragt wird der **Abfrage-Port**, nicht der Spiel-Port: Auf 2456 läuft
   * das Spielprotokoll, die Serverliste antwortet daneben auf 2457.
   */
  query: {
    kind: 'gamedig',
    protocol: 'valheim',
    containerPort: 2457,
    /*
     * **Ohne `-public 1` antwortet Valheim auf keine Abfrage.** Die Bibliothek
     * sagt es selbst (`gamedig/GAMES_LIST.md`, Abschnitt Valheim): Der Server
     * meldet sich nur im öffentlichen Modus beim Steam-Verzeichnis an, und nur
     * dann beantwortet er A2S. Erreichbar ist er trotzdem – wer Adresse und
     * Passwort hat, spielt.
     *
     * Ohne diese Zeile hielte der Start-Check ihn für tot, und der Server liefe
     * nach zwanzig Minuten in `error`, während Spieler darauf unterwegs sind.
     * Dieselbe Klasse wie die Fundpunkte 183, 187, 193 und 246.
     */
    requiresConfigFlag: 'public',
  },
  /*
   * Valheim nimmt keine Befehle entgegen – weder über die Standardeingabe noch
   * über RCON. Ohne diese Angabe gälte `stdin`, und das Panel zeigte ein
   * Eingabefeld, dessen Zeilen in einem Rohr verschwinden, das niemand liest.
   */
  console: { kind: 'none' },
  iconUrl: null,
  coverImageUrl: null,
  supportsVirtualHostRouting: false,
  supportsWorldImport: false,
  dataVolumeContainerPath: '/data',
  /*
   * Geschrieben wird nur in den Datenordner: dorthin holt SteamCMD die
   * Serverdateien, dort liegen die Welten. `/tmp` bleibt beschreibbar, weil ein
   * Unity-Server ohne weiteres Zutun dort landet.
   */
  readOnlyRootFilesystem: true,
  tmpfsPaths: ['/tmp'],
  /*
   * Valheim speichert die Welt beim Herunterfahren. Eine Minute ist reichlich
   * und billiger als eine beschädigte Welt.
   */
  stopTimeoutSeconds: 60,
  startupTimeoutSeconds: 1_200,
  phase: 3,
};

/**
 * Terraria – das erste Spiel ohne Laufzeit-Basis dazwischen (Anhang A, Phase 3).
 *
 * **Was daran anders ist als bei Valheim.** Der Server bringt sein Mono und
 * seine Bibliotheken selbst mit; das Image sitzt deshalb unmittelbar auf
 * `palantir-base-linux`, ohne SteamCMD und ohne JVM. Und er spricht **TCP** –
 * damit reicht dem Health-Check ein Verbindungsversuch (`portConnect`), es
 * braucht keine Spieleabfrage. Der Preis steht in `playerCountAvailableFor`:
 * Ein Port-Connect sagt nur, dass der Port Verbindungen annimmt, nicht wie
 * viele Leute spielen – der automatische Stopp bleibt hier wirkungslos.
 *
 * (Es gäbe eine Abfrage über `gamedig`, aber nur mit der Server-Erweiterung
 * TShock und einem REST-Token. Das ist ein anderes Spiel-Image, kein Schalter.)
 *
 * **Die Konsole ist der Weg über die Standardeingabe** – Terraria kennt kein
 * RCON. `palantir-console` schreibt in das Rohr, das das Startskript anlegt;
 * die Antwort steht im Log, nicht in der Rückgabe des Befehls.
 *
 * **`stopTimeoutSeconds` ist großzügig**, weil das Speichern der Welt hier am
 * Stopp hängt: Terraria speichert bei SIGTERM nicht, das Startskript schickt
 * deshalb `exit` in die Konsole und wartet. Läuft die Kulanzzeit ab, kommt
 * SIGKILL – und die Welt steht auf dem Stand des letzten selbsttätigen
 * Speicherns.
 */
export const TERRARIA_GAME_TYPE: GameTypeDefinition = {
  id: 'terraria',
  name: 'Terraria',
  description:
    'Terraria-Server von Re-Logic. Die Serverdateien werden beim ersten Start geholt; die Welt wird beim ersten Start erzeugt, was je nach Größe einige Minuten dauert.',
  dockerImage: 'ghcr.io/nightriderp/palantir-game-terraria:1',
  // Vollständige Zeilen, wie sie die Konsole von Terraria versteht. `say <Text>`
  // braucht eine Eingabe und gehört deshalb ins Feld, nicht auf einen Knopf.
  consoleQuickCommands: [
    { label: 'Spieler', command: 'playing' },
    { label: 'Speichern', command: 'save' },
    { label: 'Zeit', command: 'time' },
    { label: 'Stopp', command: 'exit' },
  ],
  defaultEnv: {},
  ports: [
    {
      containerPort: 7777,
      protocol: 'tcp',
      primary: true,
      label: 'Spiel-Port',
    },
  ],
  configFields: [
    {
      key: 'worldName',
      label: 'Name der Welt',
      type: 'text',
      defaultValue: 'Palantir',
      description:
        'Legt zugleich den Dateinamen fest (`welten/<Name>.wld`). Eine Umbenennung erzeugt beim nächsten Start eine neue, leere Welt – die alte bleibt liegen.',
      required: true,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'size',
      label: 'Weltgröße',
      type: 'select',
      defaultValue: 'mittel',
      description: 'Gilt nur beim Erzeugen der Welt. Eine bestehende Welt wächst davon nicht.',
      required: false,
      options: ['klein', 'mittel', 'groß'],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'difficulty',
      label: 'Spielart',
      type: 'select',
      defaultValue: 'klassisch',
      description: 'Gilt nur beim Erzeugen der Welt.',
      required: false,
      options: ['klassisch', 'experte', 'meister', 'reise'],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'seed',
      label: 'Startwert (Seed)',
      type: 'text',
      defaultValue: '',
      description:
        'Leer lassen für eine zufällige Welt. Gilt nur beim Erzeugen; besondere Startwerte wie „for the worthy" ändern das Spiel deutlich.',
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
      defaultValue: 8,
      description: null,
      required: false,
      options: [],
      min: 1,
      max: 255,
      lockedAfterCreate: false,
    },
    {
      key: 'password',
      label: 'Passwort',
      type: 'password',
      defaultValue: '',
      description: 'Leer lassen, wenn jeder mit der Adresse beitreten darf.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'motd',
      label: 'Begrüßung',
      type: 'text',
      defaultValue: 'Ein Palantir-Server',
      description: 'Steht im Chat, sobald jemand beitritt.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
  ],
  envMapping: {
    worldName: 'TERRARIA_WORLD',
    size: 'TERRARIA_SIZE',
    difficulty: 'TERRARIA_DIFFICULTY',
    seed: 'TERRARIA_SEED',
    maxPlayers: 'MAX_PLAYERS',
    password: 'TERRARIA_PASSWORD',
    motd: 'MOTD',
  },
  // Alle sieben liest das Startskript einmalig beim Start aus der Umgebung und
  // schreibt sie nach `serverconfig.txt`.
  restartRequiredFields: [
    'worldName',
    'size',
    'difficulty',
    'seed',
    'maxPlayers',
    'password',
    'motd',
  ],
  /*
   * Ein Terraria-Server ist genügsam: Er hält eine Welt im Speicher und rechnet
   * auf einem Kern. 2 GiB und ein Kern decken eine große Welt mit einer
   * Handvoll Spielern ab; der Betreiber kann im Wizard mehr geben.
   */
  resourceDefaults: {
    ramMb: 2_048,
    cpuCores: 1,
    diskMb: 5_120,
  },
  query: {
    kind: 'portConnect',
    containerPort: 7777,
  },
  console: { kind: 'stdin' },
  iconUrl: null,
  coverImageUrl: null,
  // Der Router liest den Namen aus dem Minecraft-Handshake; Terrarias Protokoll
  // kennt nichts dergleichen. Die Adresse behält ihren Port.
  supportsVirtualHostRouting: false,
  supportsWorldImport: true,
  dataVolumeContainerPath: '/data',
  readOnlyRootFilesystem: true,
  tmpfsPaths: ['/tmp'],
  // Speichern hängt am Stopp: Das Startskript schickt `exit` und wartet.
  stopTimeoutSeconds: 120,
  // Der erste Start holt 46 MiB und erzeugt danach die Welt – eine große Welt
  // braucht auf einem Homeserver mehrere Minuten.
  startupTimeoutSeconds: 900,
  phase: 3,
};

/**
 * Factorio – ein Server ohne Steam (Anhang A, Phase 3).
 *
 * **Was daran anders ist.** Wube gibt den Headless-Server als eigenes Archiv
 * heraus; es braucht kein Steam-Konto und keine Anwendungsnummer. Das Image
 * sitzt deshalb unmittelbar auf `palantir-base-linux`, wie Terraria.
 *
 * **Die Konsole geht über RCON.** Factorio spricht das Source-RCON-Protokoll,
 * dasselbe wie Minecraft — die Antwort eines Befehls kommt also zurück, statt
 * im Log zu stehen. Das Passwort entsteht bei jedem Start neu und liegt nur im
 * Datenordner; der Port wird nie veröffentlicht.
 *
 * **Kein Feld für die öffentliche Serverliste.** Dafür verlangt Factorio ein
 * Konto bei Wube (Benutzername und Token). Zugangsdaten Dritter gehören nicht
 * ins Panel (Entscheidung des Betreibers, 2026-09-11); das Startskript kann es,
 * die Felder fehlen bewusst.
 */
export const FACTORIO_GAME_TYPE: GameTypeDefinition = {
  id: 'factorio',
  name: 'Factorio',
  description:
    'Factorio-Server von Wube. Die Serverdateien werden beim ersten Start geholt, die Karte beim ersten Start erzeugt. Die Konsole läuft über RCON.',
  dockerImage: 'ghcr.io/nightriderp/palantir-game-factorio:1',
  // Befehle der Factorio-Konsole beginnen mit einem Schrägstrich.
  consoleQuickCommands: [
    { label: 'Spieler', command: '/players' },
    { label: 'Speichern', command: '/save' },
    { label: 'Admins', command: '/admins' },
    { label: 'Fassung', command: '/version' },
  ],
  defaultEnv: {},
  ports: [
    {
      containerPort: 34_197,
      protocol: 'udp',
      primary: true,
      label: 'Spiel-Port',
    },
  ],
  configFields: [
    {
      key: 'serverName',
      label: 'Servername',
      type: 'text',
      defaultValue: 'Ein Palantir-Server',
      description: null,
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'motd',
      label: 'Beschreibung',
      type: 'text',
      defaultValue: '',
      description: 'Steht neben dem Namen, wenn jemand den Server ansieht.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'map',
      label: 'Name der Karte',
      type: 'text',
      defaultValue: 'palantir',
      description:
        'Legt den Dateinamen fest (`karten/<Name>.zip`). Ein neuer Name erzeugt beim nächsten Start eine neue Karte – die alte bleibt liegen.',
      required: true,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'seed',
      label: 'Startwert (Seed)',
      type: 'text',
      defaultValue: '',
      description: 'Leer lassen für eine zufällige Karte. Gilt nur beim Erzeugen.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: true,
    },
    {
      key: 'maxPlayers',
      label: 'Spieler höchstens',
      type: 'number',
      defaultValue: 0,
      description: '0 heißt: keine Grenze.',
      required: false,
      options: [],
      min: 0,
      max: 500,
      lockedAfterCreate: false,
    },
    {
      key: 'password',
      label: 'Passwort',
      type: 'password',
      defaultValue: '',
      description: 'Leer lassen, wenn jeder mit der Adresse beitreten darf.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'autosaveMinutes',
      label: 'Selbsttätig speichern (Minuten)',
      type: 'number',
      defaultValue: 10,
      description: 'Der Server hält dabei kurz an; fünf Stände bleiben erhalten.',
      required: false,
      options: [],
      min: 1,
      max: 120,
      lockedAfterCreate: false,
    },
  ],
  envMapping: {
    serverName: 'FACTORIO_NAME',
    motd: 'MOTD',
    map: 'FACTORIO_MAP',
    seed: 'FACTORIO_SEED',
    maxPlayers: 'MAX_PLAYERS',
    password: 'FACTORIO_PASSWORD',
    autosaveMinutes: 'FACTORIO_AUTOSAVE_MINUTES',
  },
  restartRequiredFields: [
    'serverName',
    'motd',
    'map',
    'seed',
    'maxPlayers',
    'password',
    'autosaveMinutes',
  ],
  /*
   * Factorio ist sparsam, solange die Fabrik klein ist – und wächst mit ihr.
   * 4 GiB und zwei Kerne tragen eine gewachsene Karte mit einer Handvoll
   * Spielern; die Rechenzeit geht in die Simulation, nicht in die Grafik.
   */
  resourceDefaults: {
    ramMb: 4_096,
    cpuCores: 2,
    diskMb: 10_240,
  },
  query: {
    kind: 'gamedig',
    protocol: 'factorio',
    containerPort: 34_197,
  },
  console: {
    kind: 'rcon',
    port: 27_015,
    passwordFile: '.palantir/rcon.password',
  },
  iconUrl: null,
  coverImageUrl: null,
  supportsVirtualHostRouting: false,
  supportsWorldImport: true,
  dataVolumeContainerPath: '/data',
  readOnlyRootFilesystem: true,
  tmpfsPaths: ['/tmp'],
  // Factorio speichert beim Stoppsignal selbst; eine Minute reicht auch für
  // eine große Karte.
  stopTimeoutSeconds: 60,
  // Der erste Start holt 55 MiB und erzeugt danach die Karte.
  startupTimeoutSeconds: 600,
  phase: 3,
};

/**
 * Project Zomboid – zweites Spiel aus Steam (Anhang A, Phase 3).
 *
 * **Zwei Eigenheiten, die ohne Vorwarnung Zeit kosten.** Ohne
 * `-adminpassword` fragt der Server beim ersten Start interaktiv danach und
 * wartet – im Container ohne Aussicht auf eine Antwort; das Feld ist deshalb
 * Pflicht. Und der Servername wird zum Dateinamen der Einstellungen und zum
 * Namen des Weltordners: Ein Leerzeichen darin führt zu Pfaden, die niemand
 * wiederfindet, weshalb ihn das Startskript auf Buchstaben, Ziffern, `-` und
 * `_` begrenzt.
 *
 * **Die Abfrage hängt am öffentlichen Modus** (`requiresConfigFlag`), wie bei
 * Valheim: Ein Server, der sich nicht beim Steam-Verzeichnis anmeldet,
 * beantwortet keine A2S-Abfrage. Erreichbar bleibt er.
 */
export const PROJECT_ZOMBOID_GAME_TYPE: GameTypeDefinition = {
  id: 'project-zomboid',
  name: 'Project Zomboid',
  description:
    'Project-Zomboid-Server. Die Serverdateien holt SteamCMD beim ersten Start; das dauert einige Minuten. Ein Administrator-Passwort ist Pflicht.',
  dockerImage: 'ghcr.io/nightriderp/palantir-game-projectzomboid:1',
  consoleQuickCommands: [
    { label: 'Spieler', command: 'players' },
    { label: 'Speichern', command: 'save' },
    { label: 'Stopp', command: 'quit' },
  ],
  defaultEnv: {},
  ports: [
    {
      containerPort: 16_261,
      protocol: 'udp',
      primary: true,
      label: 'Spiel-Port',
    },
    {
      containerPort: 16_262,
      protocol: 'udp',
      primary: false,
      label: 'Verbindungs-Port',
    },
  ],
  configFields: [
    {
      key: 'serverName',
      label: 'Kennung des Servers',
      type: 'text',
      defaultValue: 'palantir',
      description:
        'Wird zum Dateinamen der Einstellungen und zum Namen des Weltordners – nur Buchstaben, Ziffern, - und _. Nicht der Name, den Spieler sehen.',
      required: true,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: true,
    },
    {
      key: 'publicName',
      label: 'Angezeigter Name',
      type: 'text',
      defaultValue: 'Ein Palantir-Server',
      description: 'So steht der Server in der Serverliste.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'motd',
      label: 'Beschreibung',
      type: 'text',
      defaultValue: '',
      description: null,
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'adminPassword',
      label: 'Administrator-Passwort',
      type: 'password',
      defaultValue: '',
      description:
        'Pflicht. Ohne es fragt der Server beim ersten Start danach und wartet – im Container ohne Aussicht auf eine Antwort.',
      required: true,
      options: [],
      min: 5,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'password',
      label: 'Passwort für Spieler',
      type: 'password',
      defaultValue: '',
      description: 'Leer lassen, wenn jeder mit der Adresse beitreten darf.',
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
      defaultValue: 16,
      description: null,
      required: false,
      options: [],
      min: 1,
      max: 100,
      lockedAfterCreate: false,
    },
    {
      key: 'pvp',
      label: 'Spieler gegen Spieler',
      type: 'toggle',
      defaultValue: true,
      description: null,
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'public',
      label: 'In der Serverliste zeigen',
      type: 'toggle',
      // Wie bei Valheim: Ohne den öffentlichen Modus beantwortet der Server
      // keine Abfrage, und das Panel sieht weder Spielerzahl noch Ping.
      defaultValue: true,
      description:
        'Aus heißt: nur wer die Adresse kennt, findet den Server. Das Panel sieht dann allerdings weder Spielerzahl noch Ping, und der automatische Stopp bei 0 Spielern greift nicht.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
  ],
  envMapping: {
    serverName: 'ZOMBOID_NAME',
    publicName: 'ZOMBOID_PUBLIC_NAME',
    motd: 'MOTD',
    adminPassword: 'ZOMBOID_ADMIN_PASSWORD',
    password: 'ZOMBOID_PASSWORD',
    maxPlayers: 'MAX_PLAYERS',
    pvp: 'ZOMBOID_PVP',
    public: 'ZOMBOID_PUBLIC',
  },
  restartRequiredFields: [
    'serverName',
    'publicName',
    'motd',
    'adminPassword',
    'password',
    'maxPlayers',
    'pvp',
    'public',
  ],
  /*
   * Project Zomboid hält die geladenen Zellen der Welt im Speicher; mit
   * wachsender Spielerzahl wächst der Bedarf spürbar. 4 GiB tragen die
   * vorgegebenen 16 Spieler.
   */
  resourceDefaults: {
    ramMb: 4_096,
    cpuCores: 2,
    diskMb: 10_240,
  },
  query: {
    kind: 'gamedig',
    protocol: 'projectzomboid',
    containerPort: 16_261,
    requiresConfigFlag: 'public',
  },
  console: { kind: 'stdin' },
  iconUrl: null,
  coverImageUrl: null,
  supportsVirtualHostRouting: false,
  supportsWorldImport: true,
  dataVolumeContainerPath: '/data',
  readOnlyRootFilesystem: true,
  tmpfsPaths: ['/tmp'],
  // Gespeichert wird beim Konsolenbefehl `quit`, den das Startskript beim
  // Stoppsignal schickt – das braucht bei einer gewachsenen Welt Zeit.
  stopTimeoutSeconds: 120,
  // Der erste Start holt mehrere Gigabyte über SteamCMD.
  startupTimeoutSeconds: 1_200,
  phase: 3,
};

/**
 * Rust – dritter Server aus Steam (Anhang A, Phase 3).
 *
 * **Die Konsole geht über RCON, aber nur mit einem Schalter.** Rust kann beide
 * Protokolle und nimmt von sich aus WebSocket; das Startskript setzt deshalb
 * `+rcon.web 0` und damit das Source-Protokoll, das der Agent spricht.
 *
 * **Weltgröße und Startwert sind nach dem Anlegen gesperrt.** Beides geht in
 * die Erzeugung der Karte ein – eine Änderung erzeugte eine andere Welt, und
 * alles Gebaute stünde nicht mehr darin.
 */
export const RUST_GAME_TYPE: GameTypeDefinition = {
  id: 'rust',
  name: 'Rust',
  description:
    'Rust-Server. Die Serverdateien holt SteamCMD beim ersten Start; das sind mehrere Gigabyte, und die Karte wird danach erzeugt – der erste Start dauert entsprechend.',
  dockerImage: 'ghcr.io/nightriderp/palantir-game-rust:1',
  consoleQuickCommands: [
    { label: 'Server', command: 'serverinfo' },
    { label: 'Spieler', command: 'playerlist' },
    { label: 'Speichern', command: 'server.save' },
  ],
  defaultEnv: {},
  ports: [
    {
      containerPort: 28_015,
      protocol: 'udp',
      primary: true,
      label: 'Spiel-Port',
    },
  ],
  configFields: [
    {
      key: 'serverName',
      label: 'Servername',
      type: 'text',
      defaultValue: 'Ein Palantir-Server',
      description: null,
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'motd',
      label: 'Beschreibung',
      type: 'text',
      defaultValue: '',
      description: 'Steht in der Serverliste unter dem Namen.',
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
      defaultValue: 50,
      description: null,
      required: false,
      options: [],
      min: 1,
      max: 500,
      lockedAfterCreate: false,
    },
    {
      key: 'worldSize',
      label: 'Weltgröße',
      type: 'number',
      defaultValue: 3000,
      description:
        'Kantenlänge der Karte. Größer heißt mehr Platz, mehr Arbeitsspeicher und eine längere Erzeugung beim ersten Start.',
      required: false,
      options: [],
      min: 1000,
      max: 6000,
      lockedAfterCreate: true,
    },
    {
      key: 'seed',
      label: 'Startwert (Seed)',
      type: 'text',
      defaultValue: '',
      description: 'Leer lassen für Rusts eigene Vorgabe. Geht in die Erzeugung der Karte ein.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: true,
    },
    {
      key: 'saveIntervalSeconds',
      label: 'Selbsttätig speichern (Sekunden)',
      type: 'number',
      defaultValue: 300,
      description: null,
      required: false,
      options: [],
      min: 60,
      max: 3600,
      lockedAfterCreate: false,
    },
  ],
  envMapping: {
    serverName: 'RUST_NAME',
    motd: 'MOTD',
    maxPlayers: 'MAX_PLAYERS',
    worldSize: 'RUST_WORLD_SIZE',
    seed: 'RUST_SEED',
    saveIntervalSeconds: 'RUST_SAVE_INTERVAL',
  },
  restartRequiredFields: [
    'serverName',
    'motd',
    'maxPlayers',
    'worldSize',
    'seed',
    'saveIntervalSeconds',
  ],
  /*
   * Rust ist der anspruchsvollste Server dieser Liste: Die ganze Karte liegt im
   * Speicher, und die Erzeugung beim ersten Start rechnet lange auf allen
   * Kernen. 8 GiB und vier Kerne sind die untere Grenze für eine Karte von
   * 3000; die Serverdateien allein wiegen über zehn Gigabyte.
   */
  resourceDefaults: {
    ramMb: 8_192,
    cpuCores: 4,
    diskMb: 30_720,
  },
  query: {
    kind: 'gamedig',
    protocol: 'rust',
    containerPort: 28_015,
  },
  console: {
    kind: 'rcon',
    port: 28_016,
    passwordFile: '.palantir/rcon.password',
  },
  iconUrl: null,
  coverImageUrl: null,
  supportsVirtualHostRouting: false,
  supportsWorldImport: true,
  dataVolumeContainerPath: '/data',
  readOnlyRootFilesystem: true,
  tmpfsPaths: ['/tmp'],
  /*
   * Rust speichert beim Stoppsignal nicht; `quit` tut es und beendet danach.
   * Der Agent schickt den Befehl über RCON und wartet auf das Ende, bevor
   * das Signal kommt.
   */
  stopCommand: 'quit',
  stopTimeoutSeconds: 120,
  // Erster Start: über zehn Gigabyte holen, danach die Karte erzeugen.
  startupTimeoutSeconds: 1_800,
  phase: 3,
};

/**
 * Palworld – vierter Server aus Steam (Anhang A, Phase 3).
 *
 * **Es gibt keine Abfrage** (`query.kind: 'none'`). Palworld beantwortet nur
 * seine eigene REST-Schnittstelle, und die verlangt Benutzer und
 * Administrator-Passwort; `gamedig` nennt sie selbst „experimental". Der Start
 * gilt deshalb als geglückt, sobald der Container läuft – es gibt keine
 * Spielerzahl, keinen Ping und keinen automatischen Stopp.
 *
 * **Das Administrator-Passwort ist zugleich das RCON-Passwort.** Palworld kennt
 * dafür kein zweites Feld: Wer RCON spricht, ist Administrator. Das Startskript
 * erzeugt es bei jedem Start neu und legt es dort ab, wo das Panel es erwartet;
 * im Panel gibt es deshalb **kein** Feld dafür.
 */
export const PALWORLD_GAME_TYPE: GameTypeDefinition = {
  id: 'palworld',
  name: 'Palworld',
  description:
    'Palworld-Server. Die Serverdateien holt SteamCMD beim ersten Start. Das Panel kann diesen Server nicht abfragen – es zeigt weder Spielerzahl noch Ping.',
  dockerImage: 'ghcr.io/nightriderp/palantir-game-palworld:1',
  // Die RCON-Befehle von Palworld beginnen mit einem Schrägstrich.
  consoleQuickCommands: [
    { label: 'Server', command: '/Info' },
    { label: 'Spieler', command: '/ShowPlayers' },
    { label: 'Speichern', command: '/Save' },
  ],
  defaultEnv: {},
  ports: [
    {
      containerPort: 8_211,
      protocol: 'udp',
      primary: true,
      label: 'Spiel-Port',
    },
  ],
  configFields: [
    {
      key: 'serverName',
      label: 'Servername',
      type: 'text',
      defaultValue: 'Ein Palantir-Server',
      description:
        'Anführungszeichen, Kommas und Klammern fallen weg – die Einstellungen von Palworld stehen in einer einzigen Zeile, die daran zerbräche.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'motd',
      label: 'Beschreibung',
      type: 'text',
      defaultValue: '',
      description: null,
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'password',
      label: 'Passwort',
      type: 'password',
      defaultValue: '',
      description: 'Leer lassen, wenn jeder mit der Adresse beitreten darf.',
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
      defaultValue: 32,
      description: 'Palworld selbst lässt höchstens 32 zu.',
      required: false,
      options: [],
      min: 1,
      max: 32,
      lockedAfterCreate: false,
    },
    {
      key: 'pvp',
      label: 'Spieler gegen Spieler',
      type: 'toggle',
      defaultValue: false,
      description: null,
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'deathPenalty',
      label: 'Was beim Tod verloren geht',
      type: 'select',
      defaultValue: 'All',
      description: 'None: nichts. Item: nur das Inventar. All: alles, samt Ausrüstung und Pals.',
      required: false,
      options: ['None', 'Item', 'ItemAndEquipment', 'All'],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
  ],
  envMapping: {
    serverName: 'PALWORLD_NAME',
    motd: 'MOTD',
    password: 'PALWORLD_PASSWORD',
    maxPlayers: 'MAX_PLAYERS',
    pvp: 'PALWORLD_PVP',
    deathPenalty: 'PALWORLD_DEATH_PENALTY',
  },
  restartRequiredFields: ['serverName', 'motd', 'password', 'maxPlayers', 'pvp', 'deathPenalty'],
  /*
   * Pocketpair nennt 16 GiB für volle 32 Spieler. 8 GiB tragen eine kleine
   * Runde; wer mehr Leute erwartet, erhöht im Wizard.
   */
  resourceDefaults: {
    ramMb: 8_192,
    cpuCores: 4,
    diskMb: 20_480,
  },
  query: {
    kind: 'none',
    containerPort: 8_211,
  },
  /*
   * `Shutdown 1` speichert und beendet nach einer Sekunde; ein nacktes
   * Stoppsignal lässt Palworld die Welt seit dem letzten selbsttätigen
   * Speichern liegen. Die Sekunde ist die Vorwarnung für die Spieler, die
   * das Spiel selbst vorsieht.
   */
  stopCommand: 'Shutdown 1',
  console: {
    kind: 'rcon',
    port: 25_575,
    passwordFile: '.palantir/rcon.password',
  },
  iconUrl: null,
  coverImageUrl: null,
  supportsVirtualHostRouting: false,
  supportsWorldImport: true,
  dataVolumeContainerPath: '/data',
  readOnlyRootFilesystem: true,
  tmpfsPaths: ['/tmp'],
  stopTimeoutSeconds: 120,
  startupTimeoutSeconds: 1_800,
  phase: 3,
};

/**
 * Minecraft mit Mods: Fabric und NeoForge (Anhang A, Phase 3).
 *
 * **Dasselbe Image, ein anderer Schalter** – wie bei Vanilla. Alles außer der
 * Jar ist gleich: EULA, `server.properties`, RCON, Heap, Konsole,
 * Hostname-Routing. Beide Definitionen sind deshalb Abwandlungen der
 * Paper-Definition und keine Abschriften.
 *
 * **Mods kommen über die Dateiverwaltung** in den Ordner `mods` im Datenordner.
 * Das Startskript legt ihn an, damit der Betreiber ihn vorfindet: Ein Mod im
 * falschen Ordner ist der häufigste Grund, warum „der Server die Mods nicht
 * lädt".
 *
 * **Die Fassung des Loaders steht im Image**, nicht im Panel. Sie muss zur
 * Spielfassung passen und zu den Mods, die der Betreiber einsetzt – eine freie
 * Eingabe wäre eine Einladung zu einem Server, der beim Start mit einem
 * Stapelabzug endet. Wer eine andere braucht, bekommt eine neue Image-Fassung.
 */
export const MINECRAFT_FABRIC_GAME_TYPE: GameTypeDefinition = {
  ...MINECRAFT_PAPER_GAME_TYPE,
  id: 'minecraft-fabric',
  name: 'Minecraft (Fabric)',
  description:
    'Minecraft mit dem Mod-Loader Fabric – der leichtere der beiden, mit schneller Unterstützung für neue Spielfassungen. Mods gehören in den Ordner „mods" im Datenordner.',
  defaultEnv: { MINECRAFT_EDITION: 'fabric' },
  // Wie bei Vanilla ohne `tps`: Das ist ein Paper-Befehl.
  consoleQuickCommands: [
    { label: 'Spieler', command: 'list' },
    { label: 'Speichern', command: 'save-all' },
    { label: 'Whitelist', command: 'whitelist list' },
    { label: 'Stopp', command: 'stop' },
  ],
  /*
   * Der erste Start holt die Starter-Jar, danach zieht sie den Server von
   * Mojang und die Bibliotheken nach – und erst dann entsteht die Welt.
   */
  startupTimeoutSeconds: 900,
};

export const MINECRAFT_NEOFORGE_GAME_TYPE: GameTypeDefinition = {
  ...MINECRAFT_PAPER_GAME_TYPE,
  id: 'minecraft-neoforge',
  name: 'Minecraft (NeoForge)',
  description:
    'Minecraft mit dem Mod-Loader NeoForge – der Nachfolger von Forge, den die meisten großen Modpacks verlangen. Der erste Start richtet ihn ein und dauert einige Minuten. Mods gehören in den Ordner „mods" im Datenordner.',
  defaultEnv: { MINECRAFT_EDITION: 'neoforge' },
  consoleQuickCommands: [
    { label: 'Spieler', command: 'list' },
    { label: 'Speichern', command: 'save-all' },
    { label: 'Whitelist', command: 'whitelist list' },
    { label: 'Stopp', command: 'stop' },
  ],
  /*
   * Länger als bei Fabric: Der erste Start lädt nicht nur, er richtet ein –
   * das Installationsprogramm holt den Server von Mojang und hundert
   * Bibliotheken und legt einen Baum daraus an.
   */
  startupTimeoutSeconds: 1_200,
  /*
   * Ein Modpack ist der Grund, warum jemand NeoForge nimmt, und Modpacks sind
   * hungrig. 6 GiB sind die untere Grenze, bei der ein mittleres Paket nicht
   * in Dauer-GC läuft.
   */
  resourceDefaults: {
    ramMb: 6_144,
    cpuCores: 2,
    diskMb: 15_360,
  },
};

/**
 * Satisfactory (Anhang A, Phase 3).
 *
 * **Der Port trägt beide Protokolle.** Seit Update 1.0 läuft alles über eine
 * Nummer – Spiel, Abfrage und die Schnittstelle des Server-Managers im Spiel.
 * Der Client leitet die zweite Adresse nicht ab, er benutzt dieselbe; mit zwei
 * getrennten Einträgen bekäme er zwei verschiedene Nummern aus dem Pool, und
 * das Beitreten bräche. Genau dafür gibt es `protocol: 'both'`.
 *
 * **Es gibt fast nichts einzustellen**, und das ist keine Lücke: Servername,
 * Passwörter und Spielstand vergibt der erste Spieler im Spiel, wenn er den
 * Server übernimmt. Ein Formularfeld, das danach nichts mehr bewirkt, wäre eine
 * Falle.
 */
export const SATISFACTORY_GAME_TYPE: GameTypeDefinition = {
  id: 'satisfactory',
  name: 'Satisfactory',
  description:
    'Satisfactory-Server. Die Serverdateien holt SteamCMD beim ersten Start – das sind über zehn Gigabyte. Eingerichtet wird der Server danach im Spiel: Der erste Spieler übernimmt ihn und vergibt Name und Passwörter.',
  dockerImage: 'ghcr.io/nightriderp/palantir-game-satisfactory:1',
  defaultEnv: {},
  ports: [
    {
      containerPort: 7_777,
      protocol: 'both',
      primary: true,
      label: 'Spiel-Port',
    },
  ],
  // Kein einziges Feld: Alles, was es einzustellen gibt, steht im Spiel.
  configFields: [],
  envMapping: {},
  restartRequiredFields: [],
  /*
   * Satisfactory rechnet die ganze Fabrik durch – Bänder, Maschinen, Züge.
   * 8 GiB und vier Kerne tragen eine mittlere Fabrik mit einer Handvoll
   * Spielern; die Serverdateien allein wiegen über zehn Gigabyte.
   */
  resourceDefaults: {
    ramMb: 8_192,
    cpuCores: 4,
    diskMb: 25_600,
  },
  query: {
    kind: 'gamedig',
    protocol: 'satisfactory',
    containerPort: 7_777,
  },
  /*
   * Keine Konsole: Der Server nimmt weder über die Standardeingabe noch über
   * RCON Befehle entgegen – verwaltet wird er über den Server-Manager im Spiel.
   */
  console: { kind: 'none' },
  iconUrl: null,
  coverImageUrl: null,
  supportsVirtualHostRouting: false,
  supportsWorldImport: true,
  dataVolumeContainerPath: '/data',
  readOnlyRootFilesystem: true,
  tmpfsPaths: ['/tmp'],
  stopTimeoutSeconds: 120,
  startupTimeoutSeconds: 1_800,
  phase: 3,
};

/**
 * 7 Days to Die (Anhang A, Phase 3).
 *
 * **Auch hier trägt der Spiel-Port beide Protokolle**, dazu kommen zwei
 * UDP-Ports daneben. Die Abfrage läuft auf dem ersten davon: `gamedig` rechnet
 * für dieses Spiel einen Versatz von +1 auf den Spiel-Port – hinter frp trägt
 * jeder Container-Port aber eine eigene öffentliche Nummer, deshalb nennt
 * `query.containerPort` den Abfrage-Port ausdrücklich (Fundpunkt 246).
 *
 * **Keine Konsole.** Die Verwaltung läuft bei diesem Server über Telnet, und
 * das spricht der Agent nicht; eingeschaltet wäre es ein zweiter Weg hinein,
 * den niemand abgesichert hat. Das Startskript lässt es deshalb aus.
 */
export const SDTD_GAME_TYPE: GameTypeDefinition = {
  id: 'seven-days-to-die',
  name: '7 Days to Die',
  description:
    '7-Days-to-Die-Server. Die Serverdateien holt SteamCMD beim ersten Start; eine selbst erzeugte Welt braucht danach einige Minuten. Die Konsole des Spiels läuft über Telnet und bleibt deshalb aus.',
  dockerImage: 'ghcr.io/nightriderp/palantir-game-sdtd:1',
  defaultEnv: {},
  ports: [
    {
      containerPort: 26_900,
      protocol: 'both',
      primary: true,
      label: 'Spiel-Port',
    },
    {
      containerPort: 26_901,
      protocol: 'udp',
      primary: false,
      label: 'Abfrage-Port',
    },
    {
      containerPort: 26_902,
      protocol: 'udp',
      primary: false,
      label: 'Spiel-Port 2',
    },
  ],
  configFields: [
    {
      key: 'serverName',
      label: 'Servername',
      type: 'text',
      defaultValue: 'Ein Palantir-Server',
      description: null,
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'motd',
      label: 'Beschreibung',
      type: 'text',
      defaultValue: '',
      description: 'Steht in der Serverliste unter dem Namen.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'password',
      label: 'Passwort',
      type: 'password',
      defaultValue: '',
      description: 'Leer lassen, wenn jeder mit der Adresse beitreten darf.',
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
      defaultValue: 8,
      description: null,
      required: false,
      options: [],
      min: 1,
      max: 64,
      lockedAfterCreate: false,
    },
    {
      key: 'world',
      label: 'Welt',
      type: 'select',
      defaultValue: 'Navezgane',
      description:
        'Navezgane ist die Karte des Spiels; „RWG" erzeugt eine eigene aus dem Startwert. Gilt nur beim Erzeugen.',
      required: false,
      options: ['Navezgane', 'RWG'],
      min: null,
      max: null,
      lockedAfterCreate: true,
    },
    {
      key: 'seed',
      label: 'Startwert (Seed)',
      type: 'text',
      defaultValue: 'palantir',
      description: 'Nur für „RWG": Derselbe Startwert erzeugt dieselbe Karte.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: true,
    },
    {
      key: 'worldSize',
      label: 'Kantenlänge der Karte',
      type: 'number',
      defaultValue: 6144,
      description: 'Nur für „RWG". Größer heißt mehr Platz und eine längere Erzeugung.',
      required: false,
      options: [],
      min: 2048,
      max: 16_384,
      lockedAfterCreate: true,
    },
    {
      key: 'gameName',
      label: 'Name des Spielstands',
      type: 'text',
      defaultValue: 'Palantir',
      description: 'Legt den Ordner des Spielstands fest. Ein neuer Name fängt von vorn an.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: true,
    },
    {
      key: 'difficulty',
      label: 'Schwierigkeit',
      type: 'select',
      defaultValue: '2',
      description: '0 ist am leichtesten, 5 am schwersten.',
      required: false,
      options: ['0', '1', '2', '3', '4', '5'],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'dayLengthMinutes',
      label: 'Länge eines Tages (Minuten)',
      type: 'number',
      defaultValue: 60,
      description: null,
      required: false,
      options: [],
      min: 10,
      max: 240,
      lockedAfterCreate: false,
    },
    {
      key: 'public',
      label: 'In der Serverliste zeigen',
      type: 'toggle',
      defaultValue: true,
      description: 'Aus heißt: nur wer die Adresse kennt, findet den Server.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
  ],
  envMapping: {
    serverName: 'SDTD_NAME',
    motd: 'MOTD',
    password: 'SDTD_PASSWORD',
    maxPlayers: 'MAX_PLAYERS',
    world: 'SDTD_WORLD',
    seed: 'SDTD_SEED',
    worldSize: 'SDTD_WORLD_SIZE',
    gameName: 'SDTD_GAME_NAME',
    difficulty: 'SDTD_DIFFICULTY',
    dayLengthMinutes: 'SDTD_DAY_LENGTH',
    public: 'SDTD_PUBLIC',
  },
  restartRequiredFields: [
    'serverName',
    'motd',
    'password',
    'maxPlayers',
    'world',
    'seed',
    'worldSize',
    'gameName',
    'difficulty',
    'dayLengthMinutes',
    'public',
  ],
  /*
   * Eine selbst erzeugte Karte von 6144 hält der Server samt Horde im
   * Speicher. 8 GiB und vier Kerne sind die untere Grenze.
   */
  resourceDefaults: {
    ramMb: 8_192,
    cpuCores: 4,
    diskMb: 25_600,
  },
  query: {
    kind: 'gamedig',
    protocol: 'sdtd',
    // Nicht 26900: `gamedig` rechnet für dieses Spiel +1, und hinter frp trägt
    // jeder Container-Port eine eigene öffentliche Nummer (Fundpunkt 246).
    containerPort: 26_901,
  },
  console: { kind: 'none' },
  iconUrl: null,
  coverImageUrl: null,
  supportsVirtualHostRouting: false,
  supportsWorldImport: true,
  dataVolumeContainerPath: '/data',
  readOnlyRootFilesystem: true,
  tmpfsPaths: ['/tmp'],
  stopTimeoutSeconds: 120,
  startupTimeoutSeconds: 1_800,
  phase: 3,
};

/**
 * Enshrouded – das erste Spiel unter Proton (Anhang A, Phase 3).
 *
 * **Es gibt nur einen Windows-Server.** Das gilt für die halbe Liste aus
 * Anhang A: V Rising, Sons of the Forest, ARK: Survival Ascended. Sie laufen
 * unter Proton – der Wine-Abwandlung, die Valve für Steam pflegt und gegen die
 * diese Spiele auch geprüft werden (`images/base/proton`).
 *
 * **Der erste Start dauert deutlich länger als sonst**: SteamCMD holt die
 * Windows-Dateien, und Proton legt danach einen Wine-Prefix an – ein ganzes
 * Windows-Dateisystem in Miniatur. Beides passiert genau einmal.
 *
 * **Keine Konsole**: Enshrouded nimmt weder über die Standardeingabe noch über
 * RCON Befehle entgegen.
 */
export const ENSHROUDED_GAME_TYPE: GameTypeDefinition = {
  id: 'enshrouded',
  name: 'Enshrouded',
  description:
    'Enshrouded-Server unter Proton – es gibt nur eine Windows-Fassung. Der erste Start holt die Serverdateien und richtet die Windows-Umgebung ein; das dauert.',
  dockerImage: 'ghcr.io/nightriderp/palantir-game-enshrouded:1',
  defaultEnv: {},
  ports: [
    {
      containerPort: 15_636,
      protocol: 'udp',
      primary: true,
      label: 'Spiel-Port',
    },
    {
      containerPort: 15_637,
      protocol: 'udp',
      primary: false,
      label: 'Abfrage-Port',
    },
  ],
  configFields: [
    {
      key: 'serverName',
      label: 'Servername',
      type: 'text',
      defaultValue: 'Ein Palantir-Server',
      description: null,
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
      defaultValue: 16,
      description: 'Enshrouded selbst lässt höchstens 16 zu.',
      required: false,
      options: [],
      min: 1,
      max: 16,
      lockedAfterCreate: false,
    },
    {
      key: 'adminPassword',
      label: 'Passwort für Verwalter',
      type: 'password',
      defaultValue: '',
      description: 'Wer sich damit verbindet, darf alles – auch hinauswerfen und sperren.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'password',
      label: 'Passwort für Mitspieler',
      type: 'password',
      defaultValue: '',
      description: 'Darf bauen und an Truhen, aber niemanden hinauswerfen.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'guestPassword',
      label: 'Passwort für Gäste',
      type: 'password',
      defaultValue: '',
      description: 'Darf zusehen und mitspielen, aber nichts am Bau ändern.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
  ],
  envMapping: {
    serverName: 'ENSHROUDED_NAME',
    maxPlayers: 'MAX_PLAYERS',
    adminPassword: 'ENSHROUDED_ADMIN_PASSWORD',
    password: 'ENSHROUDED_PASSWORD',
    guestPassword: 'ENSHROUDED_GUEST_PASSWORD',
  },
  restartRequiredFields: ['serverName', 'maxPlayers', 'adminPassword', 'password', 'guestPassword'],
  /*
   * Keen Games nennt 16 GiB für volle 16 Spieler. 8 GiB tragen eine kleine
   * Runde; dazu kommt, dass unter Proton eine zweite Umgebung mitläuft.
   */
  resourceDefaults: {
    ramMb: 8_192,
    cpuCores: 4,
    diskMb: 20_480,
  },
  query: {
    kind: 'gamedig',
    protocol: 'enshrouded',
    // Nicht der Spiel-Port: Enshrouded antwortet auf der Serverliste daneben.
    containerPort: 15_637,
  },
  console: { kind: 'none' },
  iconUrl: null,
  coverImageUrl: null,
  supportsVirtualHostRouting: false,
  supportsWorldImport: true,
  dataVolumeContainerPath: '/data',
  readOnlyRootFilesystem: true,
  tmpfsPaths: ['/tmp'],
  stopTimeoutSeconds: 120,
  // Windows-Dateien holen **und** den Wine-Prefix anlegen.
  startupTimeoutSeconds: 1_800,
  phase: 3,
};

/**
 * V Rising – zweites Spiel unter Proton (Anhang A, Phase 3).
 *
 * **Das erste Windows-Spiel mit einer echten Konsole.** V Rising spricht das
 * Source-RCON-Protokoll; das Image schaltet es ein und legt bei jedem Start ein
 * neues Passwort in den Datenordner. Veröffentlicht wird der RCON-Port nicht.
 *
 * **Die Abfrage hängt an der Sichtbarkeit** (`requiresConfigFlag`), wie bei
 * Valheim: Ein Server, der sich nicht beim Steam-Verzeichnis anmeldet,
 * beantwortet keine A2S-Abfrage. Erreichbar bleibt er – wer die Adresse hat,
 * spielt.
 *
 * **Der Name des Spielstands ist nach dem Anlegen gesperrt.** Er ist der Name
 * des Ordners unter `Saves/`; eine Änderung ließe den Server eine neue Welt
 * beginnen und die alte liegen.
 */
export const VRISING_GAME_TYPE: GameTypeDefinition = {
  id: 'vrising',
  name: 'V Rising',
  description:
    'V-Rising-Server unter Proton – es gibt nur eine Windows-Fassung. Der erste Start holt die Serverdateien und richtet die Windows-Umgebung ein; das dauert.',
  dockerImage: 'ghcr.io/nightriderp/palantir-game-vrising:1',
  defaultEnv: {},
  ports: [
    {
      containerPort: 9_876,
      protocol: 'udp',
      primary: true,
      label: 'Spiel-Port',
    },
    {
      containerPort: 9_877,
      protocol: 'udp',
      primary: false,
      label: 'Abfrage-Port',
    },
  ],
  configFields: [
    {
      key: 'serverName',
      label: 'Servername',
      type: 'text',
      defaultValue: 'Ein Palantir-Server',
      description: null,
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'description',
      label: 'Beschreibung',
      type: 'text',
      defaultValue: '',
      description: 'Steht in den Einzelheiten der Serverliste und im Chat beim Verbinden.',
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
      defaultValue: 40,
      description: 'Mehr als 128 nimmt der Server nicht an.',
      required: false,
      options: [],
      min: 1,
      max: 128,
      lockedAfterCreate: false,
    },
    {
      key: 'password',
      label: 'Server-Passwort',
      type: 'password',
      defaultValue: '',
      description: 'Leer lassen heißt: jeder mit der Adresse kommt herein.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'difficulty',
      label: 'Schwierigkeit',
      type: 'select',
      defaultValue: 'Difficulty_Normal',
      description: null,
      required: false,
      options: ['Difficulty_Easy', 'Difficulty_Normal', 'Difficulty_Brutal'],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'saveName',
      label: 'Name des Spielstands',
      type: 'text',
      defaultValue: 'welt',
      description:
        'Der Ordner unter „Saves". Nach dem Anlegen fest – ein neuer Name wäre eine neue Welt.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: true,
    },
    {
      key: 'public',
      label: 'In der Serverliste zeigen',
      type: 'toggle',
      // Wie bei Valheim: Ohne diesen Schalter beantwortet der Server keine
      // Abfrage, und das Panel sieht weder Spielerzahl noch Ping (`query`
      // unten). Wer ihn ausschaltet, soll das entscheiden.
      defaultValue: true,
      description: 'Aus heißt: erreichbar, aber weder in der Liste noch mit Spielerzahl im Panel.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
  ],
  envMapping: {
    serverName: 'VRISING_NAME',
    description: 'VRISING_DESCRIPTION',
    maxPlayers: 'MAX_PLAYERS',
    password: 'VRISING_PASSWORD',
    difficulty: 'VRISING_DIFFICULTY',
    saveName: 'VRISING_SAVE_NAME',
    public: 'VRISING_PUBLIC',
  },
  restartRequiredFields: [
    'serverName',
    'description',
    'maxPlayers',
    'password',
    'difficulty',
    'saveName',
    'public',
  ],
  /*
   * Stunlock nennt 8 GiB für eine volle Runde. Dazu kommt, dass unter Proton
   * eine zweite Umgebung mitläuft; die Serverdateien selbst sind klein.
   */
  resourceDefaults: {
    ramMb: 6_144,
    cpuCores: 3,
    diskMb: 15_360,
  },
  query: {
    kind: 'gamedig',
    protocol: 'vrising',
    // Nicht der Spiel-Port: V Rising antwortet auf der Serverliste daneben.
    containerPort: 9_877,
    requiresConfigFlag: 'public',
  },
  console: {
    kind: 'rcon',
    port: 25_575,
    passwordFile: '.palantir/rcon.password',
  },
  iconUrl: null,
  coverImageUrl: null,
  supportsVirtualHostRouting: false,
  supportsWorldImport: true,
  dataVolumeContainerPath: '/data',
  readOnlyRootFilesystem: true,
  tmpfsPaths: ['/tmp'],
  stopTimeoutSeconds: 120,
  // Windows-Dateien holen **und** den Wine-Prefix anlegen.
  startupTimeoutSeconds: 1_800,
  phase: 3,
};

/**
 * Sons of the Forest – drittes Spiel unter Proton (Anhang A, Phase 3).
 *
 * **Drei Ports statt zwei.** Neben Spiel und Abfrage gibt es einen dritten, der
 * beim Beitreten die Weltdaten abgleicht. Fehlt er, verbindet sich der Spieler,
 * der Server meldet nichts – und der Ladebildschirm bleibt stehen.
 *
 * **Keine Konsole:** weder Standardeingabe noch RCON. Das Panel zeigt die
 * Ausgabe mit ausgegrautem Eingabefeld.
 */
export const SONS_OF_THE_FOREST_GAME_TYPE: GameTypeDefinition = {
  id: 'sonsoftheforest',
  name: 'Sons of the Forest',
  description:
    'Sons-of-the-Forest-Server unter Proton – es gibt nur eine Windows-Fassung. Der erste Start holt die Serverdateien und richtet die Windows-Umgebung ein; das dauert.',
  dockerImage: 'ghcr.io/nightriderp/palantir-game-sonsoftheforest:1',
  defaultEnv: {},
  ports: [
    {
      containerPort: 8_766,
      protocol: 'udp',
      primary: true,
      label: 'Spiel-Port',
    },
    {
      containerPort: 27_016,
      protocol: 'udp',
      primary: false,
      label: 'Abfrage-Port',
    },
    {
      containerPort: 9_700,
      protocol: 'udp',
      primary: false,
      label: 'Abgleich der Weltdaten',
    },
  ],
  configFields: [
    {
      key: 'serverName',
      label: 'Servername',
      type: 'text',
      defaultValue: 'Ein Palantir-Server',
      description: null,
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
      defaultValue: 8,
      description: 'Sons of the Forest selbst lässt höchstens 8 zu.',
      required: false,
      options: [],
      min: 1,
      max: 8,
      lockedAfterCreate: false,
    },
    {
      key: 'password',
      label: 'Server-Passwort',
      type: 'password',
      defaultValue: '',
      description: 'Leer lassen heißt: jeder mit der Adresse kommt herein.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'gameMode',
      label: 'Spielart',
      type: 'select',
      defaultValue: 'Normal',
      description: null,
      required: false,
      options: ['Peaceful', 'Normal', 'Hard', 'HardSurvival'],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'saveSlot',
      label: 'Speicherplatz',
      type: 'number',
      defaultValue: 1,
      description:
        'Welcher der Spielstände fortgesetzt wird. Nach dem Anlegen fest – ein anderer Platz wäre eine andere Welt.',
      required: false,
      options: [],
      min: 1,
      max: 5,
      lockedAfterCreate: true,
    },
    {
      key: 'saveIntervalSeconds',
      label: 'Selbsttätig speichern (Sekunden)',
      type: 'number',
      defaultValue: 600,
      description: null,
      required: false,
      options: [],
      min: 60,
      max: 3_600,
      lockedAfterCreate: false,
    },
  ],
  envMapping: {
    serverName: 'SOTF_NAME',
    maxPlayers: 'MAX_PLAYERS',
    password: 'SOTF_PASSWORD',
    gameMode: 'SOTF_GAME_MODE',
    saveSlot: 'SOTF_SAVE_SLOT',
    saveIntervalSeconds: 'SOTF_SAVE_INTERVAL',
  },
  restartRequiredFields: [
    'serverName',
    'maxPlayers',
    'password',
    'gameMode',
    'saveSlot',
    'saveIntervalSeconds',
  ],
  /*
   * Endnight nennt 8 GiB für acht Spieler; die Serverdateien wiegen um die
   * fünfzehn Gigabyte, und unter Proton läuft eine zweite Umgebung mit.
   */
  resourceDefaults: {
    ramMb: 8_192,
    cpuCores: 4,
    diskMb: 30_720,
  },
  query: {
    kind: 'gamedig',
    protocol: 'sotf',
    // Nicht der Spiel-Port: Sons of the Forest antwortet auf der Serverliste
    // daneben.
    containerPort: 27_016,
  },
  console: { kind: 'none' },
  iconUrl: null,
  coverImageUrl: null,
  supportsVirtualHostRouting: false,
  supportsWorldImport: true,
  dataVolumeContainerPath: '/data',
  readOnlyRootFilesystem: true,
  tmpfsPaths: ['/tmp'],
  stopTimeoutSeconds: 120,
  // Windows-Dateien holen **und** den Wine-Prefix anlegen.
  startupTimeoutSeconds: 1_800,
  phase: 3,
};

/**
 * Vintage Story – das erste Spiel ohne Steam und ohne Java (Anhang A, Phase 3).
 *
 * **Keine Abfrage, und das ist kein Versehen.** `gamedig` kennt ein Protokoll
 * für Vintage Story, aber es fragt nicht den Server: Es lädt das Verzeichnis
 * des Herstellers und sucht darin den Eintrag zur öffentlichen Adresse. Hinter
 * dem Rückwärtstunnel steht dort die Adresse der VPS, gefragt wird nach der des
 * Containers – der Eintrag wird nie gefunden. Ein Server, der sich gar nicht
 * anmeldet, steht ohnehin in keinem Verzeichnis.
 *
 * **Ein Port, TCP.** Anders als bei den Steam-Spielen gibt es keinen zweiten
 * für die Abfrage.
 */
export const VINTAGE_STORY_GAME_TYPE: GameTypeDefinition = {
  id: 'vintagestory',
  name: 'Vintage Story',
  description:
    'Vintage-Story-Server. Die Serverdateien holt der erste Start beim Hersteller und prüft sie gegen eine feste Prüfsumme; Steam ist nicht beteiligt.',
  dockerImage: 'ghcr.io/nightriderp/palantir-game-vintagestory:1',
  consoleQuickCommands: [
    { label: 'Spieler', command: '/list clients' },
    { label: 'Speichern', command: '/autosavenow' },
    { label: 'Stoppen', command: '/stop' },
  ],
  defaultEnv: {},
  ports: [
    {
      containerPort: 42_420,
      protocol: 'tcp',
      primary: true,
      label: 'Spiel-Port',
    },
  ],
  configFields: [
    {
      key: 'serverName',
      label: 'Servername',
      type: 'text',
      defaultValue: 'Ein Palantir-Server',
      description: null,
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'description',
      label: 'Beschreibung',
      type: 'text',
      defaultValue: '',
      description: 'Steht im Verzeichnis und in den Einzelheiten des Servers.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'welcomeMessage',
      label: 'Begrüßung',
      type: 'text',
      defaultValue: '',
      description: 'Was ein Spieler beim Betreten im Chat liest.',
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
      defaultValue: 16,
      description: null,
      required: false,
      options: [],
      min: 1,
      max: 128,
      lockedAfterCreate: false,
    },
    {
      key: 'password',
      label: 'Server-Passwort',
      type: 'password',
      defaultValue: '',
      description: 'Leer lassen heißt: jeder mit der Adresse kommt herein.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'public',
      label: 'Im Verzeichnis des Herstellers zeigen',
      type: 'toggle',
      /*
       * Vorgabe „aus", anders als bei den Steam-Spielen: Dort hängt die Abfrage
       * daran, und ein privater Server ließe das Panel ohne Spielerzahl
       * zurück. Vintage Story wird ohnehin nicht abgefragt – hier kostet die
       * zurückhaltende Vorgabe nichts, und ein Server, der ohne Zutun des
       * Betreibers in einem fremden Verzeichnis steht, ist eine Überraschung.
       */
      defaultValue: false,
      description: 'Aus heißt: erreichbar, aber nur für den, der die Adresse hat.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
  ],
  envMapping: {
    serverName: 'VS_NAME',
    description: 'VS_DESCRIPTION',
    welcomeMessage: 'VS_WELCOME',
    maxPlayers: 'MAX_PLAYERS',
    password: 'VS_PASSWORD',
    public: 'VS_PUBLIC',
  },
  restartRequiredFields: [
    'serverName',
    'description',
    'welcomeMessage',
    'maxPlayers',
    'password',
    'public',
  ],
  /*
   * Vintage Story ist genügsam: Der Hersteller nennt 2 GiB für eine kleine
   * Runde. Vier geben Luft für die Welt, die mit der Zeit wächst; die
   * Serverdateien wiegen keine zweihundert Megabyte.
   */
  resourceDefaults: {
    ramMb: 4_096,
    cpuCores: 2,
    diskMb: 10_240,
  },
  query: {
    kind: 'none',
    containerPort: 42_420,
  },
  console: { kind: 'stdin' },
  iconUrl: null,
  coverImageUrl: null,
  supportsVirtualHostRouting: false,
  supportsWorldImport: true,
  dataVolumeContainerPath: '/data',
  readOnlyRootFilesystem: true,
  tmpfsPaths: ['/tmp'],
  stopTimeoutSeconds: 120,
  // Fünfzig Megabyte holen und auspacken, danach die Welt erzeugen.
  startupTimeoutSeconds: 600,
  phase: 3,
};

/**
 * Abiotic Factor – viertes Spiel unter Proton (Anhang A, Phase 3).
 *
 * **Ohne Konfigurationsdatei:** Alles, was das Panel setzt, steht auf der
 * Befehlszeile. Die `Game.ini` im Serverordner bleibt dem Betreiber – ein
 * Startskript, das sie schriebe, räumte weg, was er dort eingestellt hat.
 *
 * **Der Name des Spielstands ist nach dem Anlegen gesperrt.** Er benennt den
 * Ordner unter `Saved/SaveGames`; ein anderer Name begänne eine neue Welt.
 */
export const ABIOTIC_FACTOR_GAME_TYPE: GameTypeDefinition = {
  id: 'abioticfactor',
  name: 'Abiotic Factor',
  description:
    'Abiotic-Factor-Server unter Proton – es gibt nur eine Windows-Fassung. Der erste Start holt die Serverdateien und richtet die Windows-Umgebung ein; das dauert.',
  dockerImage: 'ghcr.io/nightriderp/palantir-game-abioticfactor:1',
  defaultEnv: {},
  ports: [
    {
      containerPort: 7_777,
      protocol: 'udp',
      primary: true,
      label: 'Spiel-Port',
    },
    {
      containerPort: 27_015,
      protocol: 'udp',
      primary: false,
      label: 'Abfrage-Port',
    },
  ],
  configFields: [
    {
      key: 'serverName',
      label: 'Servername',
      type: 'text',
      defaultValue: 'Ein Palantir-Server',
      description: null,
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
      defaultValue: 6,
      description: 'Das Spiel ist auf sechs ausgelegt; mehr geht, ist aber nicht erprobt.',
      required: false,
      options: [],
      min: 1,
      max: 16,
      lockedAfterCreate: false,
    },
    {
      key: 'password',
      label: 'Server-Passwort',
      type: 'password',
      defaultValue: '',
      description: 'Leer lassen heißt: jeder mit der Adresse kommt herein.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'worldName',
      label: 'Name der Welt',
      type: 'text',
      defaultValue: 'Cascade',
      description:
        'Der Ordner unter „SaveGames". Nach dem Anlegen fest – ein neuer Name wäre eine neue Welt.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: true,
    },
  ],
  envMapping: {
    serverName: 'ABIOTIC_NAME',
    maxPlayers: 'MAX_PLAYERS',
    password: 'ABIOTIC_PASSWORD',
    worldName: 'ABIOTIC_WORLD',
  },
  restartRequiredFields: ['serverName', 'maxPlayers', 'password', 'worldName'],
  /*
   * Ein Unreal-Server für sechs Spieler; der Hersteller nennt 4 GiB. Sechs
   * geben Luft, und unter Proton läuft eine zweite Umgebung mit.
   */
  resourceDefaults: {
    ramMb: 6_144,
    cpuCores: 3,
    diskMb: 20_480,
  },
  query: {
    kind: 'gamedig',
    protocol: 'abioticfactor',
    // Nicht der Spiel-Port: Abiotic Factor antwortet auf der Serverliste
    // daneben.
    containerPort: 27_015,
  },
  console: { kind: 'none' },
  iconUrl: null,
  coverImageUrl: null,
  supportsVirtualHostRouting: false,
  supportsWorldImport: true,
  dataVolumeContainerPath: '/data',
  readOnlyRootFilesystem: true,
  tmpfsPaths: ['/tmp'],
  stopTimeoutSeconds: 120,
  // Windows-Dateien holen **und** den Wine-Prefix anlegen.
  startupTimeoutSeconds: 1_800,
  phase: 3,
};

/**
 * ARK: Survival Ascended – das größte Spiel dieser Liste (Anhang A, Phase 3).
 *
 * **Es läuft auf einer eigenen Proton-Fassung.** GE-Proton 11 bleibt beim Start
 * dieses Servers hängen; das Image steht deshalb auf `base/proton10`
 * (GE-Proton10-34). Entscheidung des Betreibers vom 2026-09-11 – die Alternative
 * wäre gewesen, ARK draußen zu lassen.
 *
 * **Das Verwalter-Passwort ist zugleich das RCON-Passwort.** ARK kennt dafür
 * kein eigenes Feld: Wer RCON spricht, ist Verwalter. Bleibt das Feld leer,
 * erzeugt das Image ein zufälliges – dann hat das Panel seine Konsole, und im
 * Spiel wird niemand Verwalter.
 *
 * **Die Karte ist nach dem Anlegen gesperrt.** Jede Karte hat ihren eigenen
 * Spielstand; ein Wechsel ließe den bisherigen liegen und begänne von vorn.
 */
export const ARK_ASCENDED_GAME_TYPE: GameTypeDefinition = {
  id: 'arkascended',
  name: 'ARK: Survival Ascended',
  description:
    'ARK-Server unter Proton – es gibt nur eine Windows-Fassung. Der erste Start holt zweistellig viele Gigabyte und richtet die Windows-Umgebung ein; das dauert eine Weile.',
  dockerImage: 'ghcr.io/nightriderp/palantir-game-arkascended:1',
  consoleQuickCommands: [
    { label: 'Spieler', command: 'ListPlayers' },
    { label: 'Speichern', command: 'SaveWorld' },
    { label: 'Stoppen', command: 'DoExit' },
  ],
  defaultEnv: {},
  ports: [
    {
      containerPort: 7_777,
      protocol: 'udp',
      primary: true,
      label: 'Spiel-Port',
    },
    {
      containerPort: 27_015,
      protocol: 'udp',
      primary: false,
      label: 'Abfrage-Port',
    },
  ],
  configFields: [
    {
      key: 'serverName',
      label: 'Servername',
      type: 'text',
      defaultValue: 'Ein Palantir-Server',
      description: 'Ein Fragezeichen darin wird entfernt – ARK trennt seine Einstellungen damit.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'map',
      label: 'Karte',
      type: 'select',
      defaultValue: 'TheIsland_WP',
      description: 'Nach dem Anlegen fest – jede Karte hat ihren eigenen Spielstand.',
      required: false,
      options: [
        'TheIsland_WP',
        'TheCenter_WP',
        'ScorchedEarth_WP',
        'Aberration_WP',
        'Extinction_WP',
        'Ragnarok_WP',
        'Astraeos_WP',
        'LostColony_WP',
      ],
      min: null,
      max: null,
      lockedAfterCreate: true,
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
      max: 127,
      lockedAfterCreate: false,
    },
    {
      key: 'password',
      label: 'Server-Passwort',
      type: 'password',
      defaultValue: '',
      description: 'Leer lassen heißt: jeder mit der Adresse kommt herein.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'adminPassword',
      label: 'Passwort für Verwalter',
      type: 'password',
      defaultValue: '',
      description:
        'Gilt im Spiel für „enablecheats" und zugleich für die Konsole des Panels. Leer lassen heißt: Das Panel bekommt seine Konsole, im Spiel wird niemand Verwalter.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'autoSaveMinutes',
      label: 'Selbsttätig speichern (Minuten)',
      type: 'number',
      /*
       * Niedriger als ARKs eigene Vorgabe, und das aus einem Grund: ARK
       * speichert beim Stoppsignal **nicht**, und der Befehl dafür ginge über
       * RCON – einen RCON-Sprecher hat das Image nicht. Was seit dem letzten
       * Speichern geschehen ist, ist nach einem Stopp fort.
       */
      defaultValue: 10,
      description: 'ARK speichert beim Stoppen nicht – was danach kommt, ist die Rettung.',
      required: false,
      options: [],
      min: 1,
      max: 60,
      lockedAfterCreate: false,
    },
    {
      key: 'crossplay',
      label: 'Spieler aus dem Microsoft Store zulassen',
      type: 'toggle',
      defaultValue: false,
      description: null,
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'battlEye',
      label: 'BattlEye einschalten',
      type: 'toggle',
      // Vorgabe aus: Unter Proton ist der Dienst eine zusätzliche Fehlerquelle,
      // und ein Server, der daran nicht startet, sieht aus wie einer, der gar
      // nicht startet.
      defaultValue: false,
      description: 'Unter Proton nicht erprobt – ein Server, der daran scheitert, sagt es nicht.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'mods',
      label: 'Mods (Kennungen, mit Komma getrennt)',
      type: 'text',
      defaultValue: '',
      description: 'Der Server holt sie selbst von CurseForge.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
  ],
  envMapping: {
    serverName: 'ARK_NAME',
    map: 'ARK_MAP',
    maxPlayers: 'MAX_PLAYERS',
    password: 'ARK_PASSWORD',
    adminPassword: 'ARK_ADMIN_PASSWORD',
    autoSaveMinutes: 'ARK_AUTOSAVE',
    crossplay: 'ARK_CROSSPLAY',
    battlEye: 'ARK_BATTLEYE',
    mods: 'ARK_MODS',
  },
  restartRequiredFields: [
    'serverName',
    'map',
    'maxPlayers',
    'password',
    'adminPassword',
    'autoSaveMinutes',
    'crossplay',
    'battlEye',
    'mods',
  ],
  /*
   * Der anspruchsvollste Server dieser Liste – anspruchsvoller noch als Rust.
   * Studio Wildcard nennt 16 GiB; die Serverdateien allein wiegen um die
   * fünfzig Gigabyte, und unter Proton läuft eine zweite Umgebung mit.
   */
  resourceDefaults: {
    ramMb: 16_384,
    cpuCores: 6,
    diskMb: 81_920,
  },
  /*
   * **Keine Abfrage, und das ist kein Versehen.** ARK: Survival Ascended
   * beantwortet keine A2S-Abfrage mehr; es meldet sich beim Verzeichnis von
   * Epic an, und genau dort fragt `gamedig` nach — nach `ADDRESS_s` gleich der
   * abgefragten Adresse. Hinter dem Rückwärtstunnel steht bei Epic die Adresse
   * der VPS, gefragt wird nach der des Containers: Der Eintrag wird nie
   * gefunden. Dieselbe Klasse wie bei Vintage Story.
   *
   * Der Preis ist derselbe wie bei Palworld: keine Spielerzahl, kein Ping, kein
   * selbsttätiges Abschalten bei null Spielern. Der Start gilt als geglückt,
   * sobald der Container läuft.
   */
  query: {
    kind: 'none',
    containerPort: 7_777,
  },
  console: {
    kind: 'rcon',
    port: 27_020,
    passwordFile: '.palantir/rcon.password',
  },
  iconUrl: null,
  coverImageUrl: null,
  supportsVirtualHostRouting: false,
  supportsWorldImport: true,
  dataVolumeContainerPath: '/data',
  readOnlyRootFilesystem: true,
  tmpfsPaths: ['/tmp'],
  /*
   * ARK speichert beim Stoppsignal nicht – `DoExit` tut es. Bis zur
   * Umsetzung des Stopp-Befehls stand hier nur die Empfehlung, vorher von
   * Hand `SaveWorld` zu schicken; jetzt nimmt der Agent es ab.
   */
  stopCommand: 'DoExit',
  stopTimeoutSeconds: 180,
  /*
   * Eine ganze Stunde, und das ist keine Vorsicht: Der erste Start holt
   * zweistellig viele Gigabyte über SteamCMD und legt danach den Wine-Prefix
   * an. Auf einer gewöhnlichen Hausleitung ist das der Löwenanteil.
   */
  startupTimeoutSeconds: 3_600,
  phase: 3,
};

/**
 * Assetto Corsa Competizione – der erste Spieltyp, dessen Serverdateien der
 * Betreiber selbst mitbringt (Anhang A, Phase 3).
 *
 * **Warum:** Kunos gibt den dedizierten Server nur an ein Steam-Konto heraus,
 * das ACC besitzt (Werkzeug 1430110 am Elternspiel 805550); anonym geht er
 * nicht. Fremde Zugangsdaten gehören nicht in dieses Panel (Entscheidung des
 * Betreibers) – und sie sind hier auch nicht nötig: Der Server wiegt keine
 * hundert Megabyte und liegt in jeder ACC-Installation. Über den Datei-Manager
 * landet er in `/data/server`; das Image sagt im Log, was zu tun ist, solange er
 * fehlt.
 *
 * **Beide Ports tragen drinnen die öffentliche Nummer**
 * (`usesPublicPortNumber`). ACC meldet dem Lobby-Dienst die Nummern aus seiner
 * eigenen Konfiguration; eine Übersetzung davor zeigte auf einen Port, den es
 * nicht gibt.
 *
 * **Keine Abfrage:** `gamedig` kennt kein ACC-Protokoll, und der Server
 * beantwortet auch keins.
 */
export const ACC_GAME_TYPE: GameTypeDefinition = {
  id: 'acc',
  name: 'Assetto Corsa Competizione',
  description:
    'ACC-Server unter Proton. Die Serverdateien bringst du selbst mit – lade den Ordner „Assetto Corsa Competizione Dedicated Server" aus deiner Steam-Installation über den Datei-Manager nach „server".',
  dockerImage: 'ghcr.io/nightriderp/palantir-game-acc:4',
  defaultEnv: {},
  ports: [
    {
      containerPort: 9_231,
      protocol: 'udp',
      primary: true,
      label: 'Spiel-Port (Fahrzeugpositionen)',
      usesPublicPortNumber: true,
      envVar: 'ACC_UDP_PORT',
    },
    {
      containerPort: 9_232,
      protocol: 'tcp',
      primary: false,
      label: 'Verbindungsaufbau',
      usesPublicPortNumber: true,
      envVar: 'ACC_TCP_PORT',
    },
  ],
  configFields: [
    {
      key: 'serverName',
      label: 'Servername',
      type: 'text',
      defaultValue: 'Ein Palantir-Server',
      description: null,
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'steamAccount',
      label: 'Steam-Benutzername',
      type: 'text',
      defaultValue: '',
      description:
        'Das Konto, das ACC besitzt – anonym gibt Valve den Server nicht heraus. Leer lassen, wenn du die Serverdateien selbst über den Datei-Manager hochlädst. Ein Passwort wird hier nie verlangt: Die Anmeldung passiert einmalig auf der Node.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'filesUrl',
      label: 'Adresse des Server-Archivs',
      type: 'text',
      defaultValue: '',
      description:
        'Der Weg ohne Steam: Lege den Serverordner als ZIP an eine Adresse, die die Node erreicht, und trage sie hier ein. Geholt wird nur, wenn die Serverdateien fehlen.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'filesSha256',
      label: 'Prüfsumme des Archivs (SHA-256)',
      type: 'text',
      defaultValue: '',
      description:
        'Bedingung, wenn eine Adresse gesetzt ist: „sha256sum acc-server.zip" dort, wo das Archiv liegt. Was hier ankommt, wird ausgeführt.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'track',
      label: 'Strecke',
      type: 'select',
      defaultValue: 'monza',
      description: 'Weitere Strecken gehen über eine eigene event.json im Datei-Manager.',
      required: false,
      options: [
        'monza',
        'spa',
        'nurburgring',
        'brands_hatch',
        'silverstone',
        'paul_ricard',
        'misano',
        'barcelona',
        'zandvoort',
        'hungaroring',
        'zolder',
        'kyalami',
        'mount_panorama',
        'suzuka',
        'laguna_seca',
        'imola',
        'donington',
        'oulton_park',
        'snetterton',
        'watkins_glen',
        'cota',
        'indianapolis',
        'red_bull_ring',
        'valencia',
      ],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'carGroup',
      label: 'Fahrzeugklasse',
      type: 'select',
      defaultValue: 'FreeForAll',
      description: null,
      required: false,
      options: ['FreeForAll', 'GT3', 'GT4', 'GT2', 'Cup', 'ST', 'TCX'],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'maxCarSlots',
      label: 'Fahrzeugplätze',
      type: 'number',
      defaultValue: 24,
      description: 'Die Strecke kann weniger zulassen – dann gilt ihre Boxenzahl.',
      required: false,
      options: [],
      min: 1,
      max: 82,
      lockedAfterCreate: false,
    },
    {
      key: 'adminPassword',
      label: 'Passwort für Verwalter',
      type: 'password',
      defaultValue: '',
      description: 'Damit gibt es im Spiel Befehle wie /dq und /clear.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'password',
      label: 'Passwort zum Beitreten',
      type: 'password',
      defaultValue: '',
      description: 'Gesetzt heißt: privater Server. Leer heißt: öffentlich.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'spectatorPassword',
      label: 'Passwort für Zuschauer',
      type: 'password',
      defaultValue: '',
      description: 'Muss sich vom Beitritts-Passwort unterscheiden, wenn beide gesetzt sind.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'registerToLobby',
      label: 'In der Serverliste zeigen',
      type: 'toggle',
      defaultValue: true,
      description: 'Aus heißt: nur über die Direktverbindung erreichbar.',
      required: false,
      options: [],
      min: null,
      max: null,
      lockedAfterCreate: false,
    },
    {
      key: 'safetyRatingRequirement',
      label: 'Mindest-Sicherheitswertung (SA)',
      type: 'number',
      defaultValue: -1,
      description: '−1 heißt: keine Anforderung.',
      required: false,
      options: [],
      min: -1,
      max: 99,
      lockedAfterCreate: false,
    },
    {
      key: 'racecraftRatingRequirement',
      label: 'Mindest-Rennkönnen (RC)',
      type: 'number',
      defaultValue: -1,
      description: '−1 heißt: keine Anforderung.',
      required: false,
      options: [],
      min: -1,
      max: 99,
      lockedAfterCreate: false,
    },
    {
      key: 'practiceMinutes',
      label: 'Freies Training (Minuten)',
      type: 'number',
      defaultValue: 20,
      description: null,
      required: false,
      options: [],
      min: 1,
      max: 480,
      lockedAfterCreate: false,
    },
    {
      key: 'qualifyingMinutes',
      label: 'Qualifikation (Minuten)',
      type: 'number',
      defaultValue: 15,
      description: null,
      required: false,
      options: [],
      min: 1,
      max: 480,
      lockedAfterCreate: false,
    },
    {
      key: 'raceMinutes',
      label: 'Rennen (Minuten)',
      type: 'number',
      defaultValue: 30,
      description: null,
      required: false,
      options: [],
      min: 1,
      max: 1_440,
      lockedAfterCreate: false,
    },
  ],
  envMapping: {
    serverName: 'ACC_NAME',
    steamAccount: 'STEAM_LOGIN',
    filesUrl: 'ACC_ARCHIV_URL',
    filesSha256: 'ACC_ARCHIV_SHA256',
    track: 'ACC_TRACK',
    carGroup: 'ACC_CAR_GROUP',
    maxCarSlots: 'ACC_MAX_CAR_SLOTS',
    adminPassword: 'ACC_ADMIN_PASSWORD',
    password: 'ACC_PASSWORD',
    spectatorPassword: 'ACC_SPECTATOR_PASSWORD',
    registerToLobby: 'ACC_REGISTER_TO_LOBBY',
    safetyRatingRequirement: 'ACC_SAFETY_RATING',
    racecraftRatingRequirement: 'ACC_RACECRAFT_RATING',
    practiceMinutes: 'ACC_PRACTICE_MINUTES',
    qualifyingMinutes: 'ACC_QUALIFYING_MINUTES',
    raceMinutes: 'ACC_RACE_MINUTES',
  },
  restartRequiredFields: [
    'serverName',
    'steamAccount',
    'filesUrl',
    'filesSha256',
    'track',
    'carGroup',
    'maxCarSlots',
    'adminPassword',
    'password',
    'spectatorPassword',
    'registerToLobby',
    'safetyRatingRequirement',
    'racecraftRatingRequirement',
    'practiceMinutes',
    'qualifyingMinutes',
    'raceMinutes',
  ],
  /*
   * Genügsam für ein Rennspiel: Der Server rechnet Physik für zwei Dutzend
   * Fahrzeuge, aber er lädt keine Welt. Die Serverdateien wiegen keine hundert
   * Megabyte; der Platz ist für Ergebnisse und Protokolle.
   */
  resourceDefaults: {
    ramMb: 4_096,
    cpuCores: 2,
    diskMb: 10_240,
  },
  query: {
    kind: 'none',
    containerPort: 9_231,
  },
  console: { kind: 'none' },
  iconUrl: null,
  coverImageUrl: null,
  supportsVirtualHostRouting: false,
  supportsWorldImport: false,
  dataVolumeContainerPath: '/data',
  readOnlyRootFilesystem: true,
  tmpfsPaths: ['/tmp'],
  stopTimeoutSeconds: 60,
  /*
   * Ohne Konto gibt Valve diese Anwendung nicht heraus: Der Container bekommt
   * deshalb den Ordner mit der Anmeldung des Betreibers schreibgeschützt
   * eingehängt. Ist keine hinterlegt, sagt das Image im Log, was zu tun ist –
   * und der Weg über den Datei-Manager bleibt daneben bestehen.
   */
  requiresSteamAccount: true,
  // Der erste Start holt die Serverdateien und legt den Wine-Prefix an.
  startupTimeoutSeconds: 900,
  phase: 3,
};

/** Was das Panel als Vorlage anbietet: echte Spiele, keine Prüfstände. */
export const GAME_TYPE_DEFINITIONS: readonly GameTypeDefinition[] = [
  MINECRAFT_PAPER_GAME_TYPE,
  MINECRAFT_VANILLA_GAME_TYPE,
  MINECRAFT_FABRIC_GAME_TYPE,
  MINECRAFT_NEOFORGE_GAME_TYPE,
  VALHEIM_GAME_TYPE,
  TERRARIA_GAME_TYPE,
  FACTORIO_GAME_TYPE,
  PROJECT_ZOMBOID_GAME_TYPE,
  RUST_GAME_TYPE,
  PALWORLD_GAME_TYPE,
  SATISFACTORY_GAME_TYPE,
  SDTD_GAME_TYPE,
  ENSHROUDED_GAME_TYPE,
  VRISING_GAME_TYPE,
  SONS_OF_THE_FOREST_GAME_TYPE,
  VINTAGE_STORY_GAME_TYPE,
  ABIOTIC_FACTOR_GAME_TYPE,
  ARK_ASCENDED_GAME_TYPE,
  ACC_GAME_TYPE,
];

/** Prüfstände und echte Spiele zusammen – für die Tests des Backends. */
export const ALLE_GAME_TYPE_DEFINITIONS: readonly GameTypeDefinition[] = [
  ...PRUEFSTAND_GAME_TYPE_DEFINITIONS,
  ...GAME_TYPE_DEFINITIONS,
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
  /**
   * Welche Spieltypen der Administrator ausgeschaltet hat
   * (`InstanceSettingsDto.disabledGameTypes`).
   *
   * **Warum die Registry das mitgeteilt bekommt und nicht selbst nachschlägt.**
   * Ihre Methoden sind synchron, die Einstellung steht in der Datenbank. Sie
   * bei jedem Aufruf zu lesen hieße, `requireSelectable` und `toDtoList`
   * asynchron zu machen – quer durch das Modul, für eine Zeile, die sich
   * höchstens einmal am Tag ändert. Stattdessen sagt es ihr, wer sie ändert:
   * der Start (einmal beim Hochfahren) und das Speichern in der Verwaltung.
   * Ein veralteter Stand ist damit nicht möglich.
   */
  setDisabledGameTypes(ids: readonly string[]): void;
  /**
   * Definition zu einer Kennung, **ohne** zu werfen (Fundpunkt 247).
   *
   * Für Anzeigen, die einen vorhandenen Server beschreiben: Ein Server in der
   * Datenbank kann eine Kennung tragen, die der Katalog nicht mehr kennt –
   * genau das ist am Prüfstand passiert, als die Prüfstands-Spieltypen aus
   * `GAME_TYPE_DEFINITIONS` genommen wurden (#346). Danach beantwortete
   * `GET /api/servers` die **ganze** Liste mit `404 GAME_TYPE_NOT_FOUND`, und
   * zwar für jedes Konto: Ein einzelner Datensatz nahm allen die Übersicht.
   *
   * Anlegen und Starten benutzen weiterhin {@link require} bzw.
   * {@link requireSelectable} – dort ist ein unbekannter Typ ein echter Fehler.
   */
  find(id: string): GameTypeDefinition | null;
}

/** Wandelt eine Definition in ihr DTO (Pflichtenheft §5.2, §11). */
export function toGameTypeDto(
  definition: GameTypeDefinition,
  phase: InstallationPhase,
  abgeschaltet = false,
): GameTypeDto {
  const available = definition.phase <= phase && !abgeschaltet;

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
    /*
     * Zwei Gründe, zwei Sätze. „Kommt in Ausbaustufe 3" ist eine Zusage,
     * „vom Administrator ausgeschaltet" eine Entscheidung – wer das eine
     * liest, wartet, wer das andere liest, fragt den Administrator. Die
     * Ausbaustufe steht zuerst: Was es hier noch gar nicht geben kann, ist
     * nicht ausgeschaltet, sondern noch nicht da.
     */
    unavailableReason:
      definition.phase > phase
        ? `Kommt in Ausbaustufe ${String(definition.phase)} (Lastenheft §3.5).`
        : abgeschaltet
          ? 'Vom Administrator ausgeschaltet.'
          : null,
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

  // Kennungen, die es im Katalog nicht gibt, stören nicht: Sie schalten nichts
  // ab und bleiben stehen, bis jemand sie in der Verwaltung entfernt.
  let abgeschaltet: ReadonlySet<string> = new Set();

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
    find: (id: string) => byId.get(id) ?? null,
    setDisabledGameTypes(ids) {
      abgeschaltet = new Set(ids);
    },
    requireSelectable(id: string): GameTypeDefinition {
      const definition = require(id);

      if (definition.phase > phase) {
        throw new ServerOrchestrationError('GAME_TYPE_NOT_AVAILABLE', undefined, {
          gameType: id,
          requiredPhase: definition.phase,
          currentPhase: phase,
        });
      }

      /*
       * Ausgeschaltet zählt hier genauso wie „noch nicht da": Derselbe
       * Fehlercode, damit das Frontend nichts Neues lernen muss – der
       * Unterschied steht im `unavailableReason` des DTOs.
       *
       * **Nur das Anlegen ist gesperrt.** `require()` findet den Typ
       * weiterhin, ein laufender Server bleibt also bedienbar. Sonst hätte
       * der Betreiber nach dem Ausschalten einen Server, den er nicht mehr
       * stoppen könnte.
       */
      if (abgeschaltet.has(id)) {
        throw new ServerOrchestrationError('GAME_TYPE_NOT_AVAILABLE', undefined, {
          gameType: id,
          reason: 'disabled',
        });
      }

      return definition;
    },
    toDtoList: () =>
      definitions.map((definition) =>
        toGameTypeDto(definition, phase, abgeschaltet.has(definition.id)),
      ),
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
