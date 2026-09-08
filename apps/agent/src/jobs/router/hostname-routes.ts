/**
 * Routen-Dateien des Hostname-Routers (Pflichtenheft §2.4, §13).
 *
 * **Wofür.** Spiele mit `supportsVirtualHostRouting` – bei Minecraft ist das
 * der Regelfall – bekommen keinen eigenen öffentlichen Port. Alle Instanzen
 * teilen sich einen einzigen (`MINECRAFT_ROUTER_PORT`, 25565), und
 * auseinandergehalten werden sie über den Namen, den der Client schon im
 * Handshake mitschickt. Ein Reverse-Proxy auf der Gamenode – Infrared – liest
 * ihn und verbindet zur richtigen Instanz.
 *
 * Infrared kennt keine API: Es liest beim Start jede Datei seines
 * Routen-Verzeichnisses und beobachtet den Ordner anschließend mit `fsnotify`.
 * Eine neue Datei wird zur Laufzeit als Route übernommen, eine gelöschte nimmt
 * ihre Route wieder mit (`WatchProxyConfigFolder` bzw. der `Remove`-Zweig in
 * `ProxyConfig.watch`, beides in `config.go` der gepinnten Fassung v1.3.4).
 * Genau daran hängt dieses Modul: **eine Datei je Server, angelegt beim
 * `CREATE`, entfernt beim `DELETE`.**
 *
 * **Warum kein Agent-Befehl und keine Vertragsänderung.** Was der Router
 * wissen muss – Hostname und Zielport –, hängt bereits am Container: Das
 * Backend setzt es als Labels in den Bauplan (`container-spec.ts`), und
 * `ContainerSpec.labels` ist im Vertrag längst ein freies
 * `Record<string, string>`. Ein eigener Befehl wäre eine Vertragsänderung für
 * eine Angabe, die ohnehin mitkommt – und eine zweite Stelle, an der man ihn
 * beim Neuaufbau vergessen könnte.
 *
 * **Warum das hier und nicht in der Container-Runtime.** Es ist reine
 * Dateisystemarbeit, so wie Datenordner, Sicherungen und die
 * Speicherübersicht. Die Runtime bleibt die einzige Stelle, die mit Docker
 * spricht (CLAUDE.md §4); mit dem Router hat sie nichts zu tun.
 *
 * **Erzeugte Konfiguration.** Der Hostname kommt aus einem Formular des
 * Nutzers und landet in einer Datei, die ein fremder Prozess ausliest – wie
 * der Familienname im Schriften-CSS (`modules/fonts/stylesheet.ts` im
 * Backend). Er wird deshalb vor dem Schreiben gegen ein enges Muster geprüft
 * und nicht nur escaped, und der Dateiname entsteht ausschließlich aus einer
 * geprüften Server-Id.
 */

import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ContainerRuntimeError, type ContainerSpec } from '../../runtime/index.js';
import { resolveWithinDirectory } from '../paths.js';

/**
 * Labels, die das Backend an einen Container mit Hostname-Routing hängt.
 *
 * Gegenstücke zu `VIRTUAL_HOST_HOSTNAME_LABEL` und
 * `VIRTUAL_HOST_TARGET_PORT_LABEL` in
 * `apps/backend/src/modules/server-orchestration/container-spec.ts`. Bewusst
 * als Zeichenkette und nicht über `packages/contracts`: Für `palantir.serverId`
 * gilt dasselbe, und die Vertragsgrenze führt keine Namenskonstanten
 * (CLAUDE.md §3).
 */
export const VIRTUAL_HOST_HOSTNAME_LABEL = 'palantir.virtualHost.hostname';
export const VIRTUAL_HOST_TARGET_PORT_LABEL = 'palantir.virtualHost.targetPort';

/** Unterordner, den Infrared liest (`INFRARED_CONFIG_PATH`). */
export const PROXIES_DIRNAME = 'proxies';

/**
 * Port, auf dem der Router lauscht, wenn `MINECRAFT_ROUTER_PORT` fehlt.
 *
 * 25565 ist der Port, den der Minecraft-Client von sich aus benutzt – deshalb
 * ist er nicht frei wählbar, ohne dass Spieler ihn eintippen müssten. Dieselbe
 * Zahl steht als Vorgabe in `.env.example`.
 */
export const DEFAULT_ROUTER_LISTEN_PORT = 25_565;

/**
 * Unterordner, in dem eine Datei zuerst vollständig entsteht.
 *
 * Er liegt **neben** dem Routen-Ordner und nicht darin: Infrared beobachtet
 * den Routen-Ordner und nimmt jede dort auftauchende Datei als Route – eine
 * halb geschriebene Zwischendatei wäre eine kaputte. Fertig geschrieben wird
 * hier, hinübergeschoben mit `rename()`; das ist auf demselben Dateisystem
 * unteilbar, und Infrared sieht die Datei nur vollständig.
 */
export const STAGING_DIRNAME = '.staging';

/**
 * Erlaubte Form eines Hostnamens: Kleinbuchstaben, Ziffern, Bindestriche, in
 * Labels von höchstens 63 Zeichen, mindestens zwei Labels, höchstens 253
 * Zeichen insgesamt.
 *
 * Enger als das, was DNS zuließe, und mit Absicht: Alles, womit man aus der
 * erzeugten Datei ausbrechen könnte – Anführungszeichen, geschweifte Klammern,
 * Zeilenumbrüche, Schrägstriche, `..` – fällt damit heraus, bevor es überhaupt
 * zum Serialisieren kommt.
 */
const HOSTNAME_MUSTER =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Server-Ids sind UUIDs; der Dateiname entsteht nur aus einer solchen. */
const UUID_MUSTER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Container-Namen des Panels – der Router löst sie über das Docker-DNS auf. */
const CONTAINER_NAME_MUSTER = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

/** Was aus einem Bauplan hervorgeht, wenn er eine Route braucht. */
export interface HostnameRoute {
  readonly serverId: string;
  readonly hostname: string;
  /** Name des Zielcontainers im Spielenetz. */
  readonly containerName: string;
  /** Port, auf dem der Spielserver **im Container** lauscht. */
  readonly targetPort: number;
}

/**
 * Die Route aus einem Bauplan lesen – oder `null`, wenn der Container keine
 * braucht.
 *
 * `null` ist der Normalfall: Solange kein Spieltyp
 * `supportsVirtualHostRouting` auf `true` stehen hat, trägt kein Container
 * diese Labels.
 *
 * @throws {ContainerRuntimeError} `INVALID_CONTAINER_SPEC`, wenn die Labels da
 *   sind, aber nicht zusammenpassen. Stillschweigend zu verwerfen hieße: Der
 *   Server läuft, meldet Erfolg und ist für niemanden erreichbar – genau der
 *   Fall, den Pflichtenheft §19 auf der Backend-Seite schon verhindert.
 */
export function routeFromSpec(spec: ContainerSpec): HostnameRoute | null {
  const hostname = spec.labels?.[VIRTUAL_HOST_HOSTNAME_LABEL];
  const portRoh = spec.labels?.[VIRTUAL_HOST_TARGET_PORT_LABEL];

  if (hostname === undefined && portRoh === undefined) {
    return null;
  }

  if (hostname === undefined || portRoh === undefined) {
    throw new ContainerRuntimeError('INVALID_CONTAINER_SPEC', {
      message: `Für das Hostname-Routing gehören ${VIRTUAL_HOST_HOSTNAME_LABEL} und ${VIRTUAL_HOST_TARGET_PORT_LABEL} zusammen; hier fehlt eines von beiden.`,
      details: { name: spec.name },
    });
  }

  if (spec.serverId === undefined || !UUID_MUSTER.test(spec.serverId)) {
    throw new ContainerRuntimeError('INVALID_CONTAINER_SPEC', {
      message: 'Eine Route braucht die Server-Id des Containers als Dateinamen.',
      details: { name: spec.name, serverId: spec.serverId ?? null },
    });
  }

  if (!HOSTNAME_MUSTER.test(hostname)) {
    throw new ContainerRuntimeError('INVALID_CONTAINER_SPEC', {
      message: `„${hostname}" ist kein Hostname, den der Router annehmen darf.`,
      details: { name: spec.name },
    });
  }

  if (!CONTAINER_NAME_MUSTER.test(spec.name)) {
    throw new ContainerRuntimeError('INVALID_CONTAINER_SPEC', {
      message: `„${spec.name}" ist kein Containername, den der Router auflösen könnte.`,
      details: { serverId: spec.serverId },
    });
  }

  const targetPort = Number(portRoh);

  if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65_535) {
    throw new ContainerRuntimeError('INVALID_CONTAINER_SPEC', {
      message: `„${portRoh}" ist kein gültiger Zielport für den Router.`,
      details: { name: spec.name },
    });
  }

  return {
    serverId: spec.serverId.toLowerCase(),
    hostname,
    containerName: spec.name,
    targetPort,
  };
}

/**
 * Inhalt einer Routen-Datei in dem Format, das Infrared v1.3.4 erwartet.
 *
 * Belegt aus der Fassung selbst: `ProxyConfig` in `config.go` und die Tabelle
 * „Proxy Config" in der README des Tags. Die Felder heißen dort `domainName`,
 * `listenTo`, `proxyTo`, `timeout` und `disconnectMessage`; alles Übrige füllt
 * `DefaultProxyConfig()` auf, weil `LoadFromPath` die geladene Datei über die
 * Vorgaben legt.
 *
 * `proxyTo` ist der **Containername**, nicht eine Adresse: Innerhalb eines
 * benutzerdefinierten Docker-Netzes löst das eingebettete DNS ihn auf, und die
 * Adresse eines Containers ändert sich mit jedem Neustart – der Name nicht.
 * Deshalb überlebt die Datei jeden Start und muss nur beim Anlegen und Löschen
 * angefasst werden.
 */
export function routeFileContent(route: HostnameRoute, listenPort: number): string {
  return `${JSON.stringify(
    {
      domainName: route.hostname,
      listenTo: `:${listenPort}`,
      proxyTo: `${route.containerName}:${route.targetPort}`,
      // Wartezeit der Erreichbarkeitsprüfung vor jeder Verbindung. Die
      // Vorgabe von 1000 ms ist für einen Server auf derselben Node knapp,
      // sobald er unter Last steht; darunter meldete der Router „offline",
      // obwohl der Server läuft.
      timeout: 5_000,
      disconnectMessage: 'Dieser Server ist gerade nicht erreichbar.',
    },
    null,
    2,
  )}\n`;
}

export interface HostnameRouterJobOptions {
  /**
   * Ablage des Routers auf der Node (`AGENT_ROUTER_DIR`). `null` = kein Router
   * eingerichtet; dann tut dieses Modul nichts.
   */
  readonly routerDir: string | null;
  /** Port, auf dem der Router lauscht (`MINECRAFT_ROUTER_PORT`). */
  readonly listenPort: number;
}

/**
 * Legt Routen-Dateien an und entfernt sie wieder.
 *
 * Ohne `routerDir` ist jede Methode wirkungslos und meldet `false`: Eine
 * Installation ohne Router soll deshalb nicht scheitern, und kein Spieltyp
 * verlangt bislang einen.
 */
export class HostnameRouterJob {
  private readonly routerDir: string | null;
  private readonly listenPort: number;

  constructor(options: HostnameRouterJobOptions) {
    this.routerDir = options.routerDir;
    this.listenPort = options.listenPort;
  }

  /** Ob überhaupt ein Routen-Verzeichnis eingerichtet ist. */
  get eingerichtet(): boolean {
    return this.routerDir !== null;
  }

  /** Verzeichnis, das Infrared liest. */
  get proxiesDir(): string | null {
    return this.routerDir === null ? null : path.join(this.routerDir, PROXIES_DIRNAME);
  }

  /**
   * Route eines Bauplans schreiben, falls er eine braucht.
   *
   * @returns `true`, wenn eine Datei entstanden ist.
   */
  async writeFromSpec(spec: ContainerSpec): Promise<boolean> {
    const route = routeFromSpec(spec);

    if (route === null || this.routerDir === null) {
      return false;
    }

    const proxies = path.join(this.routerDir, PROXIES_DIRNAME);
    const staging = path.join(this.routerDir, STAGING_DIRNAME);
    const ziel = this.routeFilePath(route.serverId);

    await fs.mkdir(proxies, { recursive: true });
    await fs.mkdir(staging, { recursive: true });

    const zwischendatei = path.join(staging, `${route.serverId}.${randomBytes(6).toString('hex')}`);

    try {
      await fs.writeFile(zwischendatei, routeFileContent(route, this.listenPort), {
        encoding: 'utf8',
        mode: 0o644,
      });
      await fs.rename(zwischendatei, ziel);
    } catch (error: unknown) {
      await fs.rm(zwischendatei, { force: true }).catch(() => undefined);
      throw error;
    }

    return true;
  }

  /**
   * Route eines Servers entfernen.
   *
   * Eine fehlende Datei ist **kein** Fehler: Das Löschen eines Servers, der
   * nie eine Route hatte, ist der Normalfall, und ein Fehler hier machte einen
   * Server unlöschbar.
   *
   * @returns `true`, wenn wirklich etwas entfernt wurde.
   */
  async remove(serverId: string | null): Promise<boolean> {
    if (this.routerDir === null || serverId === null || !UUID_MUSTER.test(serverId)) {
      return false;
    }

    const ziel = this.routeFilePath(serverId.toLowerCase());

    try {
      await fs.unlink(ziel);
      return true;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Pfad der Routen-Datei eines Servers.
   *
   * Die Id ist an dieser Stelle bereits gegen {@link UUID_MUSTER} geprüft;
   * `resolveWithinDirectory` steht trotzdem davor – der Dateiname entsteht aus
   * einer Eingabe, und eine zweite Schranke kostet hier nichts.
   */
  private routeFilePath(serverId: string): string {
    if (this.routerDir === null) {
      throw new ContainerRuntimeError('INVALID_PATH', {
        message: 'Es ist kein Routen-Verzeichnis eingerichtet.',
      });
    }

    return resolveWithinDirectory(path.join(this.routerDir, PROXIES_DIRNAME), `${serverId}.json`);
  }
}
