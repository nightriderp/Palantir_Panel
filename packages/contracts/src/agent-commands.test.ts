import { describe, expect, it } from 'vitest';
import { AGENT_COMMANDS } from './agent-protocol.js';
import {
  IMPLEMENTED_AGENT_COMMANDS,
  isImplementedAgentCommand,
  type AgentCommandPayloads,
  type AgentCommandResults,
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

  it('lässt die A3-Befehle bewusst als noch nicht umgesetzt stehen', () => {
    // Dateisystem- und Job-Aufgaben (A3), nicht Container-Ansteuerung. Die
    // Liste steht ausgeschrieben da: Wandert ein Befehl nach A3 hinüber, soll
    // das hier auffallen und nicht nur eine Zahl verschieben.
    const offen = [
      'CREATE_BACKUP',
      'RESTORE_BACKUP',
      'DOWNLOAD_BACKUP',
      'DELETE_BACKUP',
      'GET_STORAGE_BREAKDOWN',
      'SET_SERVER_QUERY',
      'REMOVE_STORAGE_ENTRY',
    ] as const;

    for (const command of offen) {
      expect(isImplementedAgentCommand(command)).toBe(false);
    }

    expect(
      AGENT_COMMANDS.filter((command) => !isImplementedAgentCommand(command)).sort(),
    ).toEqual([...offen].sort());
  });

  it('kennt die beiden von A3 ergänzten Befehle', () => {
    expect([...AGENT_COMMANDS]).toContain('SET_SERVER_QUERY');
    expect([...AGENT_COMMANDS]).toContain('REMOVE_STORAGE_ENTRY');
  });

  it('isImplementedAgentCommand() erkennt Befehle außerhalb des Protokolls', () => {
    expect(isImplementedAgentCommand('START')).toBe(true);
    expect(isImplementedAgentCommand('SHUTDOWN_HOST')).toBe(false);
  });
});
