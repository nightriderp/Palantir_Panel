import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AGENT_UMGEBUNGSVARIABLEN } from './env.js';

/**
 * Die Umgebung der Gamenode-Dienste (Audit W2-23, infra-images-03).
 *
 * Die Gamenode verarbeitet fremde Spiel-Images und den Verkehr der Spieler; sie
 * ist das schwächere Glied der Anlage. Trotzdem trug ihr Agent-Container über
 * `env_file: ../../.env` sämtliche Geheimnisse der Instanz - `JWT_SECRET`
 * genügt, um beliebige Access-Token zu fälschen und damit Owner-Rechte im Panel
 * zu bekommen. Seit `deploy/gamenode/docker-compose.yml` je Dienst eine
 * ausdrückliche Liste setzt, hält dieser Test beide Seiten zusammen: zu wenig
 * (der Agent zöge still einen Vorgabewert) fällt genauso auf wie zu viel (ein
 * fremdes Geheimnis, das wieder hineinrutscht).
 *
 * Der Test liegt im Agent-Paket, weil nur `apps/agent/src/config/env.ts`
 * verlässlich sagt, welche Variablen der Agent liest. Das Gegenstück für die
 * VPS liegt aus demselben Grund im Backend-Paket.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const compose = readFileSync(path.join(repoRoot, 'deploy/gamenode/docker-compose.yml'), 'utf8');

/**
 * Liest die Schlüssel eines eingerückten YAML-Mapping-Blocks. Von Hand statt
 * mit einem YAML-Parser: Für den Abgleich zweier Namenslisten lohnt keine neue
 * Abhängigkeit im Agent (CLAUDE.md §1).
 */
function mappingSchlüssel(quelle: string, beginn: RegExp): string[] {
  const zeilen = quelle.split(/\r?\n/);
  const start = zeilen.findIndex((zeile) => beginn.test(zeile));

  expect(start, `Block ${String(beginn)} nicht gefunden`).toBeGreaterThanOrEqual(0);

  const einrückung = (zeile: string): number => zeile.length - zeile.trimStart().length;
  const blockTiefe = einrückung(zeilen[start] ?? '');
  const schlüssel: string[] = [];

  for (const zeile of zeilen.slice(start + 1)) {
    if (zeile.trim().length === 0) {
      continue;
    }

    if (einrückung(zeile) <= blockTiefe) {
      break;
    }

    const name = /^\s*([A-Z][A-Z0-9_]*):/.exec(zeile)?.[1];

    if (name !== undefined) {
      schlüssel.push(name);
    }
  }

  return schlüssel;
}

const agentUmgebung = mappingSchlüssel(
  compose.slice(compose.indexOf('  agent:')),
  /^ {4}environment:$/,
);

describe('deploy/gamenode/docker-compose.yml', () => {
  it('reicht keine Datei mit allen Geheimnissen mehr an einen Dienst durch', () => {
    expect(compose).not.toMatch(/^\s*env_file:/m);
  });

  it('gibt dem Agent genau die Variablen, die sein Schema prüft', () => {
    expect([...agentUmgebung].sort()).toEqual([...AGENT_UMGEBUNGSVARIABLEN].sort());
  });

  it('hält die Geheimnisse der VPS aus dem Agent-Container heraus', () => {
    // Der Kern von infra-images-03: Keiner dieser Werte wird vom Agent
    // gelesen, alle lagen bisher in seiner Umgebung.
    for (const name of [
      'JWT_SECRET',
      'CSRF_SECRET',
      'ALTCHA_HMAC_KEY',
      'DATABASE_URL',
      'POSTGRES_PASSWORD',
      'CLOUDFLARE_API_TOKEN',
      'DISCORD_CLIENT_SECRET',
      'TWITCH_CLIENT_SECRET',
      'STEAM_API_KEY',
      'WIREGUARD_VPS_PRIVATE_KEY',
      'WIREGUARD_HOME_PRIVATE_KEY',
      'FRP_TOKEN',
    ]) {
      expect(agentUmgebung).not.toContain(name);
    }
  });

  it('lässt den Agent über den Socket-Proxy sprechen, nicht über den Docker-Socket', () => {
    // Pflichtenheft §2.3: Der Wert aus der .env zeigt auf 127.0.0.1; im
    // Compose-Netz heißt der Proxy `socket-proxy`. Ohne die Übersteuerung
    // fände der Agent im eigenen Container nichts.
    expect(agentUmgebung).toContain('DOCKER_SOCKET_PROXY_URL');
    expect(compose).toContain('DOCKER_SOCKET_PROXY_URL: http://socket-proxy:2375');
  });

  it('gibt dem Tunnel-Dienst weiterhin nur seine fünf Werte', () => {
    const frpcUmgebung = mappingSchlüssel(
      compose.slice(compose.indexOf('  frpc:')),
      /^ {4}environment:$/,
    );

    expect([...frpcUmgebung].sort()).toEqual([
      'FRP_BIND_PORT',
      'FRP_TOKEN',
      'GAME_PORT_RANGE_END',
      'GAME_PORT_RANGE_START',
      'WIREGUARD_VPS_IP',
    ]);
  });
});
