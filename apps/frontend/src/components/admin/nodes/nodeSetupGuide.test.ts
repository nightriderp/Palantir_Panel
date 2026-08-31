import { describe, expect, it } from 'vitest';
import { buildNodeSetupSteps } from './nodeSetupGuide';

describe('buildNodeSetupSteps', () => {
  const steps = buildNodeSetupSteps({ name: 'Homeserver', wireguardIp: '10.10.0.2' });

  it('nennt die Tunnel-Adresse der Node im WireGuard-Schritt', () => {
    const wireguard = steps.find((step) => step.title.includes('WireGuard'));
    expect(wireguard?.body).toContain('10.10.0.2');
    expect(wireguard?.machine).toBe('homeserver');
  });

  it('setzt die Backend-WS-Adresse auf die VPS-Tunnel-IP (Vorgabe 10.10.0.1)', () => {
    const env = steps.find((step) => step.title.includes('.env'));
    expect(env?.code).toContain('AGENT_BACKEND_WS_URL=ws://10.10.0.1:4000/agent');
    // Die Anleitung erzeugt kein Token; sie verweist auf das im Panel vergebene.
    expect(env?.code).toContain('AGENT_TOKEN=<Token dieser Node aus dem Panel>');
  });

  it('nennt den Schritt zur Token-Vergabe auf der VPS (Gefundener Punkt 57)', () => {
    const tokenStep = steps.find((step) => step.title.includes('Agent-Token'));

    expect(tokenStep?.machine).toBe('vps');
    expect(tokenStep?.body).toContain('genau einmal');
    // Ein Geheimnis entsteht hier nicht – nur der Hinweis, wo es erzeugt wird.
    expect(tokenStep?.code).toBeUndefined();
  });

  it('setzt AGENT_NODE_ID auf die Kennung der Node, sonst einen Platzhalter', () => {
    const env = steps.find((step) => step.title.includes('.env'));
    expect(env?.code).toContain('AGENT_NODE_ID=<Kennung dieser Node aus dem Panel>');

    const mitId = buildNodeSetupSteps({
      name: 'Homeserver',
      wireguardIp: '10.10.0.2',
      nodeId: '11111111-1111-4111-8111-111111111111',
    });
    expect(mitId.find((step) => step.title.includes('.env'))?.code).toContain(
      'AGENT_NODE_ID=11111111-1111-4111-8111-111111111111',
    );
  });

  it('führt den Erreichbarkeits-Test auf der VPS aus', () => {
    // Seit der Token-Vergabe gibt es zwei Schritte auf der VPS – deshalb über
    // den Titel gesucht und nicht über die Maschine.
    const check = steps.find((step) => step.title.includes('Erreichbarkeit'));
    expect(check?.machine).toBe('vps');
    expect(check?.code).toContain('http://10.10.0.1:4000/health');
  });

  it('respektiert eine abweichende VPS-Tunnel-IP', () => {
    const custom = buildNodeSetupSteps({
      name: 'Zweitnode',
      wireguardIp: '10.10.0.3',
      vpsWireguardIp: '10.20.0.1',
    });
    const env = custom.find((step) => step.title.includes('.env'));
    expect(env?.code).toContain('AGENT_BACKEND_WS_URL=ws://10.20.0.1:4000/agent');
  });
});
