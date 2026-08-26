/**
 * Soll/Ist-Abgleich nach Reconnect des Agents (Pflichtenheft §2.2).
 *
 * „Nach Wiederverbindung meldet der Agent den vollständigen Ist-Zustand aller
 * ihm bekannten Container, das Backend gleicht diesen mit dem in der Datenbank
 * erwarteten Soll-Zustand ab und korrigiert Abweichungen (z. B. Server, der
 * während der Trennung abgestürzt ist)."
 *
 * Hier steht ausschließlich die **Planung**: aus Soll und Ist entsteht eine
 * Liste von Maßnahmen. Ausgeführt werden sie vom Dienst (`service.ts`), der
 * dafür die State Machine und den Agent benutzt. Die Trennung ist Absicht –
 * so ist der heikelste Teil (was passiert mit einem Server, der während der
 * Trennung abgestürzt ist?) ohne Datenbank und ohne Homeserver prüfbar
 * (CLAUDE.md §4).
 *
 * **Zuordnung Container-Zustand → Lifecycle-Zustand:** Der Agent meldet die
 * beobachtbaren Container-Zustände (`AGENT_CONTAINER_STATUSES`), nicht die
 * Lifecycle-Zustände aus Pflichtenheft §9 – die Auslegung liegt hier
 * (WORK_STATUS „Gefundene Punkte" Nr. 18).
 */

import { type AgentContainerState, type ServerStatus } from '@palantir/contracts';

/** Der Teil eines Servers, den der Abgleich braucht (Soll-Seite). */
export interface ExpectedServer {
  readonly id: string;
  readonly status: ServerStatus;
  /** `null`, solange der Container nicht angelegt wurde. */
  readonly dockerContainerId: string | null;
}

/**
 * Eine Maßnahme des Abgleichs.
 *
 * Bewusst beschreibend und nicht ausführend: Der Plan lässt sich vollständig
 * protokollieren, bevor irgendetwas passiert.
 */
export type ReconciliationAction =
  /**
   * Der Container ist während der Trennung abgestürzt. Der Dienst meldet der
   * State Machine `crashed`; der Crash-Loop-Schutz entscheidet danach über
   * einen automatischen Neustart.
   */
  | {
      readonly kind: 'markCrashed';
      readonly serverId: string;
      readonly exitCode: number | null;
      readonly reason: string;
    }
  /** Der Container ist sauber beendet – der Soll-Zustand wird nachgezogen. */
  | { readonly kind: 'markStopped'; readonly serverId: string; readonly reason: string }
  /**
   * Der Container läuft, obwohl die Datenbank etwas anderes sagt.
   *
   * Bewusst **kein** direktes `markRunning`: `running` setzt einen bestandenen
   * Health-Check voraus (Pflichtenheft §9). Der Dienst prüft die
   * Erreichbarkeit und meldet erst danach `healthCheckPassed` – oder
   * `healthCheckFailed`, wenn der Container zwar läuft, aber nichts antwortet.
   */
  | { readonly kind: 'verifyHealth'; readonly serverId: string; readonly reason: string }
  /**
   * Der Server hat eine Container-ID, der Agent kennt den Container aber nicht
   * (mehr). Das ist kein Absturz, sondern ein Datenverlust auf dem Homeserver –
   * er wird als `error` markiert, damit jemand hinsieht.
   */
  | { readonly kind: 'markMissing'; readonly serverId: string; readonly reason: string }
  /**
   * Das Anlegen wurde durch die Trennung unterbrochen: Der Server steht auf
   * `creating`, ein Container existiert aber nicht.
   */
  | { readonly kind: 'markCreateInterrupted'; readonly serverId: string; readonly reason: string }
  /**
   * Der Agent kennt einen Container, zu dem es keinen Server gibt.
   *
   * Wird ausschließlich **gemeldet**, nie automatisch entfernt: Ein verwaister
   * Container kann die letzte Kopie von Weltdaten enthalten. Das Aufräumen ist
   * eine bewusste Admin-Entscheidung (Storage-Explorer, B8).
   */
  | {
      readonly kind: 'reportOrphan';
      readonly containerId: string;
      readonly serverId: string | null;
      readonly reason: string;
    };

export interface ReconciliationPlan {
  readonly actions: readonly ReconciliationAction[];
  /** Server, deren Soll- und Ist-Zustand zusammenpassen – nur fürs Log. */
  readonly unchangedServerIds: readonly string[];
}

/** Container-Zustände, in denen der Container tatsächlich läuft. */
function isLive(state: AgentContainerState): boolean {
  return state.status === 'running' || state.status === 'restarting';
}

/** Container-Zustände, in denen der Container beendet ist. */
function isTerminated(state: AgentContainerState): boolean {
  return state.status === 'exited' || state.status === 'dead';
}

/**
 * Ein beendeter Container gilt als abgestürzt, wenn er nicht mit `0` beendet
 * wurde.
 *
 * Ein unbekannter Exit-Code (`null`) wird als Absturz gewertet: Bei einem
 * Server, für den die Datenbank `running` sagt, ist „beendet, Grund unbekannt"
 * der Störfall – ihn stillschweigend als sauber gestoppt zu verbuchen, würde
 * genau den Fall verschlucken, für den es diesen Abgleich gibt.
 */
function looksLikeCrash(state: AgentContainerState): boolean {
  return state.exitCode !== 0;
}

/**
 * Baut den Abgleichsplan.
 *
 * @param expected Soll-Zustand aus der Datenbank – **alle** Server der Node.
 * @param observed Ist-Zustand, wie der Agent ihn vollständig gemeldet hat.
 */
export function planReconciliation(
  expected: readonly ExpectedServer[],
  observed: readonly AgentContainerState[],
): ReconciliationPlan {
  const byContainerId = new Map<string, AgentContainerState>();

  for (const state of observed) {
    byContainerId.set(state.containerId, state);
  }

  const knownContainerIds = new Set(
    expected
      .map((server) => server.dockerContainerId)
      .filter((id): id is string => id !== null && id.length > 0),
  );

  const actions: ReconciliationAction[] = [];
  const unchangedServerIds: string[] = [];

  for (const server of expected) {
    const action = planForServer(server, byContainerId);

    if (action === null) {
      unchangedServerIds.push(server.id);
      continue;
    }

    actions.push(action);
  }

  for (const state of observed) {
    if (!knownContainerIds.has(state.containerId)) {
      actions.push({
        kind: 'reportOrphan',
        containerId: state.containerId,
        serverId: state.serverId,
        reason:
          'Der Homeserver kennt einen Container, zu dem es keinen Server in der Datenbank gibt.',
      });
    }
  }

  return { actions, unchangedServerIds };
}

function planForServer(
  server: ExpectedServer,
  byContainerId: ReadonlyMap<string, AgentContainerState>,
): ReconciliationAction | null {
  const state =
    server.dockerContainerId === null ? undefined : byContainerId.get(server.dockerContainerId);

  if (state === undefined) {
    return planForMissingContainer(server);
  }

  // Ein Container, dessen Zustand der Agent nicht ermitteln kann, wird nicht
  // angefasst: Beim nächsten Bericht ist er entweder wieder lesbar oder weg.
  if (state.status === 'unknown' || state.status === 'removing') {
    return null;
  }

  if (isLive(state)) {
    return planForLiveContainer(server);
  }

  if (isTerminated(state)) {
    return planForTerminatedContainer(server, state);
  }

  // `created` und `paused`: Der Container existiert, läuft aber nicht.
  return planForIdleContainer(server);
}

function planForMissingContainer(server: ExpectedServer): ReconciliationAction | null {
  if (server.dockerContainerId === null) {
    if (server.status === 'creating') {
      return {
        kind: 'markCreateInterrupted',
        serverId: server.id,
        reason:
          'Das Anlegen wurde durch eine Verbindungstrennung unterbrochen; auf dem Homeserver ist kein Container entstanden.',
      };
    }

    // Kein Container erwartet, keiner da – nichts zu tun.
    return null;
  }

  return {
    kind: 'markMissing',
    serverId: server.id,
    reason: 'Der Container existiert auf dem Homeserver nicht mehr.',
  };
}

function planForLiveContainer(server: ExpectedServer): ReconciliationAction | null {
  switch (server.status) {
    case 'running':
      // Soll und Ist passen. Ob der Server auch antwortet, prüft der reguläre
      // Health-Check – nicht dieser Abgleich.
      return null;
    case 'starting':
      return {
        kind: 'verifyHealth',
        serverId: server.id,
        reason: 'Der Container lief beim Wiederverbinden bereits; die Erreichbarkeit wird geprüft.',
      };
    case 'stopping':
      return {
        kind: 'verifyHealth',
        serverId: server.id,
        reason:
          'Der Stopp-Befehl ging durch die Trennung verloren; der Container läuft noch und wird erneut bewertet.',
      };
    default:
      return {
        kind: 'verifyHealth',
        serverId: server.id,
        reason: `Der Container läuft, obwohl der Server als "${server.status}" geführt wird.`,
      };
  }
}

function planForTerminatedContainer(
  server: ExpectedServer,
  state: AgentContainerState,
): ReconciliationAction | null {
  switch (server.status) {
    case 'stopped':
    case 'error':
    case 'crashed':
      // Beendet und als beendet geführt – nichts zu korrigieren. `error` und
      // `crashed` bleiben stehen, damit die Ursache sichtbar bleibt.
      return null;
    case 'stopping':
      return {
        kind: 'markStopped',
        serverId: server.id,
        reason: 'Der Container wurde während der Trennung beendet.',
      };
    case 'creating':
      return {
        kind: 'markStopped',
        serverId: server.id,
        reason: 'Der Container wurde angelegt, ist aber noch nie gelaufen.',
      };
    default:
      // `running` oder `starting`: Der Server sollte laufen, tut es aber nicht.
      if (looksLikeCrash(state)) {
        return {
          kind: 'markCrashed',
          serverId: server.id,
          exitCode: state.exitCode,
          reason: 'Der Server ist während der Trennung zum Homeserver abgestürzt.',
        };
      }

      return {
        kind: 'markStopped',
        serverId: server.id,
        reason: 'Der Server wurde während der Trennung zum Homeserver regulär beendet.',
      };
  }
}

function planForIdleContainer(server: ExpectedServer): ReconciliationAction | null {
  switch (server.status) {
    case 'stopped':
    case 'error':
    case 'crashed':
      return null;
    case 'creating':
      // Container angelegt, noch nie gestartet – genau der erwartete Abschluss
      // des Anlegens (Pflichtenheft §9: `creating → stopped`).
      return {
        kind: 'markStopped',
        serverId: server.id,
        reason: 'Der Container ist angelegt und bereit.',
      };
    default:
      return {
        kind: 'markStopped',
        serverId: server.id,
        reason: `Der Container läuft nicht, obwohl der Server als "${server.status}" geführt wird.`,
      };
  }
}
