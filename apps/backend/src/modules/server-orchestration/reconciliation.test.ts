/**
 * Tests des Soll/Ist-Abgleichs (Pflichtenheft §2.2).
 *
 * Der wichtigste Fall ist der aus dem Pflichtenheft selbst: „z. B. Server, der
 * während der Trennung abgestürzt ist".
 */

import {
  type AgentContainerState,
  type AgentContainerStatus,
  AGENT_CONTAINER_STATUSES,
  SERVER_STATUSES,
  isAllowedServerStatusTransition,
} from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import {
  type ExpectedServer,
  planReconciliation,
  reconciliationTargetStatuses,
} from './reconciliation.js';

const OBSERVED_AT = '2026-08-26T12:00:00.000Z';

function observed(overrides: Partial<AgentContainerState> = {}): AgentContainerState {
  return {
    serverId: 'server-1',
    containerId: 'container-1',
    status: 'running',
    exitCode: null,
    startedAt: OBSERVED_AT,
    observedAt: OBSERVED_AT,
    ...overrides,
  };
}

function expected(overrides: Partial<ExpectedServer> = {}): ExpectedServer {
  return {
    id: 'server-1',
    status: 'running',
    dockerContainerId: 'container-1',
    ...overrides,
  };
}

describe('Soll und Ist passen zusammen', () => {
  it('meldet einen laufenden Server ohne Maßnahme', () => {
    const plan = planReconciliation([expected()], [observed()]);

    expect(plan.actions).toEqual([]);
    expect(plan.unchangedServerIds).toEqual(['server-1']);
  });

  it('meldet einen gestoppten Server ohne Maßnahme', () => {
    const plan = planReconciliation(
      [expected({ status: 'stopped' })],
      [observed({ status: 'exited', exitCode: 0 })],
    );

    expect(plan.actions).toEqual([]);
  });

  it('lässt error und crashed stehen, damit die Ursache sichtbar bleibt', () => {
    for (const status of ['error', 'crashed'] as const) {
      const plan = planReconciliation(
        [expected({ status })],
        [observed({ status: 'exited', exitCode: 1 })],
      );

      expect(plan.actions).toEqual([]);
    }
  });
});

describe('Absturz während der Trennung (Pflichtenheft §2.2)', () => {
  it('erkennt einen laufenden Server, dessen Container mit Fehler beendet ist', () => {
    const plan = planReconciliation(
      [expected({ status: 'running' })],
      [observed({ status: 'exited', exitCode: 137 })],
    );

    expect(plan.actions).toEqual([
      {
        kind: 'markCrashed',
        serverId: 'server-1',
        exitCode: 137,
        reason: 'Der Server ist während der Trennung zum Homeserver abgestürzt.',
      },
    ]);
  });

  it('wertet einen unbekannten Exit-Code als Absturz', () => {
    // „Beendet, Grund unbekannt" ist bei einem Server, der laufen soll, genau
    // der Störfall, für den es diesen Abgleich gibt.
    const plan = planReconciliation(
      [expected({ status: 'running' })],
      [observed({ status: 'dead', exitCode: null })],
    );

    expect(plan.actions[0]?.kind).toBe('markCrashed');
  });

  it('wertet einen sauberen Exit-Code als reguläres Beenden', () => {
    const plan = planReconciliation(
      [expected({ status: 'running' })],
      [observed({ status: 'exited', exitCode: 0 })],
    );

    expect(plan.actions[0]?.kind).toBe('markStopped');
  });

  it('erkennt einen Absturz während des Startvorgangs', () => {
    const plan = planReconciliation(
      [expected({ status: 'starting' })],
      [observed({ status: 'exited', exitCode: 1 })],
    );

    expect(plan.actions[0]?.kind).toBe('markCrashed');
  });
});

describe('Container läuft, Datenbank sagt etwas anderes', () => {
  it('prüft die Erreichbarkeit statt den Server einfach auf running zu setzen', () => {
    // `running` setzt einen bestandenen Health-Check voraus (Pflichtenheft §9).
    for (const status of ['starting', 'stopped', 'error', 'crashed'] as const) {
      const plan = planReconciliation([expected({ status })], [observed({ status: 'running' })]);

      expect(plan.actions[0]?.kind).toBe('verifyHealth');
    }
  });

  it('schickt bei stopping den verlorenen Stopp-Befehl erneut', () => {
    // `stopping → starting` verbietet die Tabelle; der Zielzustand steht bereits
    // in der Datenbank, es fehlt allein der Befehl (orchestration-core-04).
    const plan = planReconciliation(
      [expected({ status: 'stopping' })],
      [observed({ status: 'running' })],
    );

    expect(plan.actions).toEqual([
      {
        kind: 'retryStop',
        serverId: 'server-1',
        reason:
          'Der Stopp-Befehl ging durch die Trennung verloren; der Container läuft noch und wird erneut gestoppt.',
      },
    ]);
  });

  it('schließt bei creating zuerst das Anlegen ab', () => {
    // `creating → starting` verbietet die Tabelle. Der Abschluss des Anlegens
    // ist `creating → stopped`; der nächste Bericht prüft dann die Erreichbarkeit.
    const plan = planReconciliation(
      [expected({ status: 'creating' })],
      [observed({ status: 'running' })],
    );

    expect(plan.actions[0]).toMatchObject({ kind: 'markStopped', viaStopping: false });
  });

  it('behandelt restarting wie laufend', () => {
    const plan = planReconciliation(
      [expected({ status: 'stopped' })],
      [observed({ status: 'restarting' })],
    );

    expect(plan.actions[0]?.kind).toBe('verifyHealth');
  });
});

describe('Container existiert, läuft aber nicht', () => {
  it('schließt das Anlegen ab (creating → stopped)', () => {
    const plan = planReconciliation(
      [expected({ status: 'creating' })],
      [observed({ status: 'created' })],
    );

    expect(plan.actions).toEqual([
      {
        kind: 'markStopped',
        serverId: 'server-1',
        reason: 'Der Container ist angelegt und bereit.',
        viaStopping: false,
      },
    ]);
  });

  it('korrigiert einen als laufend geführten, pausierten Container über stopping', () => {
    const plan = planReconciliation(
      [expected({ status: 'running' })],
      [observed({ status: 'paused' })],
    );

    // `running → stopped` verbietet die Tabelle; der Weg führt über `stopping`.
    expect(plan.actions[0]).toMatchObject({ kind: 'markStopped', viaStopping: true });
  });
});

describe('Container fehlt', () => {
  it('markiert einen Server mit Container-ID, den der Agent nicht kennt', () => {
    const plan = planReconciliation([expected()], []);

    expect(plan.actions).toEqual([
      {
        kind: 'markMissing',
        serverId: 'server-1',
        reason: 'Der Container existiert auf dem Homeserver nicht mehr.',
      },
    ]);
  });

  it('erkennt ein unterbrochenes Anlegen', () => {
    const plan = planReconciliation(
      [expected({ status: 'creating', dockerContainerId: null })],
      [],
    );

    expect(plan.actions[0]?.kind).toBe('markCreateInterrupted');
  });

  it('lässt einen Server ohne erwarteten Container in Ruhe', () => {
    const plan = planReconciliation([expected({ status: 'stopped', dockerContainerId: null })], []);

    expect(plan.actions).toEqual([]);
  });
});

describe('Unklarer Container-Zustand', () => {
  it('fasst unknown und removing nicht an', () => {
    for (const status of ['unknown', 'removing'] as AgentContainerStatus[]) {
      const plan = planReconciliation([expected({ status: 'running' })], [observed({ status })]);

      expect(plan.actions).toEqual([]);
    }
  });
});

describe('Verwaiste Container', () => {
  it('meldet einen Container ohne Server, entfernt ihn aber nicht', () => {
    // Ein verwaister Container kann die letzte Kopie von Weltdaten enthalten;
    // das Aufräumen bleibt eine bewusste Admin-Entscheidung.
    const plan = planReconciliation(
      [],
      [observed({ containerId: 'fremder-container', serverId: null })],
    );

    expect(plan.actions).toEqual([
      {
        kind: 'reportOrphan',
        containerId: 'fremder-container',
        serverId: null,
        reason:
          'Der Homeserver kennt einen Container, zu dem es keinen Server in der Datenbank gibt.',
      },
    ]);
  });

  it('meldet einen bekannten Container nicht als verwaist', () => {
    const plan = planReconciliation([expected()], [observed()]);

    expect(plan.actions.filter((action) => action.kind === 'reportOrphan')).toEqual([]);
  });
});

describe('Der Plan enthält nur Übergänge, die die Tabelle erlaubt (orchestration-core-04)', () => {
  /*
   * Der Kernpunkt des Findings: Plan und ausführbare Übergänge müssen
   * gegeneinander geprüft werden. Bis W2-10 plante der Abgleich Korrekturen wie
   * `stopping → starting` oder `running → stopped`, die
   * `SERVER_STATUS_TRANSITIONS` verbietet – die Ausführung scheiterte still im
   * Log, und der Server hing fest.
   *
   * Dieser Test fährt **alle** Kombinationen aus Soll-Zustand und gemeldetem
   * Container-Zustand ab und läuft die Zustandskette jeder geplanten Maßnahme
   * gegen die Tabelle aus den Contracts.
   */
  it('führt jede Maßnahme über zulässige Zustände', () => {
    for (const status of SERVER_STATUSES) {
      for (const containerStatus of AGENT_CONTAINER_STATUSES) {
        for (const exitCode of [0, 1, null]) {
          const plan = planReconciliation(
            [expected({ status })],
            [observed({ status: containerStatus, exitCode })],
          );

          for (const action of plan.actions) {
            let von = status;

            for (const nach of reconciliationTargetStatuses(action)) {
              // Ein Übergang auf den eigenen Zustand überspringt der Dienst
              // (`verifyHealth` aus `starting`) – alles andere muss zulässig sein.
              if (nach !== von) {
                expect({
                  status,
                  containerStatus,
                  exitCode,
                  kind: action.kind,
                  von,
                  nach,
                  erlaubt: isAllowedServerStatusTransition(von, nach),
                }).toMatchObject({ erlaubt: true });
              }

              von = nach;
            }
          }
        }
      }
    }
  });

  it('lässt einen Server, der bereits auf error steht, ohne Container in Ruhe', () => {
    // `error → error` ist ein Selbstübergang und damit verboten; markiert ist
    // der Server ohnehin schon.
    const plan = planReconciliation([expected({ status: 'error' })], []);

    expect(plan.actions).toEqual([]);
  });
});

describe('Mehrere Server gleichzeitig', () => {
  it('behandelt jeden Server einzeln', () => {
    const plan = planReconciliation(
      [
        expected({ id: 'a', dockerContainerId: 'ca', status: 'running' }),
        expected({ id: 'b', dockerContainerId: 'cb', status: 'running' }),
        expected({ id: 'c', dockerContainerId: 'cc', status: 'stopped' }),
      ],
      [
        observed({ containerId: 'ca', status: 'running' }),
        observed({ containerId: 'cb', status: 'exited', exitCode: 1 }),
        observed({ containerId: 'cc', status: 'exited', exitCode: 0 }),
        observed({ containerId: 'fremd', serverId: null, status: 'running' }),
      ],
    );

    expect(plan.unchangedServerIds).toEqual(['a', 'c']);
    expect(plan.actions.map((action) => action.kind)).toEqual(['markCrashed', 'reportOrphan']);
  });
});
