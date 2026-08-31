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

export interface BuildContainerSpecInput {
  readonly server: ServerRecord;
  readonly definition: GameTypeDefinition;
  readonly containerName: string;
  readonly dataHostPath: string;
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
}: BuildContainerSpecInput): ContainerCreateSpec {
  return {
    name: containerName,
    image: definition.dockerImage,
    env: buildContainerEnv(definition, server.configJson),
    command: definition.defaultCommand,
    ports: server.assignedPorts.map((assignment) => ({
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
    labels: { 'palantir.serverId': server.id },
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
