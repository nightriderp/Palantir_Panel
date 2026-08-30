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

  it('führt genau die von WELLE 0 nachgetragenen Datei-Befehle noch nicht aus', () => {
    // Mit A3 war die Liste vollständig. WELLE 0 nimmt FILE_DELETE und FILE_UPLOAD
    // ins Protokoll auf, überlässt die Ausführung aber P2 (Datei-Manager) – genau
    // wie die Backup-Befehle vor A3. Bleibt darüber hinaus etwas offen oder wird
    // eines der beiden versehentlich als umgesetzt geführt, soll das auffallen.
    expect(AGENT_COMMANDS.filter((command) => !isImplementedAgentCommand(command)).sort()).toEqual([
      'FILE_DELETE',
      'FILE_UPLOAD',
    ]);
    expect(IMPLEMENTED_AGENT_COMMANDS).toHaveLength(AGENT_COMMANDS.length - 2);
  });

  it('kennt die beiden von A3 ergänzten Befehle', () => {
    expect([...AGENT_COMMANDS]).toContain('SET_SERVER_QUERY');
    expect([...AGENT_COMMANDS]).toContain('REMOVE_STORAGE_ENTRY');
  });

  it('kennt die beiden von WELLE 0 ergänzten Datei-Befehle', () => {
    expect([...AGENT_COMMANDS]).toContain('FILE_DELETE');
    expect([...AGENT_COMMANDS]).toContain('FILE_UPLOAD');
  });

  it('isImplementedAgentCommand() erkennt Befehle außerhalb des Protokolls', () => {
    expect(isImplementedAgentCommand('START')).toBe(true);
    expect(isImplementedAgentCommand('SHUTDOWN_HOST')).toBe(false);
  });
});
