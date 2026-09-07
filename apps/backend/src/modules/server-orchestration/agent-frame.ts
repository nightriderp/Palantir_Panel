/**
 * Eingangsprüfung der Frames auf dem Agent-Kanal (Audit W2-30).
 *
 * Der Agent-Kanal ist die wichtigste Vertrauensgrenze des Panels: Hinter ihm
 * steht ein Prozess, der auf dem Homeserver Container startet, Dateien schreibt
 * und Weltdaten liest. Das Pre-Shared-Token und die Quelladressen-Prüfung
 * (`agent-route.ts`) entscheiden, **wer** reden darf; hier steht, **was** ein
 * Gegenüber sagen darf, das diese beiden Hürden genommen hat.
 *
 * Zwei Punkte aus dem Audit stehen dahinter:
 *
 * - `security-matrix-07`: Nutzlasten ohne Größengrenze. Die Form einer
 *   Ereignis-Nutzlast bleibt offen, und die Konsolenzeile daraus wird an alle
 *   Abonnenten gefächert. Ohne Grenze am Frame hängt die Obergrenze allein an
 *   `maxPayload` der WebSocket-Bibliothek (Standard: 100 MiB). Die Grenze ist
 *   deshalb zweistufig: eng für alles, was der Agent von sich aus schickt, weit
 *   genug für das eine Ergebnis, das legitim groß wird (`FILE_READ`). Seit dem
 *   Contracts-Nachzug W2-C2 kommt eine dritte Stufe dazu: `agentEventFrameSchema`
 *   begrenzt jedes **einzelne** Textfeld einer Nutzlast
 *   (`AGENT_EVENT_PAYLOAD_MAX_STRING_LENGTH`) – vorher durfte eine einzige
 *   Konsolenzeile den ganzen Frame-Rahmen ausfüllen (Fundpunkt 145).
 * - `contract-drift-05`: Der Ist-Zustands-Bericht wird bisher als Ganzes gegen
 *   `agentToBackendFrameSchema` geprüft. Ein einziges unbrauchbares Nebenfeld –
 *   `cpuCores: 0` auf einer Plattform, auf der `os.cpus()` leer bleibt, oder
 *   ein fremder Container mit einem Nicht-UUID-Label `palantir.serverId` – kippt
 *   den kompletten Bericht. Der Soll/Ist-Abgleich läuft dann nie, obwohl die
 *   Node als verbunden geführt wird.
 *
 * Deshalb wird der Bericht hier **feldweise** gelesen: Der Kern (Anlass,
 * Zeitpunkt, Container-Zustände) muss stimmen, alles daneben darf fehlen.
 */

import {
  type AgentContainerState,
  type AgentNodeStats,
  type AgentStateReportFrame,
} from '@palantir/contracts';
import {
  agentContainerStateSchema,
  agentNodeStatsSchema,
  agentToBackendFrameSchema,
  isoTimestampSchema,
} from '@palantir/validation';
import { z } from 'zod';
import { AGENT_FILE_CHANNEL_MAX_BYTES } from './files.js';

/**
 * Größte zulässige Nutzlast eines Frames, den der Agent **von sich aus** schickt
 * (`hello`, `event`, `stateReport`).
 *
 * 1 MiB, bewusst als feste Grenze und nicht als Konfigurationsvariable
 * (CLAUDE.md §8: lieber eine begründete Grenze als ein weiterer Schalter, den
 * niemand richtig setzt). Der größte reguläre Frame dieser Art ist der
 * Ist-Zustands-Bericht: Ein `AgentContainerState` wiegt als JSON rund 200 Byte,
 * eine Node mit 1000 Containern kommt damit auf etwa 200 KiB. Konsolenzeilen
 * sind noch kleiner – die Container-Engine schneidet Log-Blöcke bei 16 KiB.
 * 1 MiB lässt also mindestens den fünffachen Spielraum gegenüber dem größten
 * realistischen Frame und begrenzt zugleich, was ein übernommener Agent je
 * Frame in das Backend schieben kann.
 */
export const MAX_AGENT_FRAME_BYTES = 1_048_576;

/**
 * Größte zulässige Nutzlast eines `commandResult`.
 *
 * Befehlsergebnisse fallen aus der 1-MiB-Grenze heraus, und zwar nicht knapp:
 * `FILE_READ` liefert den Dateiinhalt als Base64 in **einem** Frame, und die
 * Grenze dafür steht bereits bei {@link AGENT_FILE_CHANNEL_MAX_BYTES} (64 MiB) –
 * der Agent lehnt erst darüber mit `AGENT_FILE_TOO_LARGE` ab. Eine pauschale
 * 1-MiB-Grenze hätte deshalb jeden Download und jedes Öffnen einer Datei über
 * rund 768 KiB nicht etwa abgelehnt, sondern die Agent-Verbindung der ganzen
 * Node beendet.
 *
 * Der Wert wird deshalb aus der Datei-Grenze abgeleitet statt daneben gestellt:
 * Base64 bläht um 4/3 auf, dazu kommt die JSON-Hülle (Korrelations-Id,
 * Befehlsname, Pfad). 64 KiB Zuschlag decken die Hülle mit reichlich Abstand ab.
 * Ergebnis sind rund 85,4 MiB – unter dem `maxPayload`-Standard von `ws`
 * (100 MiB), damit die Grenze hier greift und nicht dort. Wird die Datei-Grenze
 * einmal angehoben, zieht diese Grenze mit; erst oberhalb von 71 MiB Dateigröße
 * müsste auch `maxPayload` nachgezogen werden.
 *
 * Diese Grenze gilt nur, solange das Backend tatsächlich auf ein Ergebnis
 * wartet (siehe `AgentSession.handleMessage`): Auf einer Verbindung ohne
 * offenen Befehl bleibt es bei {@link MAX_AGENT_FRAME_BYTES}.
 */
export const MAX_AGENT_COMMAND_RESULT_BYTES =
  Math.ceil(AGENT_FILE_CHANNEL_MAX_BYTES / 3) * 4 + 64 * 1024;

/**
 * Close-Code für einen zu großen Frame.
 *
 * 1009 („Message Too Big") ist der Standard-Code aus RFC 6455 – der Agent
 * behandelt jeden Code außer 4401 (`CLOSE_CODE_UNAUTHORIZED`) als
 * „Backend gerade weg" und verbindet sich mit Backoff neu
 * (`apps/agent/src/connection/websocket-transport.ts`). Genau das ist hier
 * gewollt: Ein Agent, der einmal zu viel schickt, soll wiederkommen dürfen.
 */
export const CLOSE_CODE_FRAME_TOO_LARGE = 1009;

/** Frame-Union, wie `@palantir/validation` sie liest. */
type GepruefterFrame = z.infer<typeof agentToBackendFrameSchema>;

/** Alle Frames außer dem Ist-Zustands-Bericht – der wird gesondert gelesen. */
export type EinfacherAgentFrame = Exclude<GepruefterFrame, { kind: 'stateReport' }>;

/** Was beim feldweisen Lesen eines Ist-Zustands-Berichts liegen blieb. */
export interface StateReportBefund {
  /** Einträge, die gar nicht lesbar waren und deshalb fehlen. */
  readonly verworfeneContainer: number;
  /** Einträge, deren `serverId` unbrauchbar war und auf `null` gesetzt wurde. */
  readonly bereinigteServerIds: number;
  /** `true`, wenn die gemeldeten Node-Messwerte unbrauchbar waren. */
  readonly nodeStatsVerworfen: boolean;
}

export type AgentFrameParse =
  | { readonly ok: true; readonly kind: 'other'; readonly frame: EinfacherAgentFrame }
  | {
      readonly ok: true;
      readonly kind: 'stateReport';
      readonly frame: AgentStateReportFrame;
      readonly befund: StateReportBefund;
    }
  | { readonly ok: false; readonly issues: readonly z.ZodIssue[] };

/**
 * `kind` eines noch ungeprüften Frames.
 *
 * Nur für zwei Vorentscheidungen gedacht, die vor der eigentlichen Prüfung
 * fallen müssen: „vor dem Handshake verwerfen" und „Ist-Zustands-Bericht
 * feldweise lesen". Für alles andere gilt weiter das Schema.
 */
export function frameKindOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const kind = (value as { kind?: unknown }).kind;

  return typeof kind === 'string' ? kind : null;
}

/**
 * Hülle des Ist-Zustands-Berichts: der Teil, der stimmen **muss**.
 *
 * Ohne Anlass und Zeitpunkt ist der Bericht nicht auswertbar, und `containers`
 * muss eine Liste sein – sonst wäre „keine Container gemeldet" nicht von
 * „Feld kaputt" zu unterscheiden, und der Abgleich würde jeden laufenden Server
 * als verschwunden behandeln. Die Einträge selbst bleiben hier `unknown` und
 * werden einzeln geprüft.
 */
const stateReportHuelleSchema = z.object({
  kind: z.literal('stateReport'),
  reason: z.enum(['connected', 'requested']),
  containers: z.array(z.unknown()),
  nodeStats: z.unknown().optional(),
  reportedAt: isoTimestampSchema,
});

/**
 * Liest einen eingehenden Frame.
 *
 * Für alle Frames außer dem Ist-Zustands-Bericht bleibt es beim bisherigen
 * Verhalten: Das Schema entscheidet, ein Verstoß verwirft den ganzen Frame.
 * Beim Bericht wird der Kern gerettet (contract-drift-05).
 */
export function parseAgentFrame(value: unknown): AgentFrameParse {
  if (frameKindOf(value) !== 'stateReport') {
    const geprueft = agentToBackendFrameSchema.safeParse(value);

    if (!geprueft.success) {
      return { ok: false, issues: geprueft.error.issues };
    }

    // `stateReport` ist oben bereits ausgeschlossen; der Rest der Union bleibt.
    return { ok: true, kind: 'other', frame: geprueft.data as EinfacherAgentFrame };
  }

  const huelle = stateReportHuelleSchema.safeParse(value);

  if (!huelle.success) {
    return { ok: false, issues: huelle.error.issues };
  }

  const containers: AgentContainerState[] = [];
  let verworfeneContainer = 0;
  let bereinigteServerIds = 0;

  for (const eintrag of huelle.data.containers) {
    const genau = agentContainerStateSchema.safeParse(eintrag);

    if (genau.success) {
      containers.push(genau.data);
      continue;
    }

    /*
     * Zweiter Versuch ohne `serverId`. Der häufigste Grund für einen
     * unlesbaren Eintrag ist genau dieses Feld: Der Agent liest es aus dem
     * Container-Label `palantir.serverId`, und ein fremder Container auf
     * derselben Node kann dort alles stehen haben. Der Abgleich ordnet über
     * die Container-Id zu (`reconciliation.ts`), `serverId` dient dort nur der
     * Meldung verwaister Container – der Eintrag ist ohne sie also weiterhin
     * brauchbar. Ihn wegzuwerfen hieße dagegen: Der Abgleich sieht den
     * Container nicht und hält den zugehörigen Server für verschwunden.
     */
    if (typeof eintrag === 'object' && eintrag !== null && !Array.isArray(eintrag)) {
      const ohneServerId = agentContainerStateSchema.safeParse({
        ...(eintrag as Record<string, unknown>),
        serverId: null,
      });

      if (ohneServerId.success) {
        containers.push(ohneServerId.data);
        bereinigteServerIds += 1;
        continue;
      }
    }

    verworfeneContainer += 1;
  }

  /*
   * `nodeStats` ist laut Vertrag additiv („ein Agent, der sie noch nicht
   * liefert, bleibt gültig"). Genau so werden unbrauchbare Werte behandelt:
   * weglassen statt den Bericht kippen – das Backend behält dann seinen
   * zuletzt bekannten Stand.
   */
  let nodeStats: AgentNodeStats | undefined;
  let nodeStatsVerworfen = false;

  if (huelle.data.nodeStats !== undefined) {
    const gemessen = agentNodeStatsSchema.safeParse(huelle.data.nodeStats);

    if (gemessen.success) {
      nodeStats = gemessen.data;
    } else {
      nodeStatsVerworfen = true;
    }
  }

  const frame: AgentStateReportFrame = {
    kind: 'stateReport',
    reason: huelle.data.reason,
    containers,
    ...(nodeStats === undefined ? {} : { nodeStats }),
    reportedAt: huelle.data.reportedAt,
  };

  return {
    ok: true,
    kind: 'stateReport',
    frame,
    befund: { verworfeneContainer, bereinigteServerIds, nodeStatsVerworfen },
  };
}

/** `true`, wenn beim Lesen des Berichts etwas liegen blieb (dann wird geloggt). */
export function hatBefund(befund: StateReportBefund): boolean {
  return (
    befund.verworfeneContainer > 0 || befund.bereinigteServerIds > 0 || befund.nodeStatsVerworfen
  );
}
