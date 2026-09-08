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

/**
 * Der Hostname-Router (Pflichtenheft §2.4, §13).
 *
 * Er steht im selben Netz wie die Spielserver und waere damit ein
 * „Nachbar-Container" - also gesperrt. Die Ausnahme dafuer ist die einzige
 * Stelle, an der die Grenze aus security-matrix-02 aufgemacht wird, und sie
 * muss genau so eng bleiben, wie sie gedacht ist. Deshalb steht sie hier
 * Zeile fuer Zeile.
 */
describe('Ausnahme fuer den Hostname-Router', () => {
  it('laesst nur die eine Richtung auf den einen Port zu', () => {
    // Quelle ist ausschliesslich die feste Adresse des Routers, Ziel das
    // Spielenetz, Protokoll TCP, Port der Spielport.
    expect(skript).toContain('iptables -A "${CHAIN_FWD}" -s "${ROUTER_IP}" -d "${GAMES_SUBNET}"');
    expect(skript).toContain('-p tcp --dport "${ROUTER_TARGET_PORT}"');
  });

  it('laesst zurueck nur bestehende Verbindungen', () => {
    // Eine NEUE Verbindung eines Spielcontainers zum Router faellt weiterhin
    // unter die Sperre gegen Nachbar-Container.
    expect(skript).toContain('iptables -A "${CHAIN_FWD}" -d "${ROUTER_IP}"');
    expect(skript).toContain('-m conntrack --ctstate ESTABLISHED,RELATED');
  });

  it('benutzt ACCEPT und nicht RETURN', () => {
    // RETURN fiele in die DROP-Regel, die Docker wegen `icc=false` selbst in
    // FORWARD setzt - der Router erreichte dann nichts.
    expect(skript).toContain("--comment 'palantir: Hostname-Router -> Spielserver' -j ACCEPT");
    expect(skript).toContain("--comment 'palantir: Antwort an den Hostname-Router' -j ACCEPT");
  });

  it('steht vor den Sperren', () => {
    const ausnahme = skript.indexOf('palantir: Hostname-Router -> Spielserver');
    const nachbarn = skript.indexOf('palantir: Nachbar-Container');
    const bestehend = skript.indexOf("palantir: bestehende Verbindung' -j RETURN");

    expect(ausnahme).toBeGreaterThan(0);
    expect(ausnahme).toBeLessThan(nachbarn);
    // Auch vor der allgemeinen ESTABLISHED-Zeile: die springt mit RETURN aus
    // der Kette heraus, und danach greift die icc-Sperre.
    expect(ausnahme).toBeLessThan(bestehend);
  });

  it('entfaellt vollstaendig, wenn keine Router-Adresse gesetzt ist', () => {
    expect(skript).toContain('if [[ -n "${ROUTER_IP}" ]]; then');
    expect(skript).toContain('ROUTER_IP="${ROUTER_IP:-$(get_env_value GAME_ROUTER_CONTAINER_IP)}"');
  });

  it('haelt die Adresse des Routers aus der automatischen Vergabe heraus', () => {
    // Sonst koennte ein Spielcontainer sie belegen, waehrend der Router steht -
    // danach kaeme er nicht mehr hoch, und alle Minecraft-Server waeren dunkel.
    expect(skript).toContain('--ip-range "${GAMES_IP_RANGE}"');
    expect(skript).toContain('GAMES_IP_RANGE="${GAMES_IP_RANGE:-172.31.240.0/25}"');
    expect(envBeispiel).toContain('GAME_ROUTER_CONTAINER_IP=172.31.240.254');
  });
});

describe('Hostname-Router in den Deploy-Dateien', () => {
  const frpc = readFileSync(path.join(repoRoot, 'deploy', 'gamenode', 'frpc.toml'), 'utf8');
  const frps = readFileSync(path.join(repoRoot, 'deploy', 'vps', 'frps.toml'), 'utf8');

  it('veroeffentlicht auf der Gamenode weiterhin keinen Port', () => {
    // Der Grundsatz im Kopf der Datei (Pflichtenheft §1) gilt auch fuer den
    // Router: Er lauscht nur im eigenen Netz-Namensraum.
    const alsSchluessel = compose.split('\n').filter((zeile) => /^\s*ports:\s*$/.test(zeile));
    expect(alsSchluessel).toEqual([]);
  });

  it('bindet den Router haertend ein und pinnt sein Image auf einen Digest', () => {
    const dienst = compose.slice(compose.indexOf('  hostname-router:'));

    expect(dienst).toContain('image: haveachin/infrared:${INFRARED_VERSION}@${INFRARED_DIGEST}');
    expect(dienst).toContain('no-new-privileges:true');
    expect(dienst).toContain('read_only: true');
    expect(dienst).toContain('- ALL');
    expect(dienst).toMatch(/^\s+user: '65534:65534'$/m);
    // Nur mit Profil - eine frische Node kommt sonst ohne das externe Netz
    // nicht hoch.
    expect(dienst).toContain("profiles: ['hostname-router']");
    // Das Routen-Verzeichnis nur lesend; geschrieben wird allein vom Agent.
    expect(dienst).toContain('/proxies:/configs:ro');
  });

  it('holt den Router ueber seine feste Adresse ab, nicht ueber 127.0.0.1', () => {
    expect(frpc).toContain('localIP = "{{ .Envs.GAME_ROUTER_CONTAINER_IP }}"');
    expect(frpc).toContain('localPort = {{ .Envs.MINECRAFT_ROUTER_PORT }}');
    expect(frpc).toContain('remotePort = {{ .Envs.MINECRAFT_ROUTER_PORT }}');
    // Minecraft Java spricht TCP; ein UDP-Proxy waere ein offener Socket ohne
    // Gegenstelle.
    expect(frpc).not.toContain('name = "hostname-router-udp"');
  });

  it('raeumt das automatische Update den Router nicht weg', () => {
    // `up -d --remove-orphans` ohne das Profil haelt den Router fuer einen
    // verwaisten Container und entfernt ihn - bei JEDEM naechtlichen Lauf,
    // ohne dass jemand etwas geaendert haette.
    const update = readFileSync(path.join(repoRoot, 'deploy', 'gamenode', 'update.sh'), 'utf8');

    expect(update).toContain('PROFIL=(--profile hostname-router)');
    for (const zeile of update.split('\n')) {
      if (/^\s*docker compose /.test(zeile)) {
        expect(zeile, `ohne Profil: ${zeile.trim()}`).toContain('"${PROFIL[@]}"');
      }
    }
  });

  it('laesst frps den Router-Port zusaetzlich zum Pool durch (Pflichtenheft §19)', () => {
    expect(frps).toContain('{ single = {{ .Envs.MINECRAFT_ROUTER_PORT }} }');
    expect(frps).toContain(
      '{ start = {{ .Envs.GAME_PORT_RANGE_START }}, end = {{ .Envs.GAME_PORT_RANGE_END }} }',
    );
  });

  it('haelt den Router am Leben, solange es keine einzige Route gibt', () => {
    // Ohne mindestens einen Proxy beendet sich Infrared mit „no proxies in
    // gateway" und liefe wegen `restart: always` in eine Schleife.
    const platzhalter = JSON.parse(
      readFileSync(
        path.join(repoRoot, 'deploy', 'gamenode', 'infrared', '00-platzhalter.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;

    expect(String(platzhalter['domainName']).endsWith('.invalid')).toBe(true);
    expect(platzhalter['listenTo']).toBe(':25565');
    expect(compose).toContain('00-platzhalter.json:/configs/00-platzhalter.json:ro');
  });
});
