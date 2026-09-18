/**
 * Kapazitätsprüfung vor jedem Serverstart (Pflichtenheft §10, Lastenheft §3.4).
 *
 * **Zwei Prüfungen, zwei Gewichte:**
 *
 * 1. das optionale Kontingent des Nutzers – jedes seiner Felder ist einzeln
 *    abschaltbar (`null` = kein Limit). Es ist eine **Grenze**: Überschreitung
 *    lehnt ab, unabhängig davon, wie leer die Node ist.
 * 2. der Zustand der Ziel-Node – unabhängig davon, ob das Nutzer-Kontingent
 *    noch Luft hätte. Beim Starten ist das eine **Rückfrage** und keine
 *    Grenze: Der Betreiber darf seine eigene Maschine an den Rand fahren, wenn
 *    er es weiß (`CapacityCheckResult.concerns`). Beim Anlegen zählt davon
 *    einzig der Platz – und der hart, weil ihn die Spieldateien wirklich
 *    belegen.
 *
 * Diese Datei kennt bewusst weder Datenbank noch HTTP und rechnet nur auf
 * übergebenen Werten – sie ist damit vollständig ohne Infrastruktur testbar
 * (Entwicklungsregeln §4, analog zu `rbac/permissions.ts`).
 *
 * **Zählweise der Belegung:** `used` ist stets die Belegung **ohne** den zu
 * prüfenden Server. Wer einen bereits angelegten Server startet, muss dessen
 * Anteil aus der Belegung herausrechnen (`excludeServerId` in
 * {@link ServerUsageRepository}), sonst zählt sein Speicherplatz doppelt.
 */

import {
  type CapacityCheckResult,
  type CapacityScope,
  type CapacityViolation,
  type NodeResourceUsage,
  type NodeResources,
  type RequestedServerResources,
  type ResourceKind,
  type ResourceLowEvent,
  type ResourceWarningThresholds,
  type UserResourceLimits,
  type UserResourceUsage,
  unitForResource,
} from '@palantir/contracts';
import { evaluateNodeWarnings } from './thresholds.js';

/**
 * Toleranz beim Vergleich.
 *
 * Stammt aus der Zeit der CPU-Kontingente, die Fließkommazahlen waren
 * (`0.1 + 0.2 > 0.3` ist in IEEE-754 wahr). RAM und Platte zählen in ganzen
 * MiB; die Toleranz bleibt trotzdem stehen, damit ein exakt ausgeschöpftes
 * Kontingent unter keinen Umständen als überschritten gilt – Gleichstand ist
 * laut Pflichtenheft §10 erlaubt.
 */
const FLOAT_TOLERANCE = 1e-9;

/** Zustand der Ziel-Node zum Zeitpunkt der Prüfung. */
export interface NodeCapacitySnapshot {
  readonly nodeId: string;
  /** `HostNode.totalResources` – die nutzbaren Werte der VM, nicht der Hardware darunter. */
  readonly total: NodeResources;
  /** Belegung durch alle Server aller Nutzer, ohne den zu prüfenden Server. */
  readonly usage: NodeResourceUsage;
  /**
   * **Gemessener** freier Platz auf dem Dateisystem der Node, in MiB.
   *
   * Bis zum Wegfall der Speicherplatz-Zuweisung wurde hier die Summe der
   * zugewiesenen `diskMb` gegen die Gesamtgröße gerechnet – eine Zahl, die mit
   * dem tatsächlich belegten Platz nichts zu tun hatte: Ein Server mit 100 GB
   * Zuweisung und 2 GB Weltdaten blockierte 100 GB, ein anderer durfte über
   * seine Zuweisung hinaus wachsen, ohne dass es jemand merkte.
   *
   * Gemessen wird per `statfs` auf `AGENT_DATA_DIR` (`MeasuredNodeUsage`), also
   * inklusive allem, was neben den Gameservern auf der Node liegt. Genau das
   * ist die Zahl, die entscheidet, ob noch etwas hinpasst.
   *
   * `null` heißt **nicht gemessen** – Node offline, Agent frisch gestartet,
   * Messung veraltet. Dann findet die Platten-Prüfung nicht statt: Ein Anlegen
   * soll nicht daran scheitern, dass eine Auskunft fehlt (Wunsch des
   * Betreibers: „das Erstellen an sich sollte immer klappen"). Die Warnung
   * unten entfällt aus demselben Grund.
   */
  readonly freeDiskMb: number | null;
  /**
   * **Gemessener** freier Arbeitsspeicher der Node, in MiB.
   *
   * Die Gegenzahl zur Buchhaltung: `usage.runningRamMb` ist die Summe der
   * Zuweisungen aller laufenden Server, das hier ist, was `free`/`os.freemem()`
   * auf der Maschine tatsächlich übrig sieht – abzüglich allem, was neben den
   * Gameservern darauf läuft. Beide Richtungen kommen vor: Server, die ihre
   * Zuweisung nicht ausnutzen, lassen mehr frei; ein Datenbankdienst daneben
   * weniger.
   *
   * `null` heißt **nicht gemessen** (Node offline, Messung veraltet) – dann
   * findet diese Prüfung nicht statt.
   */
  readonly freeRamMb: number | null;
}

export interface CapacityCheckInput {
  /** Die Limits, mit denen der Server starten soll (`GameServer.resourceLimits`). */
  readonly requested: RequestedServerResources;
  /** Kontingent des Besitzers; `NO_USER_RESOURCE_LIMITS`, wenn keines gesetzt ist. */
  readonly userLimits: UserResourceLimits;
  /** Belegung durch die übrigen Server des Besitzers. */
  readonly userUsage: UserResourceUsage;
  readonly node: NodeCapacitySnapshot;
  /**
   * Anlass der Prüfung – er entscheidet, welche Feststellung eine Grenze ist
   * und welche eine Rückfrage.
   *
   * `create`: Ein Server wird angelegt. Er läuft danach nicht, verbraucht also
   * weder Arbeitsspeicher noch einen Platz im Kontingent „gleichzeitig
   * laufender Server" – beide zählen ausdrücklich nur laufende
   * (`ResourceQuotaCounting`). Was er sofort belegt, ist Plattenplatz, sobald
   * der erste Start die Spieldateien holt. Deshalb ist der Platz beim Anlegen
   * die **einzige** harte Schranke (Wunsch des Betreibers: „das Erstellen an
   * sich sollte immer klappen bzw. beim Erstellen nur die Speicherkapazität
   * prüfen").
   *
   * `start`: Jetzt zählt alles. Das Kontingent des Nutzers bleibt eine harte
   * Grenze – sie hat ein Administrator gesetzt. Die Enge der Node wandert
   * dagegen nach `concerns`: Ob er seine eigene Maschine an den Rand fährt,
   * entscheidet der Betreiber, nicht das Panel.
   */
  readonly intent: 'create' | 'start';
  readonly thresholds: ResourceWarningThresholds;
  /** Zeitstempel für die Warn-Nutzlasten – injizierbar, damit Tests nicht von der Uhr abhängen. */
  readonly at?: Date;
}

/** Überschritten ist eine Grenze erst, wenn `used + requested` echt größer ist – Gleichstand ist erlaubt. */
function exceeds(used: number, requested: number, limit: number): boolean {
  return used + requested > limit + FLOAT_TOLERANCE;
}

function toViolation(
  scope: CapacityScope,
  resource: ResourceKind,
  limit: number,
  used: number,
  requested: number,
): CapacityViolation {
  return { scope, resource, unit: unitForResource(resource), limit, used, requested };
}

/**
 * Beide Prüfungen aus Pflichtenheft §10 – getrennt nach Grenze und Rückfrage.
 *
 * Das Ergebnis hat zwei Listen, und der Unterschied ist einer der
 * Zuständigkeit (siehe {@link CapacityCheckInput.intent}):
 *
 * - `violations` – eine **Grenze**, die jemand gesetzt hat. Der Vorgang wird
 *   abgelehnt; `allowed` ist dann `false`.
 * - `concerns` – eine **Beobachtung** über den Zustand der Node. Der Vorgang
 *   bleibt erlaubt; wer will, fragt vorher nach.
 *
 * Es wird nicht beim ersten Treffer abgebrochen: die Antwort nennt **alle**
 * Feststellungen, damit der Betreiber nicht nach jeder Anpassung erneut in
 * dieselbe Ablehnung läuft.
 *
 * Warnungen entstehen nur, wenn der Start erlaubt ist. Sie beschreiben die
 * Auslastung der Node **nach** diesem Start – eine Warnung zu einem Start, der
 * gar nicht stattfindet, wäre irreführend.
 */
export function checkCapacity(input: CapacityCheckInput): CapacityCheckResult {
  const { intent, node, requested, thresholds, userLimits, userUsage } = input;
  const violations: CapacityViolation[] = [];
  const concerns: CapacityViolation[] = [];

  /*
   * Die Platte gegen die **Messung**, nicht gegen Zuweisungen (siehe
   * `NodeCapacitySnapshot.freeDiskMb`). `used` ist der tatsächlich belegte
   * Platz, damit die Meldung dieselbe Sprache spricht wie die übrigen:
   * „belegt X + angefordert Y > Grenze Z".
   */
  const belegterPlatzMb = node.freeDiskMb === null ? null : node.total.diskMb - node.freeDiskMb;
  const platzKnapp =
    belegterPlatzMb !== null && exceeds(belegterPlatzMb, requested.diskMb, node.total.diskMb);

  if (intent === 'create') {
    /*
     * Anlegen prüft nur den Platz – und den hart. Ein angelegter Server läuft
     * nicht: Er belegt kein RAM und keinen Platz im Kontingent „gleichzeitig
     * laufender Server". Was er belegt, sind die Spieldateien, sobald der erste
     * Start sie holt; dafür muss der Platz da sein.
     */
    if (platzKnapp && belegterPlatzMb !== null) {
      violations.push(
        toViolation('nodeMeasured', 'disk', node.total.diskMb, belegterPlatzMb, requested.diskMb),
      );
    }

    return { allowed: violations.length === 0, violations, warnings: [], concerns };
  }

  // --- 1. Nutzer-Kontingent: harte Grenze, ein Administrator hat sie gesetzt.
  //
  // Nur noch die Anzahl gleichzeitiger Server (Betreiber-Entscheidung
  // 2026-09-18, „RAM ist keine Kontingentgroesse mehr"): Die RAM-Zuweisung
  // eines Servers ist seitdem eine weiche Grenze, ein Server nimmt sich, was
  // auf der Node frei ist. `maxRamMb` bleibt im Datensatz, wird aber nicht
  // mehr geprueft.
  if (
    userLimits.maxConcurrentServers !== null &&
    exceeds(userUsage.runningServers, 1, userLimits.maxConcurrentServers)
  ) {
    violations.push(
      toViolation('user', 'servers', userLimits.maxConcurrentServers, userUsage.runningServers, 1),
    );
  }

  // --- 2. Zustand der Node: Rückfrage, keine Grenze ------------------------
  //
  // Nur noch aus der **Messung**: Die Summe der Zuweisungen sagt seit der
  // weichen Grenze nichts mehr darueber, wie voll die Node ist – ein Server
  // mit 2 GiB Zuweisung darf 10 GiB belegen. Was zaehlt, ist der gemessene
  // freie Speicher; ohne Messung gibt es keine Rueckfrage.

  /*
   * „Der aktuell frei verfügbare RAM reicht nicht" – gemessen, nicht gebucht.
   * Das ist die Zahl, an der ein Start wirklich scheitert: Der Kernel gibt
   * keinen Speicher her, den es nicht gibt, egal wie die Buchhaltung aussieht.
   * Gerechnet wird in derselben Form wie überall sonst (belegt + angefordert >
   * Grenze), damit die Meldung nicht aus der Reihe fällt.
   */
  if (node.freeRamMb !== null) {
    const belegterRamMb = Math.max(0, node.total.ramMb - node.freeRamMb);

    if (exceeds(belegterRamMb, requested.ramMb, node.total.ramMb)) {
      concerns.push(
        toViolation('nodeMeasured', 'ram', node.total.ramMb, belegterRamMb, requested.ramMb),
      );
    }
  }

  if (platzKnapp && belegterPlatzMb !== null) {
    concerns.push(
      toViolation('nodeMeasured', 'disk', node.total.diskMb, belegterPlatzMb, requested.diskMb),
    );
  }

  const allowed = violations.length === 0;
  const warnings: ResourceLowEvent[] = allowed
    ? evaluateNodeWarnings({
        nodeId: node.nodeId,
        total: node.total,
        usage: projectUsageAfterStart(node.usage, requested),
        // Auch die Warnung rechnet mit dem Platz **nach** diesem Start – und
        // beim RAM mit der Messung plus der Zuweisung des neuen Servers.
        usedRamMb:
          node.freeRamMb === null
            ? null
            : Math.max(0, node.total.ramMb - node.freeRamMb) + requested.ramMb,
        usedDiskMb: belegterPlatzMb === null ? null : belegterPlatzMb + requested.diskMb,
        thresholdPercent: thresholds.nodePercent,
        ...(input.at ? { at: input.at } : {}),
      })
    : [];

  return { allowed, violations, warnings, concerns };
}

/** Belegung der Node, wie sie nach dem geprüften Start aussähe. */
function projectUsageAfterStart(
  usage: NodeResourceUsage,
  requested: RequestedServerResources,
): NodeResourceUsage {
  return {
    runningRamMb: usage.runningRamMb + requested.ramMb,
    runningServers: usage.runningServers + 1,
    totalServers: usage.totalServers + 1,
  };
}
