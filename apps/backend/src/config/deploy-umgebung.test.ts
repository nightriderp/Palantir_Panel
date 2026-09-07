import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BACKEND_UMGEBUNGSVARIABLEN } from './env.js';

/**
 * Die Umgebung der VPS-Dienste (Audit W2-23, infra-images-03,
 * spec-pflichtenheft-04).
 *
 * Bis zu dieser Maßnahme stand bei jedem Dienst `env_file: ../../.env`: Jeder
 * Container trug sämtliche Geheimnisse der Instanz, auch die, die er nie liest.
 * Seit `deploy/vps/docker-compose.yml` je Dienst eine ausdrückliche Liste
 * setzt, gibt es dafür zwei neue Fehlerquellen, die im Betrieb erst spät
 * auffallen und die dieser Test abfängt:
 *
 * 1. **Zu wenig.** Eine im Schema ergänzte und in der Compose-Datei vergessene
 *    Variable fehlt im Container. Das Backend startet trotzdem und zieht den
 *    Vorgabewert - eine gesetzte `.env` bleibt wirkungslos, ohne dass irgendwo
 *    ein Fehler entsteht.
 * 2. **Zu viel.** Ein Geheimnis, das versehentlich wieder in die Liste eines
 *    Dienstes rutscht, der es nicht braucht - genau der Zustand, den die
 *    Maßnahme beendet hat.
 *
 * Der Test liegt im Backend-Paket, weil er gegen das Schema aus
 * `apps/backend/src/config/env.ts` prüft: Nur von dort ist zuverlässig zu
 * erfahren, welche Variablen das Backend-Image tatsächlich liest. Die
 * Gegenstücke für die Gamenode liegen aus demselben Grund im Agent-Paket
 * (`apps/agent/src/config/deploy-umgebung.test.ts`).
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const lies = (datei: string): string => readFileSync(path.join(repoRoot, datei), 'utf8');

const composeVps = lies('deploy/vps/docker-compose.yml');
const composeGamenode = lies('deploy/gamenode/docker-compose.yml');
const envVorlage = lies('.env.example');

/**
 * Liest die Schlüssel eines eingerückten YAML-Mapping-Blocks.
 *
 * Bewusst von Hand statt mit einem YAML-Parser: Der Zweck des Tests ist eine
 * Abweichung zwischen Schema und Compose-Datei, und dafür lohnt keine neue
 * Abhängigkeit im Backend (CLAUDE.md §1). Gelesen wird alles ab der Zeile mit
 * `beginn` bis zur ersten Zeile, die flacher oder gleich tief eingerückt ist.
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

/** Alle `${VARIABLE}`-Verweise einer Datei, ohne solche mit Vorgabewert (`:-`). */
function variablenOhneVorgabe(quelle: string): string[] {
  const namen = new Set<string>();

  for (const treffer of quelle.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)) {
    const name = treffer[1];

    if (name !== undefined) {
      namen.add(name);
    }
  }

  return [...namen].sort();
}

/**
 * Werte, die kein Dienst außerhalb seines eigenen Auftrags sehen darf. Die
 * Liste nennt bewusst Klarnamen statt einer Heuristik auf `_SECRET`: Ein
 * Cloudflare-Token oder ein WireGuard-Privatschlüssel trägt keines der üblichen
 * Wortenden.
 */
const GEHEIMNISSE = [
  'JWT_SECRET',
  'CSRF_SECRET',
  'ALTCHA_HMAC_KEY',
  'DATABASE_URL',
  'POSTGRES_PASSWORD',
  'AGENT_TOKEN',
  'FRP_TOKEN',
  'CLOUDFLARE_API_TOKEN',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_WEBHOOK_URL',
  'TWITCH_CLIENT_SECRET',
  'STEAM_API_KEY',
  'AGENT_REGISTRY_TOKEN',
  'WIREGUARD_VPS_PRIVATE_KEY',
  'WIREGUARD_HOME_PRIVATE_KEY',
] as const;

describe('deploy/vps/docker-compose.yml', () => {
  it('reicht keine Datei mit allen Geheimnissen mehr an einen Dienst durch', () => {
    // `env_file: ../../.env` war der Kern von infra-images-03: eine Zeile,
    // hinter der rund 80 Variablen in den Container gingen.
    expect(composeVps).not.toMatch(/^\s*env_file:/m);
  });

  it('gibt den Backend-Diensten genau die Variablen, die das Schema prüft', () => {
    const anker = mappingSchlüssel(composeVps, /^x-backend-umgebung: &backend-umgebung$/);

    expect([...anker].sort()).toEqual([...BACKEND_UMGEBUNGSVARIABLEN].sort());
  });

  it('trägt keine Variable doppelt in den Anker ein', () => {
    const anker = mappingSchlüssel(composeVps, /^x-backend-umgebung: &backend-umgebung$/);

    expect(anker.length).toBe(new Set(anker).size);
  });

  it('hält Werte aus dem Anker heraus, die das Backend nie liest', () => {
    const anker = mappingSchlüssel(composeVps, /^x-backend-umgebung: &backend-umgebung$/);

    // Stichprobe der Werte, die vorher über `env_file` mitkamen: Die beiden
    // WireGuard-Privatschlüssel gehören in die wg0.conf der jeweiligen
    // Maschine, das frp-Token allein zu frps, die POSTGRES_-Einzelwerte zum
    // Datenbank-Container.
    for (const name of [
      'WIREGUARD_VPS_PRIVATE_KEY',
      'WIREGUARD_HOME_PRIVATE_KEY',
      'FRP_TOKEN',
      'POSTGRES_PASSWORD',
      'POSTGRES_USER',
      'AGENT_REGISTRY_TOKEN',
      'ACME_EMAIL',
      'TRAEFIK_TRUSTED_IPS',
    ]) {
      expect(anker).not.toContain(name);
    }
  });

  it('gibt dem Frontend nur NEXT_PUBLIC_-Werte und die angezeigte Version', () => {
    // Gelesen wird ab der Zeile des Dienstes, damit kein anderer
    // `environment:`-Block dazwischenkommt.
    const frontendBlock = composeVps.slice(composeVps.indexOf('  frontend:'));
    const frontendUmgebung = mappingSchlüssel(frontendBlock, /^ {4}environment:$/);

    expect([...frontendUmgebung].sort()).toEqual([
      'NEXT_PUBLIC_API_URL',
      'NEXT_PUBLIC_BASE_DOMAIN',
      'NEXT_PUBLIC_LIVE_WS_URL',
      'PALANTIR_RELEASE',
    ]);

    for (const geheimnis of GEHEIMNISSE) {
      expect(frontendUmgebung).not.toContain(geheimnis);
    }
  });

  it('gibt dem Tunnel-Dienst weiterhin nur seine fünf Werte', () => {
    const frpsBlock = composeVps.slice(composeVps.indexOf('  frps:'));
    const frpsUmgebung = mappingSchlüssel(frpsBlock, /^ {4}environment:$/);

    expect([...frpsUmgebung].sort()).toEqual([
      'FRP_BIND_PORT',
      'FRP_TOKEN',
      'GAME_PORT_RANGE_END',
      'GAME_PORT_RANGE_START',
      'WIREGUARD_VPS_IP',
    ]);
  });
});

describe('Vorlage der zentralen .env', () => {
  /**
   * Jede Variable, die eine Compose-Datei ohne Vorgabewert einsetzt, muss in
   * `.env.example` stehen (CLAUDE.md §8). Sonst fehlt sie in der `.env`, die
   * der Betreiber daraus erzeugt: `docker compose` setzt dann einen leeren
   * String ein und meldet das nur als Warnung - beim Image-Tag führt das zu
   * einer ungültigen Referenz und der ganze `up`-Lauf bricht ab
   * (spec-pflichtenheft-02).
   */
  const inVorlage = new Set(
    [...envVorlage.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((treffer) => treffer[1] ?? ''),
  );

  it('kennt jede Variable, die die VPS-Compose-Datei einsetzt', () => {
    const fehlend = variablenOhneVorgabe(composeVps).filter((name) => !inVorlage.has(name));

    expect(fehlend).toEqual([]);
  });

  it('kennt jede Variable, die die Gamenode-Compose-Datei einsetzt', () => {
    const fehlend = variablenOhneVorgabe(composeGamenode).filter((name) => !inVorlage.has(name));

    expect(fehlend).toEqual([]);
  });

  it('lässt die Datenbank-URL auf den Docker-Dienstnamen zeigen', () => {
    // infra-images-16: `127.0.0.1` ist im Container die eigene
    // Loopback-Adresse - die Migrationen scheitern, Backend und Frontend
    // starten nie.
    expect(envVorlage).toMatch(/^DATABASE_URL=postgresql:\/\/[^@]+@postgres:5432\//m);
  });
});
