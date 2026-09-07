/**
 * Abgleich zwischen der Haertung im Agent und den Deploy-Dateien der Gamenode
 * (Audit security-matrix-02 und spec-pflichtenheft-05, Massnahme W2-26).
 *
 * Diese drei Stellen muessen zusammenpassen, koennen aber getrennt geaendert
 * werden - und dann faellt es im Betrieb auf, nicht beim Bauen:
 *
 *   1. `hardening.ts` setzt `palantir-games` als `NetworkMode` jedes Containers.
 *   2. `deploy/gamenode/egress-firewall.sh` legt genau dieses Netz an und haengt
 *      die Egress-Regeln daran.
 *   3. `deploy/gamenode/docker-compose.yml` schliesst am Socket-Proxy die
 *      Endpunkte, die der Agent nie braucht.
 *
 * Waere der Netzname an einer Stelle anders, liesse sich kein Server mehr
 * starten; stuenden VOLUMES/NETWORKS/INFO/PING wieder offen, waere die
 * Massnahme still zurueckgenommen. Deshalb liest der Test die echten Dateien,
 * nicht eine Kopie ihrer Werte.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_NETWORK } from './hardening.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const skriptPfad = path.join(repoRoot, 'deploy', 'gamenode', 'egress-firewall.sh');
const composePfad = path.join(repoRoot, 'deploy', 'gamenode', 'docker-compose.yml');
const envBeispielPfad = path.join(repoRoot, '.env.example');

const skript = readFileSync(skriptPfad, 'utf8');
const compose = readFileSync(composePfad, 'utf8');
const envBeispiel = readFileSync(envBeispielPfad, 'utf8');

/**
 * `bash -n` liest das Skript und bricht bei einem Syntaxfehler ab, ohne eine
 * einzige Regel zu setzen - genau das, was auf dieser Entwicklungsmaschine
 * moeglich ist (kein Docker, kein Root). Fehlt `bash` auf dem Rechner, meldet
 * `spawnSync` ENOENT; in der CI (ubuntu-latest) ist es immer vorhanden.
 */
function bashSyntaxpruefung(pfad: string): { verfuegbar: boolean; status: number; fehler: string } {
  const lauf = spawnSync('bash', ['-n', pfad], { encoding: 'utf8' });
  if (lauf.error !== undefined && (lauf.error as NodeJS.ErrnoException).code === 'ENOENT') {
    return { verfuegbar: false, status: 0, fehler: '' };
  }
  return { verfuegbar: true, status: lauf.status ?? 1, fehler: lauf.stderr ?? '' };
}

describe('egress-firewall.sh', () => {
  it('ist syntaktisch gueltiges Bash', () => {
    const ergebnis = bashSyntaxpruefung(skriptPfad);
    if (!ergebnis.verfuegbar) {
      // Kein stiller Durchmarsch: Der Grund steht im Testlauf, und die CI
      // fuehrt die Pruefung wirklich aus.
      console.warn('bash nicht gefunden - Syntaxpruefung uebersprungen.');
      return;
    }
    expect(ergebnis.fehler).toBe('');
    expect(ergebnis.status).toBe(0);
  });

  it('beginnt mit einer Bash-Kennung und bricht bei Fehlern ab', () => {
    expect(skript.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(skript).toContain('set -euo pipefail');
  });

  it('legt die erwarteten Ketten an und haengt sie in DOCKER-USER', () => {
    expect(skript).toContain("CHAIN_FWD='PALANTIR-EGRESS'");
    expect(skript).toContain("CHAIN_IN='PALANTIR-EGRESS-IN'");
    // Der Sprung geht an die erste Stelle von DOCKER-USER, sonst greifen
    // Docker-eigene ACCEPT-Regeln vorher.
    expect(skript).toContain('sprung_setzen \'DOCKER-USER\' "${CHAIN_FWD}"');
    expect(skript).toContain('iptables -I "${eltern}" 1 -i "${GAMES_BRIDGE}" -j "${kette}"');
  });

  it('sperrt WireGuard, Nachbar-Container und die privaten Bereiche', () => {
    // Die drei ausdruecklich beauftragten Ziele.
    expect(skript).toContain('-d "${WG_SUBNET}"');
    expect(skript).toContain('-d "${GAMES_SUBNET}"');
    for (const bereich of ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16']) {
      expect(skript).toContain(bereich);
    }
  });

  it('laesst das oeffentliche Internet offen (Mod- und Plugin-Downloads)', () => {
    // Sperrliste, keine Positivliste - und kein `--internal` als Schalter am
    // Docker-Netz, das den Container vom Internet abschneiden wuerde. Im
    // Kommentar darf das Wort stehen (dort steht die Begruendung), als Argument
    // nicht.
    expect(skript).toContain('palantir: oeffentliches Internet erlaubt');
    const alsSchalter = skript
      .split('\n')
      .filter((zeile) => !zeile.trim().startsWith('#'))
      .filter((zeile) => /(^|\s)--internal(\s|$|\\)/.test(zeile));
    expect(alsSchalter).toEqual([]);
  });

  it('schaltet die Kommunikation zwischen Nachbar-Containern am Netz selbst ab', () => {
    expect(skript).toContain('com.docker.network.bridge.enable_icc=false');
    expect(skript).toContain('com.docker.network.bridge.name=');
  });

  it('kann sein Regelwerk vollstaendig zuruecknehmen', () => {
    expect(skript).toContain('befehl_remove()');
    expect(skript).toContain('iptables -X "${kette}"');
    for (const unterbefehl of ['apply)', 'status)', 'remove)']) {
      expect(skript).toContain(unterbefehl);
    }
  });
});

describe('Docker-Socket-Proxy der Gamenode', () => {
  /** Liest einen Schalter aus dem `environment:`-Block des Socket-Proxys. */
  function schalter(name: string): string | undefined {
    const treffer = new RegExp(`^\\s*${name}:\\s*(\\S+)\\s*$`, 'm').exec(compose);
    return treffer?.[1];
  }

  it('gibt nur die Gruppen frei, die der Agent tatsaechlich benutzt', () => {
    // CONTAINERS -> /containers/*, IMAGES -> /images/*, EXEC -> /exec/*,
    // EVENTS -> /events, POST -> alle Methoden ausser GET.
    for (const name of ['CONTAINERS', 'IMAGES', 'EXEC', 'EVENTS', 'POST']) {
      expect(schalter(name), `${name} muss offen bleiben`).toBe('1');
    }
  });

  it('schliesst VOLUMES, NETWORKS, INFO und PING (spec-pflichtenheft-05)', () => {
    for (const name of ['VOLUMES', 'NETWORKS', 'INFO', 'PING']) {
      expect(schalter(name), `${name} darf nicht offen sein`).toBe('0');
    }
  });

  it('haelt die uebrigen Gruppen weiterhin geschlossen', () => {
    for (const name of ['BUILD', 'COMMIT', 'SECRETS', 'SWARM', 'SYSTEM']) {
      expect(schalter(name), `${name} darf nicht offen sein`).toBe('0');
    }
  });
});

describe('Netzname ueber alle Stellen hinweg', () => {
  it('ist im Agent, in der .env-Vorlage und im Skript derselbe', () => {
    expect(DEFAULT_GAME_NETWORK).toBe('palantir-games');
    expect(envBeispiel).toContain(`AGENT_CONTAINER_NETWORK=${DEFAULT_GAME_NETWORK}`);
    expect(skript).toContain(`GAMES_NETWORK:-${DEFAULT_GAME_NETWORK}`);
    // Das Skript liest denselben Wert aus der zentralen .env, damit eine
    // Aenderung dort nicht nur den Agent erreicht.
    expect(skript).toContain('get_env_value AGENT_CONTAINER_NETWORK');
  });

  it('taucht als erklaerter Hinweis im Compose der Gamenode auf', () => {
    expect(compose).toContain(DEFAULT_GAME_NETWORK);
    expect(compose).toContain('egress-firewall.sh');
  });
});
