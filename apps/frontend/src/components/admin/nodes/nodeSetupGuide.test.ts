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
    // Kein Token wird erzeugt – nur auf das geteilte AGENT_TOKEN verwiesen.
    expect(env?.code).toContain('AGENT_TOKEN=<identisch mit der VPS-.env>');
  });

  it('führt den Erreichbarkeits-Test auf der VPS aus', () => {
    const check = steps.find((step) => step.machine === 'vps');
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
