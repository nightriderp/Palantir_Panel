import { type ServerResourceLimits } from './game-server.js';

/**
 * Spiele-Registry als DTO (Pflichtenheft §11).
 *
 * `GameTypeDefinition` kapselt alles Spielspezifische. Nach außen – also in den
 * „Server erstellen"-Wizard (F3) und in die Einstellungen eines Servers – geht
 * davon nur der Teil, den die Oberfläche darstellen darf: Anzeigetexte, Bilder,
 * Ressourcen-Empfehlung und das editierbare Config-Schema. Docker-Image,
 * Standard-Umgebungsvariablen und Query-Typ bleiben im Backend.
 */

/**
 * Feldtypen des editierbaren Config-Schemas.
 *
 * Bewusst klein gehalten: das Frontend baut daraus generische Formularfelder,
 * ohne je ein konkretes Spiel zu kennen (Pflichtenheft §11 – neue Spiele ohne
 * Architekturänderung).
 */
export const GAME_CONFIG_FIELD_TYPES = ['text', 'number', 'select', 'toggle', 'password'] as const;

export type GameConfigFieldType = (typeof GAME_CONFIG_FIELD_TYPES)[number];

/** Zulässige Werte eines Config-Feldes. */
export type GameConfigValue = string | number | boolean;

/** Vollständige Konfiguration eines Servers (`GameServer.configJson`, Pflichtenheft §6). */
export type GameConfigValues = Record<string, GameConfigValue>;

/** Ein editierbares Feld aus dem Config-Schema einer `GameTypeDefinition`. */
export interface GameConfigField {
  /** Schlüssel in `GameConfigValues`, z. B. `maxPlayers`. */
  key: string;
  /** Deutsche Beschriftung für das Formular (Lastenheft §4). */
  label: string;
  type: GameConfigFieldType;
  /** Erklärtext unter dem Feld; `null`, wenn keiner nötig ist. */
  description: string | null;
  required: boolean;
  defaultValue: GameConfigValue;
  /** Auswahlwerte bei `select`; sonst leer. */
  options: string[];
  /** Untergrenze bei `number`; `null`, wenn unbegrenzt. */
  min: number | null;
  /** Obergrenze bei `number`; `null`, wenn unbegrenzt. */
  max: number | null;
  /**
   * Nach dem Anlegen unveränderlich (z. B. der Welt-Seed) – eine Änderung würde
   * eine neue Welt erzeugen und die bestehende zurücklassen. Der Wizard zeigt
   * das Feld normal, die Einstellungen zeigen es gesperrt.
   */
  lockedAfterCreate: boolean;
}

/**
 * Spieltyp, wie ihn der Wizard und die Server-Einstellungen sehen.
 *
 * `available === false` bedeutet: der Typ steht fachlich noch nicht bereit
 * (Phase 2/3, Lastenheft §3.5). Das Frontend zeigt ihn dann gesperrt statt ihn
 * zu verstecken, damit erkennbar bleibt, was kommt.
 */
export interface GameTypeDto {
  id: string;
  name: string;
  description: string;
  /** Kachelbild der Übersicht; `null`, solange keins hinterlegt ist. */
  iconUrl: string | null;
  /** Titelbild im Wizard; `null`, solange keins hinterlegt ist. */
  coverImageUrl: string | null;
  /** Zugriff ohne sichtbaren Port möglich (Pflichtenheft §13). */
  supportsVirtualHostRouting: boolean;
  /** Kann der Wizard bestehende Weltdaten übernehmen (Lastenheft §3.3)? */
  supportsWorldImport: boolean;
  defaultPorts: number[];
  resourceDefaults: ServerResourceLimits;
  configFields: GameConfigField[];
  available: boolean;
  /** Grund, wenn `available === false`, z. B. „Kommt in Phase 2". */
  unavailableReason: string | null;
}

// ---------------------------------------------------------------------------
// Vollständige Definition (ergänzt in B3)
// ---------------------------------------------------------------------------
// Der DTO oben ist die Sicht des Frontends. Die vollständige Definition steht
// hier, weil der Vertrag beschreiben muss, was ein Spiel ausmacht – die
// konkreten Definitionen liegen als Registry im Backend
// (`apps/backend/src/modules/server-orchestration/game-registry.ts`), denn neue
// Spiele werden in Version 1 per Code ergänzt, nicht über eine Oberfläche
// (Pflichtenheft §11).

/**
 * Art der Erreichbarkeitsprüfung (Pflichtenheft §9: „Query via `gamedig` bzw.
 * generischer Port-Connect-Test beim Test-Typ").
 *
 * `portConnect` prüft nur, ob sich eine TCP-Verbindung aufbauen lässt, und
 * liefert deshalb keine Spielerzahlen. `gamedig` fragt das Spieleprotokoll ab
 * und liefert zusätzlich Spielerzahl und Ping. `none` fragt gar nicht – für
 * Spiele, an die keine Frage geht, die eine Antwort brächte.
 */
export const GAME_QUERY_KINDS = ['portConnect', 'gamedig', 'none'] as const;

export type GameQueryKind = (typeof GAME_QUERY_KINDS)[number];

/** Generischer Port-Connect-Test (Phase 1, Test-Typ). */
export interface PortConnectQuerySpec {
  readonly kind: 'portConnect';
  /** Container-Port, auf dem geprüft wird; muss in `ports` vorkommen. */
  readonly containerPort: number;
}

/**
 * Abfrage über `gamedig` (Phase 2+).
 *
 * `protocol` ist der Bezeichner der `gamedig`-Bibliothek, z. B. `minecraft`.
 * Bewusst ein freier String: Die Liste unterstützter Protokolle gehört der
 * Bibliothek, nicht diesem Vertrag.
 */
export interface GamedigQuerySpec {
  readonly kind: 'gamedig';
  readonly protocol: string;
  readonly containerPort: number;
  /**
   * Schlüssel eines Konfigurationsfeldes, ohne dessen Zustimmung der Server
   * **auf keine Abfrage antwortet**.
   *
   * Valheim ist der Fall, für den das Feld entstanden ist: Ein Server mit
   * `-public 0` meldet sich nicht beim Steam-Verzeichnis an und beantwortet
   * darum keine A2S-Abfrage. Erreichbar ist er trotzdem — wer die Adresse und
   * das Passwort hat, spielt. Ohne diese Angabe hielte Palantir ihn für tot:
   * Der Start liefe in die Frist und endete in `error`, während Spieler darauf
   * unterwegs sind.
   *
   * Steht das Feld auf etwas anderem als `true`, ist die Abfrage unmöglich —
   * es gibt keine Spielerzahl, keinen Ping, und der Start gilt als geglückt,
   * sobald der Container läuft. Ohne die Angabe ist jede Abfrage möglich; für
   * jedes andere Spiel ändert sich nichts.
   */
  readonly requiresConfigFlag?: string;
}

/**
 * **Dieses Spiel lässt sich nicht abfragen.**
 *
 * Es gibt Server, an die keine Frage geht, die eine Antwort brächte: Palworld
 * beantwortet nur seine eigene REST-Schnittstelle und die verlangt das
 * Administrator-Passwort; andere Spiele sprechen ausschließlich UDP, wo ein
 * Verbindungsversuch nichts beweist.
 *
 * Der Start gilt dann als geglückt, sobald der Container läuft — mehr ist
 * über so einen Server nicht in Erfahrung zu bringen, und die falsche Aussage
 * wäre die schlechtere. Der Preis ist derselbe wie bei
 * {@link GamedigQuerySpec.requiresConfigFlag}: keine Spielerzahl, kein Ping,
 * kein automatischer Stopp bei 0 Spielern.
 */
export interface NoQuerySpec {
  readonly kind: 'none';
  /**
   * Container-Port, der die Adresse des Spielers trägt.
   *
   * Steht auch hier, obwohl nichts abgefragt wird: Die Portzuweisung und die
   * angezeigte Adresse hängen daran, nicht nur die Sonde.
   */
  readonly containerPort: number;
}

export type GameQuerySpec = PortConnectQuerySpec | GamedigQuerySpec | NoQuerySpec;

export type GameTypePortProtocol = 'tcp' | 'udp';

/**
 * Was eine Spiele-Definition über einen Port sagen darf.
 *
 * `both` heißt: **dieselbe öffentliche Nummer für TCP und UDP**. Nicht „zwei
 * Ports", sondern einer, der beide Protokolle trägt.
 *
 * Es gibt Spiele, bei denen das keine Bequemlichkeit ist, sondern Bedingung:
 * Satisfactory und 7 Days to Die leiten die zweite Adresse aus der ersten ab –
 * der Client rechnet nicht, er nimmt dieselbe Nummer. Zwei getrennte Einträge
 * bekämen aus dem Pool zwei verschiedene Nummern, und damit bräche das
 * Beitreten.
 *
 * Eine Zuweisung (`ServerPortAssignment`) kennt dieses Wort **nicht**: Aus
 * einem Port mit `both` werden zwei Zuweisungen mit derselben öffentlichen
 * Nummer, eine je Protokoll. So bleibt alles dahinter – Portvergabe in der
 * Datenbank, Veröffentlichung am Container, Tunnel – bei genau zwei
 * Protokollen.
 */
export type GameTypePortDeclaration = GameTypePortProtocol | 'both';

/** Ein Standard-Port einer Spiele-Definition. */
export interface GameTypePort {
  readonly containerPort: number;
  /**
   * `tcp`, `udp` – oder `both` für eine Nummer, die beide Protokolle trägt
   * (siehe {@link GameTypePortDeclaration}).
   */
  readonly protocol: GameTypePortDeclaration;
  /**
   * `true` beim Port, den der Spieler benutzt. Genau einer je Definition; er
   * landet als sichtbarer Port in der Verbindungsadresse (Pflichtenheft §13).
   */
  readonly primary: boolean;
  /** Beschriftung für die Oberfläche, z. B. „Spiel-Port" oder „RCON". */
  readonly label: string;
  /**
   * **Im Container dieselbe Nummer wie draußen.**
   *
   * Sonst gilt: Der Container lauscht auf seiner festen Nummer, der Pool vergibt
   * nach außen eine beliebige freie, und dazwischen wird übersetzt. Der Spieler
   * bekommt die öffentliche zu sehen, und alles ist gut.
   *
   * Es gibt aber Spiele, die ihre eigene Portnummer **weitersagen** – an ein
   * Verzeichnis oder an den Client, der gerade sucht. Assetto Corsa
   * Competizione ist so eins: Der Server meldet dem Lobby-Dienst die Nummern aus
   * seiner `configuration.json`, und wer sie dort abholt, verbindet sich
   * dorthin. Steht drinnen 9231 und draußen 25010, zeigt die Auskunft auf einen
   * Port, den es nicht gibt – der Server läuft, und niemand kommt herein.
   *
   * Mit dieser Angabe wird die zugewiesene öffentliche Nummer auch die Nummer im
   * Container. Im Container ist das gefahrlos: Jeder hat seinen eigenen
   * Netzwerk-Namensraum, es kollidiert nichts. Das Spiel-Image erfährt sie über
   * {@link GameTypePort.envVar} und trägt sie in seine Konfiguration ein.
   */
  readonly usesPublicPortNumber?: boolean;
  /**
   * Umgebungsvariable, in der das Spiel-Image die **öffentliche** Portnummer
   * dieses Ports vorfindet.
   *
   * Ohne Angabe erfährt das Image sie nicht – und braucht sie in aller Regel
   * auch nicht: Es lauscht auf seiner festen Nummer und weiß nichts von der
   * Übersetzung davor. Wer sie braucht, ist ein Spiel, das seine Adresse selbst
   * weitersagt (siehe {@link GameTypePort.usesPublicPortNumber}).
   */
  readonly envVar?: string;
}

/**
 * Konsole über die Standardeingabe des Servers: `EXEC_CONSOLE` startet
 * `palantir-console <befehl>` im Container, die Antwort steht im Log.
 */
export interface StdinConsoleSpec {
  readonly kind: 'stdin';
}

/**
 * Konsole über RCON (Source RCON Protocol, wie Minecraft es spricht): Der
 * Agent verbindet sich über das Spielenetz mit `port` des Containers, meldet
 * sich mit dem Passwort aus `passwordFile` an und bekommt die Antwort des
 * Befehls zurück – statt sie im Log zu suchen.
 *
 * `passwordFile` liegt **relativ zum Datenordner** des Servers. Das Image
 * erzeugt das Passwort bei jedem Start neu und schreibt es dorthin; kein Port
 * wird veröffentlicht, das Passwort verlässt die Node nie. Erreichbar ist der
 * RCON-Port nur aus dem Spielenetz von der festen Adresse des Agents
 * (`egress-firewall.sh`, Ausnahme Agent → Spielserver).
 */
export interface RconConsoleSpec {
  readonly kind: 'rcon';
  /** Port IM Container, auf dem RCON lauscht (Minecraft: 25575). */
  readonly port: number;
  /** Datei mit dem Passwort, relativ zum Datenordner, z. B. `.palantir/rcon.password`. */
  readonly passwordFile: string;
}

/**
 * **Dieses Spiel hat keine Konsole.**
 *
 * Nicht jeder Spielserver nimmt überhaupt Befehle entgegen: Valheim liest weder
 * seine Standardeingabe noch spricht es RCON. Ohne diese Angabe gälte `stdin`,
 * und das Panel zeigte ein Eingabefeld, dessen Zeilen in einem Rohr
 * verschwinden, das niemand liest — ein Knopf ohne Wirkung ist schlechter als
 * keiner.
 *
 * Das ist eine Aussage über das Spiel, nicht über den Aufrufer: Wer die
 * Berechtigung `canUseConsole` hat, behält sie; es gibt nur nichts zu bedienen.
 */
export interface NoConsoleSpec {
  readonly kind: 'none';
}

export type GameConsoleSpec = StdinConsoleSpec | RconConsoleSpec | NoConsoleSpec;

/**
 * Ein Schnellbefehl der Live-Konsole – ein Knopf unter dem Eingabefeld.
 *
 * `command` ist die vollständige Zeile, die abgeschickt wird; Befehle, die
 * eine Eingabe brauchen (`say <Text>`), gehören nicht hierher, sondern ins
 * Feld.
 */
export interface ConsoleQuickCommand {
  /** Beschriftung des Knopfs, z. B. „Spieler". */
  readonly label: string;
  /** Die Zeile, die an die Konsole geht, z. B. `list`. */
  readonly command: string;
}

/**
 * Vollständige Spiele-Definition (Pflichtenheft §11).
 *
 * Änderungen sind bevorzugt additiv (neue optionale Felder).
 */
export interface GameTypeDefinition {
  /** Stabile Kennung, wie sie in `GameServer.gameType` steht, z. B. `test-echo`. */
  readonly id: string;
  /** Anzeigename, z. B. „Minecraft (Paper)". */
  readonly name: string;
  readonly description: string;
  readonly dockerImage: string;
  /** Startbefehl; ohne Angabe gilt der Entrypoint des Images. */
  readonly defaultCommand?: readonly string[];
  readonly defaultEnv: Readonly<Record<string, string>>;
  readonly ports: readonly GameTypePort[];
  readonly configFields: readonly GameConfigField[];
  /**
   * Konfigurationsfelder, die beim Anlegen des Containers in eine
   * Umgebungsvariable geschrieben werden: Schlüssel aus `configFields` → Name
   * der Variable.
   *
   * Bewusst hier und nicht als Feld an `GameConfigField`: Ob ein Wert als
   * Umgebungsvariable ankommt, ist eine Eigenschaft des Images, nicht des
   * Formulars – und `GameConfigField` geht als DTO an das Frontend, das damit
   * nichts anfangen kann.
   */
  readonly envMapping?: Readonly<Record<string, string>>;
  /**
   * Schlüssel aus `configFields`, deren Änderung erst nach einem Neustart wirkt
   * (Lastenheft §3.3). Das Backend setzt daraufhin `pendingRestart` am Server.
   */
  readonly restartRequiredFields?: readonly string[];
  /**
   * Schnellbefehle der Live-Konsole (Lastenheft §3.3), je Spiel statt fest im
   * Frontend: Was bei Minecraft `list` heißt, heißt beim Prüfstand `help` und
   * bei einem anderen Spiel ganz anders. Ohne Angabe zeigt die Konsole nur das
   * Eingabefeld. Der Befehl geht denselben Weg wie eine Eingabe von Hand
   * (`EXEC_CONSOLE`), die Antwort kommt über das Log.
   */
  readonly consoleQuickCommands?: readonly ConsoleQuickCommand[];
  readonly resourceDefaults: ServerResourceLimits;
  readonly query: GameQuerySpec;
  readonly iconUrl: string | null;
  readonly coverImageUrl: string | null;
  /**
   * Hostname-basiertes Routing über einen einzigen öffentlichen Port
   * (Pflichtenheft §2.4, §13 – initial nur Minecraft). Bei `true` bekommt der
   * Spieler keinen Port zu sehen.
   */
  readonly supportsVirtualHostRouting: boolean;
  /** Kann der Wizard bestehende Weltdaten übernehmen (Lastenheft §3.3)? */
  readonly supportsWorldImport: boolean;
  /**
   * Wie die Live-Konsole ihre Befehle an den Server bringt (P2-9). Ohne Angabe
   * `stdin`: `palantir-console` im Container schreibt in die Standardeingabe,
   * die Antwort kommt über das Log. Mit `rcon` fragt der Agent den Server über
   * sein RCON-Protokoll und bekommt die Antwort zurück.
   */
  readonly console?: GameConsoleSpec;
  /** Beschreibbarer Datenordner im Container – der einzige dauerhaft beschreibbare Ort. */
  readonly dataVolumeContainerPath: string;
  /**
   * Read-only-Root-Filesystem. Pflichtenheft §2.3 verlangt das „wo vom Spiel
   * unterstützt" – die Entscheidung trifft diese Definition, nicht der Agent.
   */
  readonly readOnlyRootFilesystem?: boolean;
  /** Zusätzliche beschreibbare tmpfs-Pfade bei read-only Root (z. B. `/tmp`). */
  readonly tmpfsPaths?: readonly string[];
  /** Kulanzzeit für SIGTERM vor SIGKILL. */
  readonly stopTimeoutSeconds?: number;
  /**
   * Befehl, der den Server **selbst** herunterfährt – geschickt **vor** dem
   * Stoppsignal.
   *
   * Es gibt eine ganze Reihe von Spielen, die bei SIGTERM nicht speichern:
   * Terraria will `exit`, Project Zomboid `quit`, Vintage Story `/stop`,
   * ARK `DoExit`, Rust `quit`. Wo das Spiel seine Standardeingabe liest, fängt
   * das Startskript das Signal ab und schreibt den Befehl selbst in das
   * Konsolen-Rohr. **Wo die Konsole über RCON geht, kann das Image das nicht:**
   * Ein RCON-Sprecher gehört nicht in ein Spiel-Image. Dann bleibt nur der Weg
   * über den Agent, der ohnehin RCON spricht.
   *
   * Der Ablauf ist deshalb: Der Agent schickt diesen Befehl über den Weg, den
   * {@link GameTypeDefinition.console} nennt (Standardeingabe oder RCON),
   * wartet, bis der Container von selbst endet, und greift erst danach zum
   * Signal. Endet der Server nicht – weil der Befehl falsch war, die Konsole
   * klemmt oder das Spiel ihn nicht kennt –, passiert genau das, was ohne diese
   * Angabe passierte; es geht also nichts verloren, was heute funktioniert.
   *
   * Eine Zeile, wie ein Spieler sie tippen würde; der Aufrufer zerlegt sie in
   * Argumente. Ohne Angabe bleibt es beim Signal allein – und für die Spiele,
   * deren Startskript das Signal schon abfängt, soll das auch so bleiben: Beides
   * zugleich schickte den Befehl zweimal.
   */
  readonly stopCommand?: string;
  /**
   * **Die Serverdateien gibt es nur gegen eine Steam-Anmeldung.**
   *
   * Die meisten Spiele aus Anhang A geben ihren dedizierten Server anonym
   * heraus – SteamCMD holt ihn ohne Konto. Manche tun das nicht: Assetto Corsa
   * Competizione ist ein **Werkzeug am Elternspiel**, und ein anonymer Abruf
   * endet mit `Failed to install app '1430110' (No subscription)`. Es braucht
   * ein Konto, das das Spiel besitzt.
   *
   * Ein Passwort steht deshalb trotzdem nirgends im Panel. Der Betreiber meldet
   * sich **einmal von Hand auf der Node** bei SteamCMD an; SteamCMD legt dort
   * einen Anmelde-Token ab. Diese Angabe sorgt dafür, dass Container dieses
   * Spieltyps den Ordner mit dem Token **schreibgeschützt eingehängt**
   * bekommen – und nur sie. Welches Konto gemeint ist, sagt ein
   * Konfigurationsfeld des Servers; der Benutzername allein ist kein Geheimnis.
   *
   * Ohne die Angabe sieht ein Container den Ordner nicht. Das ist der Grund,
   * warum es sie gibt: Ein Token, den jeder Spielserver lesen kann, wäre ein
   * Token, den jedes Spiel-Image verlieren kann.
   */
  readonly requiresSteamAccount?: boolean;
  /**
   * Wie lange nach dem Start auf einen erfolgreichen Health-Check gewartet wird,
   * bevor der Start als gescheitert gilt (Pflichtenheft §9). Ein Spiel, das
   * seine Welt erst generieren muss, braucht hier mehr Zeit als ein Test-Typ.
   */
  readonly startupTimeoutSeconds: number;
  /**
   * Ausbaustufe, ab der dieses Spiel fachlich existiert (Lastenheft §3.5).
   * Definitionen späterer Phasen sind sichtbar, aber nicht auswählbar.
   */
  readonly phase: 1 | 2 | 3;
}
