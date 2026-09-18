/**
 * Platzierungsregel für neue Server ohne ausdrücklich gewählte Node
 * (Review 2026-09-16, Befund 2.3; Lastenheft §6 „für mehrere Nodes vorbereitet").
 *
 * Bis dahin landete ein Server ohne `hostId` auf der **ältesten** Node
 * (`defaultHost()`). Das ist deterministisch, aber kein Kriterium: Ab der
 * zweiten Node füllte sich stillschweigend immer dieselbe, während die neue
 * leer stand.
 *
 * Regel, in dieser Reihenfolge:
 *
 * 1. Nur Nodes, die Arbeit annehmen (`status === 'online'`). Eine Node in
 *    Wartung oder offline bekommt keinen neuen Server – derselbe Grundsatz wie
 *    bei einer ausdrücklich gewählten Node (Gefundener Punkt 109).
 * 2. Darunter die mit dem **meisten freien RAM**: Ausstattung minus Summe der
 *    RAM-Kontingente aller dort angelegten Server, gleich in welchem Zustand.
 *    Dieselbe Zahl wie `capacity.allocated` in der Node-Übersicht – der Platz,
 *    den die Node bereithalten muss, wenn alles gleichzeitig liefe.
 * 3. Bei Gleichstand die **älteste** Node – das bisherige Verhalten bleibt
 *    damit der Rückfall, und eine Installation mit genau einer Node verhält
 *    sich wie zuvor.
 *
 * Reine Funktion ohne Datenbank, damit die Regel für sich prüfbar ist.
 */

export interface PlacementCandidate {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly totalRamMb: number;
  /** Summe der RAM-Kontingente aller angelegten Server dieser Node. */
  readonly allocatedRamMb: number;
  readonly createdAt: Date;
}

/**
 * Wählt die Node für einen neuen Server; `null`, wenn keine Node Arbeit
 * annimmt. Der Aufrufer entscheidet dann, wie er das meldet – siehe
 * `ServerOrchestrationService.resolveHost()`.
 */
export function choosePlacementHost(
  candidates: readonly PlacementCandidate[],
): PlacementCandidate | null {
  let beste: PlacementCandidate | null = null;

  for (const node of candidates) {
    if (node.status !== 'online') {
      continue;
    }

    if (beste === null) {
      beste = node;
      continue;
    }

    const frei = node.totalRamMb - node.allocatedRamMb;
    const freiBeste = beste.totalRamMb - beste.allocatedRamMb;

    if (frei > freiBeste) {
      beste = node;
    } else if (frei === freiBeste && node.createdAt.getTime() < beste.createdAt.getTime()) {
      beste = node;
    }
  }

  return beste;
}
