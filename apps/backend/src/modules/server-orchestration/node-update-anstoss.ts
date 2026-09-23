import type { AgentCommandPayloads, AgentCommandResults } from '@palantir/contracts';

/**
 * Anstoß zur Selbstaktualisierung einer Node (Gefundener Punkt 342).
 *
 * Bis dahin fragte jede Gamenode per systemd-Timer alle fünf Minuten nach, ob
 * sich der Zweig `prod` bewegt hat. Jetzt entscheidet das Backend beim
 * Verbinden eines Agents: Weicht dessen Stand vom eigenen ab, klingelt es mit
 * `UPDATE_AVAILABLE`. Das passiert nach jedem Ausrollen von selbst - das
 * Backend startet neu, der Agent verbindet neu -, ebenso nach einem Neustart
 * der Node oder wenn sie beim Ausrollen offline war.
 *
 * Die Klingel sagt nur, **dass** es etwas gibt. Was installiert wird,
 * entscheidet weiter `update.sh` auf der Node anhand des signierten Tags.
 */

/** Stellen des Commits, die der Agent an seine Version hängt (`apps/agent/src/version.ts`). */
const STAND_STELLEN = 12;

/**
 * Commit aus der gemeldeten Agent-Version (`0.6.0+dce821c77236`).
 *
 * `null`, wenn der Agent keinen Stand meldet - etwa, weil jemand den Stapel
 * von Hand ohne `update.sh` gestartet hat und `AGENT_COMMIT` dabei leer blieb.
 */
export function standAusAgentVersion(agentVersion: string): string | null {
  const treffer = /\+([0-9a-f]{7,40})$/.exec(agentVersion.trim().toLowerCase());

  return treffer?.[1] ?? null;
}

/**
 * Braucht die Node einen Anstoß?
 *
 * - Ohne eigenen Stand (Entwicklung, Start ohne `deploy.sh`) nie: Dann gibt es
 *   nichts, womit sich vergleichen ließe.
 * - Meldet der Agent keinen Stand, ja: `update.sh` merkt dann selbst, dass
 *   nichts zu tun ist, und beendet sich nach einem `git fetch`. Ohne Anstoß
 *   bliebe eine so gestartete Node dagegen für immer stehen.
 * - Sonst genau dann, wenn die Stände auseinanderliegen. Verglichen wird auf
 *   der Länge, die der Agent meldet.
 */
export function brauchtUpdateAnstoss(
  agentVersion: string,
  backendCommit: string | undefined,
): boolean {
  if (backendCommit === undefined) {
    return false;
  }

  const agentStand = standAusAgentVersion(agentVersion);

  if (agentStand === null) {
    return true;
  }

  return !backendCommit.startsWith(agentStand.slice(0, STAND_STELLEN));
}

export interface UpdateAnstossDeps {
  /** Eigener ausgerollter Commit (`PALANTIR_COMMIT`); `undefined` = unbekannt. */
  readonly backendCommit: string | undefined;
  /** Zuletzt gemeldete Agent-Version dieser Node; `null`, wenn keine vorliegt. */
  readonly agentVersion: string | null;
  readonly send: (
    payload: AgentCommandPayloads['UPDATE_AVAILABLE'],
  ) => Promise<AgentCommandResults['UPDATE_AVAILABLE']>;
  readonly log: {
    info(bindings: Record<string, unknown>, message: string): void;
    warn(bindings: Record<string, unknown>, message: string): void;
  };
}

/**
 * Vergleicht die Stände und klingelt, wenn nötig.
 *
 * Liefert, ob geklingelt wurde - für die Tests. Fehler gehen an den Aufrufer;
 * `onConnected` fängt sie, damit eine ausgebliebene Klingel nie die gerade
 * aufgebaute Verbindung kostet.
 */
export async function stosseNodeUpdateAn(
  hostId: string,
  deps: UpdateAnstossDeps,
): Promise<boolean> {
  const { backendCommit, agentVersion } = deps;

  if (agentVersion === null || backendCommit === undefined) {
    return false;
  }

  if (!brauchtUpdateAnstoss(agentVersion, backendCommit)) {
    return false;
  }

  const ergebnis = await deps.send({ targetCommit: backendCommit });

  if (ergebnis.signaled) {
    deps.log.info(
      { hostId, agentVersion, backendCommit: backendCommit.slice(0, STAND_STELLEN) },
      'Node ist aelter als das Backend - Update angestossen',
    );
  } else {
    deps.log.warn(
      { hostId, agentVersion, backendCommit: backendCommit.slice(0, STAND_STELLEN) },
      'Node ist aelter als das Backend, kennt aber keinen Anstoss-Ordner - sie aktualisiert sich nicht von selbst',
    );
  }

  return ergebnis.signaled;
}
