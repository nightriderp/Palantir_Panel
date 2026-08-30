import { describe, expect, it } from 'vitest';
import {
  AGENT_COMMANDS,
  AGENT_CONTAINER_STATUSES,
  AGENT_EVENTS,
  AGENT_PROTOCOL_VERSION,
  isAgentCommandName,
  isAgentContainerStatus,
  isAgentEventName,
} from './agent-protocol.js';

describe('Agent-Protokoll – Befehle (Pflichtenheft §5.3)', () => {
  it('enthält genau die im Pflichtenheft genannten Befehle', () => {
    // DOWNLOAD_BACKUP und DELETE_BACKUP sind die Ergänzungen aus B5 (Lastenheft
    // §3.3: Download aller Serverdaten bzw. Aufbewahrungsregel),
    // SET_SERVER_QUERY und REMOVE_STORAGE_ENTRY die aus A3 (Pflichtenheft §9
    // periodische Spielerabfrage, Lastenheft §3.8 Speicher freigeben),
    // FILE_DELETE und FILE_UPLOAD die aus WELLE 0 (Datei-Manager, Lastenheft
    // §3.3) und FILE_EXTRACT die aus P4 (Weltdaten-Übernahme, Lastenheft §3.3)
    // – alle in Pflichtenheft §5.3 nachgetragen.
    expect([...AGENT_COMMANDS]).toEqual([
      'CREATE',
      'START',
      'STOP',
      'RESTART',
      'DELETE',
      'GET_STATS',
      'GET_LOGS',
      'EXEC_CONSOLE',
      'FILE_LIST',
      'FILE_READ',
      'FILE_WRITE',
      'CREATE_BACKUP',
      'RESTORE_BACKUP',
      'DOWNLOAD_BACKUP',
      'DELETE_BACKUP',
      'GET_STORAGE_BREAKDOWN',
      'SET_SERVER_QUERY',
      'REMOVE_STORAGE_ENTRY',
      'FILE_DELETE',
      'FILE_UPLOAD',
      'FILE_EXTRACT',
    ]);
  });

  it('nutzt durchgehend SCREAMING_SNAKE_CASE', () => {
    for (const command of AGENT_COMMANDS) {
      expect(command).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/);
    }
  });

  it('isAgentCommandName() erkennt unbekannte Befehle', () => {
    expect(isAgentCommandName('START')).toBe(true);
    expect(isAgentCommandName('SHUTDOWN_HOST')).toBe(false);
    expect(isAgentCommandName('toString')).toBe(false);
  });
});

describe('Agent-Protokoll – Ereignisse (Pflichtenheft §5.3)', () => {
  it('enthält genau die im Pflichtenheft genannten Ereignisse', () => {
    expect([...AGENT_EVENTS]).toEqual(['STATUS_CHANGED', 'STATS_UPDATE', 'LOG_LINE', 'CRASHED']);
  });

  it('isAgentEventName() erkennt unbekannte Ereignisse', () => {
    expect(isAgentEventName('CRASHED')).toBe(true);
    expect(isAgentEventName('EXPLODED')).toBe(false);
  });
});

describe('Agent-Protokoll – Container-Zustände (Pflichtenheft §2.2)', () => {
  it('bildet die beobachtbaren Runtime-Zustände ab, nicht den Server-Lifecycle', () => {
    // Die Lifecycle-Zustände aus Pflichtenheft §9 sind Auslegung des Backends
    // und dürfen hier bewusst nicht auftauchen.
    for (const lifecycleOnly of ['creating', 'starting', 'stopping', 'crashed', 'error']) {
      expect(isAgentContainerStatus(lifecycleOnly)).toBe(false);
    }
    expect([...AGENT_CONTAINER_STATUSES]).toContain('running');
    expect([...AGENT_CONTAINER_STATUSES]).toContain('exited');
    expect([...AGENT_CONTAINER_STATUSES]).toContain('unknown');
  });
});

describe('Agent-Protokoll – Version', () => {
  it('ist eine positive ganze Zahl', () => {
    expect(Number.isInteger(AGENT_PROTOCOL_VERSION)).toBe(true);
    expect(AGENT_PROTOCOL_VERSION).toBeGreaterThan(0);
  });
});
