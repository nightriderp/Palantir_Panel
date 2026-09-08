/**
 * Bauplan eines Containers und sein Fingerabdruck (WORK_STATUS.md, Punkt 114).
 *
 * Ein Container bekommt seine Umgebungsvariablen, sein Image und seine Grenzen
 * **beim Anlegen**. Danach ändert sich daran nichts mehr: `RESTART` startet
 * denselben Container mit denselben Werten. Eine geänderte Konfiguration und
 * ein neueres Image wirken deshalb erst, wenn der Container neu angelegt wird.
 *
 * Damit das Backend merkt, wann das nötig ist, wird der Bauplan an genau einer
 * Stelle gebaut und sein Fingerabdruck am Server gespeichert. Weicht der
 * Fingerabdruck des heutigen Bauplans davon ab, ist der Container veraltet.
 *
 * Der Fingerabdruck steht bewusst **neben** `imageRef` und ersetzt es nicht:
 * `imageRef` beantwortet die Frage der Oberfläche („läuft der Server auf einer
 * älteren Fassung?", Mockup-Abgleich 3.4) und ist dafür lesbar. Der
 * Fingerabdruck beantwortet die Frage des Lifecycles („muss der Container neu
 * gebaut werden?") und deckt dabei auch Konfiguration, Ports und Grenzen ab.
 */

import { createHash } from 'node:crypto';
import { type CreateCommandPayload, type GameTypeDefinition } from '@palantir/contracts';
import { buildContainerEnv } from './game-registry.js';
import { type ServerRecord } from './repository.js';

/**
 * Nutzlast des `CREATE`-Befehls.
 *
 * Bewusst der Vertragstyp aus `@palantir/contracts` und keine eigene Fassung:
 * Der Bauplan geht genau so an den Agent, und ein zweiter Typ daneben wuerde
 * beim naechsten Feld auseinanderlaufen.
 */
export type ContainerCreateSpec = CreateCommandPayload;

/**
 * Umgebungsvariable, in der die Startparameter des Servers stehen
 * (WORK_STATUS.md, Punkt 115).
 *
 * **Warum eine Variable und kein angehängtes Startkommando:** Der Agent nimmt
 * `command` als Argumentliste entgegen – bewusst ohne Shell, damit aus einer
 * Eingabe keine Shell-Injection wird (siehe `ContainerRuntime.execConsole`).
 * Freien Text in eine Argumentliste zu zerlegen hieße, Anführungszeichen und
 * Escapes selbst auszuwerten: genau die Sorte Parser, an der man sich schneidet.
 *
 * Die Startparameter gehen deshalb **als eine Zeichenkette** an das Image. Was
 * daraus wird, entscheidet das Image in seinem Startskript – die eigenen
 * Spiel-Images des Projekts werden ohnehin dafür gebaut (siehe Kopfkommentar
 * der Spiele-Registry). Ein Image, das die Variable nicht kennt, ignoriert sie
 * schlicht.
 */
export const STARTUP_PARAMETERS_ENV = 'PALANTIR_STARTUP_PARAMETERS';

/**
 * Labels für das Hostname-Routing (Pflichtenheft §2.4, §13).
 *
 * Nur gesetzt bei Spieltypen mit `supportsVirtualHostRouting`. Sie tragen die
 * beiden Angaben, die der Reverse-Proxy auf der Gamenode braucht und sonst
 * nirgends her bekäme: **welchen Namen** der Spieler eintippt und **auf welchem
 * Port im Container** der Server dahinter lauscht. Der Agent macht daraus eine
 * Routen-Datei (`apps/agent/src/jobs/router/hostname-routes.ts`); ein Container
 * ohne diese Labels erzeugt keine.
 *
 * **Warum Labels und kein eigener Agent-Befehl:** `ContainerSpec.labels` ist im
 * Vertrag bereits ein freies `Record<string, string>` (`agent-commands.ts`), im
 * Wire-Schema geprüft und in der Härtung durchgereicht. Ein zusätzlicher Befehl
 * wäre eine Vertragsänderung für eine Angabe, die ohnehin am Container hängt –
 * und er ginge beim Neuaufbau eines Containers verloren, wenn ihn jemand
 * vergisst. Am Container hängt sie, solange es ihn gibt.
 *
 * Als Zeichenkette und nicht aus `@palantir/contracts`: Dasselbe gilt schon für
 * `palantir.serverId` unten. Die Gegenstücke stehen im Agent
 * (`apps/agent/src/runtime/hardening.ts`).
 */
export const VIRTUAL_HOST_HOSTNAME_LABEL = 'palantir.virtualHost.hostname';
export const VIRTUAL_HOST_TARGET_PORT_LABEL = 'palantir.virtualHost.targetPort';

export interface BuildContainerSpecInput {
  readonly server: ServerRecord;
  readonly definition: GameTypeDefinition;
  readonly containerName: string;
  readonly dataHostPath: string;
  /**
   * Vollständiger Hostname des Servers (`<subdomain>.<PALANTIR_DOMAIN>`).
   *
   * Wird nur bei Spieltypen mit `supportsVirtualHostRouting` verwendet – der
   * Aufrufer reicht ihn trotzdem immer herein, damit die Entscheidung an
   * genau einer Stelle steht und nicht zwei Aufrufer sie verschieden treffen.
   */
  readonly hostname: string;
}

/**
 * Den Bauplan aus Server und Spiel-Definition zusammensetzen.
 *
 * Einzige Quelle für `CREATE` – beim ersten Anlegen wie beim Neuaufbau. Zwei
 * Fassungen desselben Baus wären genau die Art Abweichung, die man erst im
 * Betrieb bemerkt.
 */
export function buildContainerSpec({
  server,
  definition,
  containerName,
  dataHostPath,
  hostname,
}: BuildContainerSpecInput): ContainerCreateSpec {
  const routing = definition.supportsVirtualHostRouting;

  /*
   * Der primäre Port eines Spiels mit Hostname-Routing gehört NICHT auf den
   * Host (Pflichtenheft §2.4).
   *
   * `ports.allocate()` trägt ihn zwar als Zuweisung ein – mit
   * `MINECRAFT_ROUTER_PORT` als öffentlichem Port, damit die Adresse in der
   * Datenbank vollständig ist –, aber alle Instanzen teilen sich genau diesen
   * einen Port. Als Bindung an `127.0.0.1` wäre er nach dem ersten Server
   * belegt: Der zweite käme mit „port is already allocated" gar nicht erst
   * hoch. Erreichbar ist der Container stattdessen über das Spielenetz, und
   * genau dorthin verbindet der Router.
   */
  const hostBindings = server.assignedPorts.filter(
    (assignment) => !(routing && assignment.primary),
  );

  const primaerPort = server.assignedPorts.find((assignment) => assignment.primary);

  return {
    name: containerName,
    image: definition.dockerImage,
    env: {
      ...buildContainerEnv(definition, server.configJson),
      /*
       * Nur bei tatsächlich gesetzten Parametern: Eine leere Variable an jedem
       * Container würde den Fingerabdruck aller bestehenden Container ändern
       * und sie beim nächsten Start einmal umsonst neu bauen (Punkt 114).
       */
      ...(server.startupParameters.trim() === ''
        ? {}
        : { [STARTUP_PARAMETERS_ENV]: server.startupParameters.trim() }),
    },
    command: definition.defaultCommand,
    ports: hostBindings.map((assignment) => ({
      containerPort: assignment.containerPort,
      hostPort: assignment.publicPort,
      protocol: assignment.protocol,
    })),
    resources: {
      memoryMb: server.resourceLimits.ramMb,
      cpuCores: server.resourceLimits.cpuCores,
    },
    dataVolume: {
      hostPath: dataHostPath,
      containerPath: definition.dataVolumeContainerPath,
    },
    readOnlyRootFilesystem: definition.readOnlyRootFilesystem,
    tmpfsPaths: definition.tmpfsPaths,
    labels: {
      'palantir.serverId': server.id,
      /*
       * Nur bei Hostname-Routing, und nur mit einem primären Port: Ohne ihn
       * wüsste der Router kein Ziel, und ein halbes Label wäre schlimmer als
       * keines - der Agent legte eine Routen-Datei an, die ins Leere zeigt.
       */
      ...(routing && primaerPort !== undefined
        ? {
            [VIRTUAL_HOST_HOSTNAME_LABEL]: hostname,
            [VIRTUAL_HOST_TARGET_PORT_LABEL]: String(primaerPort.containerPort),
          }
        : {}),
    },
    stopTimeoutSeconds: definition.stopTimeoutSeconds,
  };
}

/**
 * Fingerabdruck eines Bauplans.
 *
 * Schlüssel werden vor dem Serialisieren sortiert: Zwei Bauplände mit
 * denselben Werten in anderer Reihenfolge sind derselbe Bau, und ein Neuaufbau
 * wegen einer geänderten Objektreihenfolge wäre reine Schikane.
 */
export function containerSpecFingerprint(spec: ContainerCreateSpec): string {
  return createHash('sha256').update(stabilesJson(spec)).digest('hex');
}

/** JSON mit sortierten Schlüsseln; Arrays behalten ihre Reihenfolge. */
function stabilesJson(wert: unknown): string {
  if (wert === null || typeof wert !== 'object') {
    return JSON.stringify(wert) ?? 'null';
  }

  if (Array.isArray(wert)) {
    return `[${wert.map((eintrag) => stabilesJson(eintrag)).join(',')}]`;
  }

  const eintraege = Object.entries(wert as Record<string, unknown>)
    // `undefined` verschwindet in JSON ohnehin; im Fingerabdruck darf es
    // deshalb keinen Unterschied machen, ob ein Feld fehlt oder `undefined` ist.
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([schluessel, value]) => `${JSON.stringify(schluessel)}:${stabilesJson(value)}`);

  return `{${eintraege.join(',')}}`;
}
