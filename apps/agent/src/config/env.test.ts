import { describe, expect, it } from 'vitest';
import { leereWerteAlsUngesetzt, umgebungLesen } from './env.js';

/**
 * Leere Werte der zentralen `.env` (Audit W2-23).
 *
 * Die Vorlage führt jede Variable auf, auch die optionalen - `AGENT_NODE_ID=`,
 * `AGENT_REGISTRY_USERNAME=`, `AGENT_SECCOMP_PROFILE_PATH=`. Seit die
 * Compose-Datei die Werte einzeln durchreicht (`AGENT_NODE_ID:
 * ${AGENT_NODE_ID}`) kommt daraus ein leerer String im Container an, und vorher
 * tat `env_file` dasselbe. Ohne Normalisierung weisen `z.string().min(1)`,
 * `.url()` und `.uuid()` ihn zurück: Der Agent käme mit der ausgelieferten
 * Vorlage gar nicht erst hoch.
 */
describe('Umgebungsschema des Agents', () => {
  const fehlerPfade = (ergebnis: ReturnType<typeof umgebungLesen>): string[] =>
    ergebnis.success ? [] : ergebnis.error.issues.map((issue) => issue.path.join('.'));

  it('behandelt leere Einträge wie nicht gesetzte', () => {
    const normalisiert = leereWerteAlsUngesetzt({
      AGENT_NODE_ID: '',
      AGENT_SECCOMP_PROFILE_PATH: '   ',
      AGENT_TOKEN: 'ein-token',
    });

    expect(normalisiert.AGENT_NODE_ID).toBeUndefined();
    expect(normalisiert.AGENT_SECCOMP_PROFILE_PATH).toBeUndefined();
    expect(normalisiert.AGENT_TOKEN).toBe('ein-token');
  });

  it('nimmt die ausgelieferte Vorlage mit ihren leeren Werten an', () => {
    const ergebnis = umgebungLesen({
      AGENT_NODE_ID: '',
      AGENT_TOKEN: '',
      AGENT_REGISTRY_USERNAME: '',
      AGENT_REGISTRY_TOKEN: '',
      AGENT_SECCOMP_PROFILE_PATH: '',
      AGENT_BACKEND_WS_URL: '',
    });

    expect(ergebnis.success).toBe(true);

    if (ergebnis.success) {
      // Der Vorgabewert greift wieder, statt an `.url()` zu scheitern.
      expect(ergebnis.data.AGENT_BACKEND_WS_URL).toBe('ws://10.10.0.1:4000/agent');
      expect(ergebnis.data.AGENT_NODE_ID).toBeUndefined();
      expect(ergebnis.data.DOCKER_SOCKET_PROXY_URL).toBe('http://127.0.0.1:2375');
    }
  });

  it('weist unbrauchbare Werte weiterhin zurück', () => {
    const ergebnis = umgebungLesen({
      AGENT_BACKEND_WS_URL: 'keine-url',
      AGENT_NODE_ID: 'keine-uuid',
    });

    expect(ergebnis.success).toBe(false);
    expect(fehlerPfade(ergebnis)).toEqual(
      expect.arrayContaining(['AGENT_BACKEND_WS_URL', 'AGENT_NODE_ID']),
    );
  });

  it('übernimmt die Werte aus dem Compose-Dienst unverändert', () => {
    const ergebnis = umgebungLesen({
      NODE_ENV: 'production',
      AGENT_TOKEN: 'x'.repeat(64),
      AGENT_BACKEND_WS_URL: 'ws://10.10.0.1:4000/agent',
      DOCKER_SOCKET_PROXY_URL: 'http://socket-proxy:2375',
      AGENT_DATA_DIR: '/srv/palantir/servers',
    });

    expect(ergebnis.success).toBe(true);
    expect(ergebnis.success && ergebnis.data.DOCKER_SOCKET_PROXY_URL).toBe(
      'http://socket-proxy:2375',
    );
  });
});
