import { describe, expect, it } from 'vitest';
import { AGENT_COMMANDS } from './agent-protocol.js';
import {
  IMPLEMENTED_AGENT_COMMANDS,
  isImplementedAgentCommand,
  type AgentCommandPayloads,
  type AgentCommandResults,
  type AgentContainerStats,
} from './agent-commands.js';

describe('Befehls-Nutzdaten (Pflichtenheft §5.3)', () => {
  it('deckt die Zuordnungstabellen jeden Befehl aus dem Protokoll ab', () => {
    // Rein typseitige Prüfung: Fehlt ein Befehl in AgentCommandPayloads oder
    // AgentCommandResults, schlägt schon der Build fehl.
    const payloads: Record<(typeof AGENT_COMMANDS)[number], keyof AgentCommandPayloads> =
      Object.fromEntries(AGENT_COMMANDS.map((c) => [c, c])) as Record<
        (typeof AGENT_COMMANDS)[number],
        keyof AgentCommandPayloads
      >;
    const results: Record<(typeof AGENT_COMMANDS)[number], keyof AgentCommandResults> =
      payloads as Record<(typeof AGENT_COMMANDS)[number], keyof AgentCommandResults>;

    expect(Object.keys(payloads).sort()).toEqual([...AGENT_COMMANDS].sort());
    expect(Object.keys(results).sort()).toEqual([...AGENT_COMMANDS].sort());
  });

  it('führt nur Befehle als umgesetzt, die es auch im Protokoll gibt', () => {
    for (const command of IMPLEMENTED_AGENT_COMMANDS) {
      expect([...AGENT_COMMANDS]).toContain(command);
    }
  });

  it('führt jeden Befehl des Protokolls aus', () => {
    // Dasselbe Muster wie bei WELLE 0: Ein Befehl steht zuerst im Protokoll und
    // wird vom nachfolgenden Arbeitspaket ausgeführt – FILE_DELETE/FILE_UPLOAD
    // von P2, FILE_EXTRACT von P4. Seither ist die Liste wieder vollständig:
    // Ein neuer Befehl ohne Umsetzung fällt hier auf, statt erst im Betrieb als
    // `AGENT_COMMAND_NOT_IMPLEMENTED`.
    expect(AGENT_COMMANDS.filter((command) => !isImplementedAgentCommand(command))).toEqual([]);
    expect(IMPLEMENTED_AGENT_COMMANDS).toHaveLength(AGENT_COMMANDS.length);
  });

  it('kennt die beiden von A3 ergänzten Befehle', () => {
    expect([...AGENT_COMMANDS]).toContain('SET_SERVER_QUERY');
    expect([...AGENT_COMMANDS]).toContain('REMOVE_STORAGE_ENTRY');
  });

  it('kennt die beiden von WELLE 0 ergänzten Datei-Befehle', () => {
    expect([...AGENT_COMMANDS]).toContain('FILE_DELETE');
    expect([...AGENT_COMMANDS]).toContain('FILE_UPLOAD');
  });

  it('kennt den von P4 ergänzten Entpack-Befehl', () => {
    expect([...AGENT_COMMANDS]).toContain('FILE_EXTRACT');
  });

  /*
   * Fundpunkt 168: Die Warnung bei knappem Speicherplatz auf Server-Ebene
   * hatte keine Quelle - das Protokoll mass Plattenplatz nur node-weit.
   * `diskUsedBytes` schliesst das, und zwar optional: Ein Agent, der das Feld
   * nicht kennt, bleibt gueltig.
   */
  it('traegt den Plattenplatz je Server, laesst ihn aber weg duerfen', () => {
    const ohneMessung: AgentContainerStats = {
      containerId: 'c1',
      cpuPercent: 12.5,
      memoryUsedBytes: 1024,
      memoryLimitBytes: 4096,
      networkRxBytes: 0,
      networkTxBytes: 0,
      blockReadBytes: 0,
      blockWriteBytes: 0,
      pids: 3,
      sampledAt: '2026-09-08T12:00:00.000Z',
    };

    const mitMessung: AgentContainerStats = { ...ohneMessung, diskUsedBytes: 5_242_880 };

    // Fehlt das Feld, heisst das 'nicht gemessen' - nicht 'null Bytes belegt'.
    // Aus einer fehlenden Messung darf nie eine Warnung entstehen.
    expect(ohneMessung.diskUsedBytes).toBeUndefined();
    expect(mitMessung.diskUsedBytes).toBe(5_242_880);
  });

  it('isImplementedAgentCommand() erkennt Befehle außerhalb des Protokolls', () => {
    expect(isImplementedAgentCommand('START')).toBe(true);
    expect(isImplementedAgentCommand('SHUTDOWN_HOST')).toBe(false);
  });
});
