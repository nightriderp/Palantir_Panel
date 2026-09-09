#!/usr/bin/env bash
#
# Palantir - Ausgangsbeschraenkung fuer Spielserver-Container (Audit W2-26,
# security-matrix-02).
#
# Laeuft in der Gameserver-VM (Homeserver), als root. Auf der VPS hat das
# Skript nichts zu suchen.
#
#   sudo /opt/palantir/deploy/gamenode/egress-firewall.sh apply
#
# WARUM: Ab Phase 2 laufen echte Spiel-Images, in denen Server-Besitzer Plugins,
# Mods und Skripte ausfuehren (Lastenheft §3.3). Bis hierher hingen die
# Container im Docker-Standardnetz `bridge` - ohne jede Ausgangsregel. Aus dem
# Container heraus waren damit erreichbar:
#
#   (a) das Heim-LAN des Betreibers (Router-Oberflaeche, NAS, andere Geraete),
#   (b) jeder Nachbar-Container derselben Node (Docker-Vorgabe `icc=true`),
#   (c) ueber NAT und `wg0` der Tunnel-Peer auf der VPS: der frps-Steuerkanal
#       (Port 7000) und der Agent-Port des Backends (Port 4000).
#
# Die EINGEHENDE Seite ist sauber abgeschottet (kein `ports:`, Bindung auf
# 127.0.0.1, WireGuard-Input-Filter) - die ausgehende war es nicht.
#
# WAS DAS SKRIPT TUT:
#   1. Legt das Docker-Netz `palantir-games` an: eigener Bridge-Name, festes
#      Subnetz, `icc=false` (Container im Netz erreichen einander nicht).
#   2. Haengt in die `DOCKER-USER`-Kette eine eigene Kette `PALANTIR-EGRESS`,
#      die fuer Pakete AUS diesem Netz private Ziele verwirft und oeffentliche
#      durchlaesst. Mod- und Plugin-Downloads bleiben also moeglich - das ist
#      ausdruecklich Teil der Anforderung.
#   3. Optional (Vorgabe: an) eine zweite Kette an `INPUT`, damit die Container
#      auch die Dienste der Node selbst nicht erreichen. `DOCKER-USER` haengt
#      an `FORWARD` und sieht Pakete an die Node NICHT.
#   4. Genau eine Ausnahme von (2), wenn GAME_ROUTER_CONTAINER_IP gesetzt ist:
#      Der Hostname-Router (Infrared, Pflichtenheft §2.4 und §13) steht selbst
#      im Spielenetz und waere sonst ein gesperrter Nachbar. Erlaubt ist
#      ausschliesslich die Richtung Router -> Spielserver auf dem Spielport und
#      der Rueckweg bestehender Verbindungen; die Begruendung samt Angriffsbild
#      steht bei der Regel selbst.
#   5. Eine zweite Ausnahme derselben Bauart fuer den Agent
#      (GAME_AGENT_CONTAINER_IP, Fundpunkt 188): Er haengt ebenfalls im
#      Spielenetz und fragt die Spielserver dort periodisch ab - auf jedem
#      Spielport, denn welcher es ist, haengt am Spiel. Auch hier nur die eine
#      Richtung und der Rueckweg bestehender Verbindungen.
#
# WAS ES BEWUSST NICHT TUT: Es fasst keine bestehenden Regeln an. Alles liegt in
# eigenen Ketten mit dem Praefix `PALANTIR-EGRESS`; `remove` nimmt genau die
# wieder heraus und laesst den Rest der Firewall unberuehrt.
#
# NICHT NEUSTARTFEST: iptables-Regeln ueberleben `systemctl restart docker`
# (Docker leert `DOCKER-USER` nicht), aber keinen Neustart der VM. Dauerhaft
# wird das Regelwerk ueber `palantir-egress.service` daneben - der ruft nach
# `docker.service` genau dieses Skript mit `apply` auf.

set -euo pipefail

# -----------------------------------------------------------------------------
# Konfiguration
# -----------------------------------------------------------------------------
# Alle Werte lassen sich per Umgebungsvariable ueberschreiben. Netzname und
# Subnetz kommen, soweit vorhanden, aus derselben zentralen `.env`, die auch
# Agent und Compose lesen (Pflichtenheft §12.1) - damit sie nicht auseinander
# laufen koennen.

REPO_DIR="${PALANTIR_REPO_DIR:-/opt/palantir}"
ENV_FILE="${PALANTIR_ENV_FILE:-${REPO_DIR}/.env}"

# Liest einen Wert aus der `.env`, ohne die Datei auszufuehren (`source` waere
# hier eine Codeausfuehrung mit Root-Rechten aus einer Datei, die Geheimnisse
# traegt). Leerer Rueckgabewert = nicht gesetzt.
get_env_value() {
  local schluessel="$1"
  [[ -r "${ENV_FILE}" ]] || return 0
  sed -n "s/^[[:space:]]*${schluessel}[[:space:]]*=[[:space:]]*//p" "${ENV_FILE}" |
    tail -n 1 |
    sed -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

# Name des Docker-Netzes. Muss zu AGENT_CONTAINER_NETWORK passen - der Agent
# setzt genau diesen Wert als `NetworkMode` beim Anlegen eines Containers.
GAMES_NETWORK="${GAMES_NETWORK:-$(get_env_value AGENT_CONTAINER_NETWORK)}"
GAMES_NETWORK="${GAMES_NETWORK:-palantir-games}"

# Name der Bridge-Schnittstelle. Ohne eigenen Namen vergibt Docker `br-<id>`,
# und die Id aendert sich, sobald das Netz neu angelegt wird - die Regeln
# zeigten dann ins Leere. Hoechstens 15 Zeichen (Linux-Grenze fuer
# Schnittstellennamen).
GAMES_BRIDGE="${GAMES_BRIDGE:-pal-games0}"

# Subnetz des Spielenetzes. Fest vergeben, damit die Regel gegen die
# Nachbar-Container einen konstanten Bereich nennen kann. Kollidiert der Bereich
# mit einem schon vergebenen Docker-Netz, hier einen anderen setzen (und dann
# `remove` + `apply`).
GAMES_SUBNET="${GAMES_SUBNET:-172.31.240.0/24}"

# Bereich, aus dem Docker die Adressen der Spielcontainer VERGIBT. Er ist
# absichtlich kleiner als das Subnetz: Was darueber liegt, bleibt fuer feste
# Adressen frei - allen voran die des Hostname-Routers. Ohne diese Trennung
# koennte ein Spielcontainer die Adresse des Routers wegschnappen, waehrend der
# gerade nicht laeuft; der Router kaeme danach mit "address already in use"
# nicht mehr hoch, und saemtliche Minecraft-Server waeren dunkel.
#
# 172.31.240.1 ist das Gateway, .2 bis .126 sind damit die Spielcontainer. Wer
# mehr als 125 gleichzeitig laufende Container braucht, vergroessert Subnetz und
# Bereich gemeinsam.
GAMES_IP_RANGE="${GAMES_IP_RANGE:-172.31.240.0/25}"

# Feste Adresse des Hostname-Routers (Infrared) im Spielenetz, oder leer.
#
# Muss zu GAME_ROUTER_CONTAINER_IP in der zentralen `.env` passen - dort holt
# sie sich auch `docker-compose.yml` (Dienst `hostname-router`) und `frpc.toml`.
# Ist der Wert leer, entfaellt die Ausnahme unten vollstaendig und das Regelwerk
# ist Zeile fuer Zeile dasselbe wie vor dem Router.
ROUTER_IP="${ROUTER_IP:-$(get_env_value GAME_ROUTER_CONTAINER_IP)}"

# Port, auf dem ein Spielserver IM Container lauscht - das Ziel des Routers.
# Nicht derselbe Wert wie MINECRAFT_ROUTER_PORT: Der ist der oeffentliche Port,
# auf dem der Router selbst lauscht. Dass beide 25565 sind, ist ein Zufall der
# Minecraft-Vorgabe und keine Kopplung.
ROUTER_TARGET_PORT="${ROUTER_TARGET_PORT:-$(get_env_value GAME_ROUTER_TARGET_PORT)}"
ROUTER_TARGET_PORT="${ROUTER_TARGET_PORT:-25565}"

# Feste Adresse des Agents im Spielenetz (Fundpunkt 188). Muss zu
# GAME_AGENT_CONTAINER_IP in der zentralen `.env` passen - dieselbe Adresse
# gibt `docker-compose.yml` dem Dienst `agent`. Von hier aus fragt der Agent die
# Spielserver periodisch ab; die Ausnahme dafuer steht bei den Regeln. Die
# Vorgabe ist dieselbe wie in der Compose-Datei, damit eine Node ohne den
# Eintrag in der `.env` trotzdem stimmig ist.
AGENT_IP="${AGENT_IP:-$(get_env_value GAME_AGENT_CONTAINER_IP)}"
AGENT_IP="${AGENT_IP:-172.31.240.253}"

# WireGuard-Subnetz (VPS und Homeserver). Aus WIREGUARD_VPS_IP abgeleitet,
# damit eine abweichende Tunnel-Adresse in der `.env` hier nicht vergessen wird.
if [[ -z "${WG_SUBNET:-}" ]]; then
  wg_vps_ip="$(get_env_value WIREGUARD_VPS_IP)"
  if [[ "${wg_vps_ip}" =~ ^([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})\.[0-9]{1,3}$ ]]; then
    WG_SUBNET="${BASH_REMATCH[1]}.0/24"
  else
    WG_SUBNET="10.10.0.0/24"
  fi
fi

# Zusaetzlich erlaubte Ziele, durch Leerzeichen getrennt (z. B. ein DNS-Server
# im Heim-LAN: "192.168.1.53"). Diese Eintraege stehen VOR den Sperren.
# Sparsam benutzen - jeder Eintrag ist ein Loch in der Grenze.
EGRESS_ALLOW="${PALANTIR_EGRESS_ALLOW:-}"

# Zweite Kette an `INPUT`, die den Zugriff der Container auf die Dienste der
# Node selbst sperrt (SSH, Docker-Socket-Proxy auf 127.0.0.1 ist ohnehin nicht
# erreichbar, aber z. B. ein Monitoring-Agent auf der Bridge-Adresse). DNS und
# DHCP zum Gateway bleiben offen, sonst loest im Container nichts mehr auf.
# Mit `PALANTIR_EGRESS_HOST_GUARD=0` abschaltbar.
HOST_GUARD="${PALANTIR_EGRESS_HOST_GUARD:-1}"

CHAIN_FWD='PALANTIR-EGRESS'
CHAIN_IN='PALANTIR-EGRESS-IN'

# Private und besondere Zielbereiche, die ein Spielcontainer nie brauchen darf.
# Reihenfolge ist Absicht: Die benannten Bereiche (WireGuard, Spielenetz) stehen
# vorn, damit man in `status` an den Zaehlern sieht, WAS ein Container versucht
# hat - nicht nur, dass etwas verworfen wurde.
GESPERRTE_BEREICHE=(
  "10.0.0.0/8|RFC1918 (Heim-LAN, Tunnel)"
  "172.16.0.0/12|RFC1918 (Docker-Netze, Heim-LAN)"
  "192.168.0.0/16|RFC1918 (Heim-LAN)"
  "169.254.0.0/16|Link-Local und Cloud-Metadaten"
  "100.64.0.0/10|CGNAT / Tailscale"
  "127.0.0.0/8|Loopback"
  "192.0.0.0/24|IETF-Protokollzuteilung"
  "198.18.0.0/15|Netz-Benchmark"
  "224.0.0.0/4|Multicast"
  "240.0.0.0/4|reserviert"
)

log() { printf '[egress %s] %s\n' "$(date -u '+%H:%M:%S')" "$1"; }
warn() { printf '[egress WARNUNG] %s\n' "$1" >&2; }
fail() {
  printf '[egress FEHLER] %s\n' "$1" >&2
  exit 1
}

# -----------------------------------------------------------------------------
# Voraussetzungen
# -----------------------------------------------------------------------------
pruefe_voraussetzungen() {
  [[ "${EUID}" -eq 0 ]] || fail 'Das Skript braucht Root-Rechte (sudo).'
  command -v iptables >/dev/null 2>&1 || fail 'iptables ist nicht installiert.'
  command -v docker >/dev/null 2>&1 || fail 'docker ist nicht installiert.'
  docker info >/dev/null 2>&1 || fail 'Der Docker-Daemon antwortet nicht.'
  # `DOCKER-USER` legt Docker selbst an. Fehlt die Kette, laeuft entweder kein
  # Docker oder es benutzt nftables ohne iptables-Kompatibilitaet - dann muesste
  # das Regelwerk anders gebaut werden, und stillschweigend weiterzumachen waere
  # das Schlimmste: Die Regeln lägen nirgends, und niemand merkte es.
  iptables -n -L DOCKER-USER >/dev/null 2>&1 ||
    fail 'Die Kette DOCKER-USER fehlt - Docker verwaltet die Firewall hier offenbar nicht ueber iptables.'
}

# -----------------------------------------------------------------------------
# Docker-Netz
# -----------------------------------------------------------------------------
netz_anlegen() {
  if docker network inspect "${GAMES_NETWORK}" >/dev/null 2>&1; then
    local ist_bridge ist_bereich
    ist_bridge="$(docker network inspect -f '{{index .Options "com.docker.network.bridge.name"}}' "${GAMES_NETWORK}")"
    if [[ "${ist_bridge}" != "${GAMES_BRIDGE}" ]]; then
      warn "Das Netz ${GAMES_NETWORK} existiert, haengt aber an der Bridge '${ist_bridge}' statt '${GAMES_BRIDGE}'."
      warn 'Die Regeln greifen dann nicht. Alle Spielcontainer stoppen, dann:'
      warn "  docker network rm ${GAMES_NETWORK} && $0 apply"
      fail 'Bridge-Name passt nicht.'
    fi

    # Nur eine Warnung, kein Abbruch: Ein Netz aus der Zeit vor dem
    # Hostname-Router hat keinen Vergabebereich, und ohne Router stoert das
    # nicht. Wer ihn einschaltet, braucht die Trennung aber - sonst kann ein
    # Spielcontainer die feste Adresse des Routers belegen.
    ist_bereich="$(docker network inspect -f '{{range .IPAM.Config}}{{.IPRange}}{{end}}' "${GAMES_NETWORK}")"
    if [[ -n "${ROUTER_IP}" && "${ist_bereich}" != "${GAMES_IP_RANGE}" ]]; then
      warn "Das Netz ${GAMES_NETWORK} vergibt aus '${ist_bereich:-dem ganzen Subnetz}' statt aus '${GAMES_IP_RANGE}'."
      warn "Die feste Adresse des Routers (${ROUTER_IP}) kann damit von einem Spielcontainer belegt werden."
      warn 'Zum Nachziehen alle Spielcontainer und den Router stoppen, dann:'
      warn "  docker network rm ${GAMES_NETWORK} && $0 apply"
    fi

    log "Netz ${GAMES_NETWORK} ist vorhanden (Bridge ${GAMES_BRIDGE})."
    return 0
  fi

  log "Lege Netz ${GAMES_NETWORK} an (Bridge ${GAMES_BRIDGE}, Subnetz ${GAMES_SUBNET}, Vergabe ${GAMES_IP_RANGE}, icc=false)."
  # KEIN `--internal`: das Netz MUSS ins Internet duerfen, sonst brechen Mod-
  # und Plugin-Downloads. Begrenzt wird ueber die Ketten unten, nicht ueber den
  # Netztreiber.
  #
  # `--ip-range` betrifft nur die AUTOMATISCHE Vergabe; eine fest zugewiesene
  # Adresse darf ueberall im Subnetz liegen. Genau das trennt den Router von den
  # Spielcontainern.
  docker network create \
    --driver bridge \
    --subnet "${GAMES_SUBNET}" \
    --ip-range "${GAMES_IP_RANGE}" \
    --opt com.docker.network.bridge.name="${GAMES_BRIDGE}" \
    --opt com.docker.network.bridge.enable_icc=false \
    --opt com.docker.network.bridge.enable_ip_masquerade=true \
    "${GAMES_NETWORK}" >/dev/null ||
    fail "Das Netz ${GAMES_NETWORK} liess sich nicht anlegen (Subnetz ${GAMES_SUBNET} schon vergeben? Dann GAMES_SUBNET setzen)."
}

# -----------------------------------------------------------------------------
# Regelwerk
# -----------------------------------------------------------------------------

# Legt eine Kette an oder leert sie - `apply` ist damit wiederholbar, ohne dass
# sich Regeln stapeln.
kette_bereitstellen() {
  local kette="$1"
  if iptables -n -L "${kette}" >/dev/null 2>&1; then
    iptables -F "${kette}"
  else
    iptables -N "${kette}"
  fi
}

# Haengt den Sprung in die eigene Kette an die erste Stelle der Elternkette -
# aber nur, wenn er nicht schon dort steht.
sprung_setzen() {
  local eltern="$1" kette="$2"
  if ! iptables -C "${eltern}" -i "${GAMES_BRIDGE}" -j "${kette}" 2>/dev/null; then
    iptables -I "${eltern}" 1 -i "${GAMES_BRIDGE}" -j "${kette}"
  fi
}

sprung_loesen() {
  local eltern="$1" kette="$2"
  while iptables -C "${eltern}" -i "${GAMES_BRIDGE}" -j "${kette}" 2>/dev/null; do
    iptables -D "${eltern}" -i "${GAMES_BRIDGE}" -j "${kette}"
  done
}

regeln_forward() {
  kette_bereitstellen "${CHAIN_FWD}"

  # --- Hostname-Router --------------------------------------------------------
  #
  # Steht VOR allem anderen, und zwar aus zwei verschiedenen Gruenden:
  #
  #   * vor der Sperre gegen Nachbar-Container, denn genau die trifft ihn sonst
  #     (der Router steht im selben Netz wie die Spielserver);
  #   * vor der allgemeinen ESTABLISHED-Zeile, denn die springt mit RETURN aus
  #     dieser Kette heraus - und weiter unten in FORWARD steht die DROP-Regel,
  #     die Docker wegen `icc=false` selbst gesetzt hat. Deshalb hier ACCEPT und
  #     nicht RETURN: Nur ACCEPT beendet den Durchlauf der ganzen Kette.
  #
  # WAS DAMIT ERLAUBT IST, und nur das: Verbindungen VON der einen festen
  # Adresse des Routers ZU einem Spielcontainer auf dem einen Spielport. Nichts
  # davon hilft einem uebernommenen Spielcontainer:
  #
  #   * Er ist nicht die Quelle. Sich als der Router auszugeben hiesse, die
  #     Absenderadresse zu faelschen - das braucht CAP_NET_RAW, und die Container
  #     laufen mit `CapDrop: ALL` (`apps/agent/src/runtime/hardening.ts`).
  #     Selbst mit gefaelschter Quelle gingen alle Antworten an den echten
  #     Router; es waere ein blinder Schuss.
  #   * Die zweite Zeile erlaubt nur ESTABLISHED/RELATED zurueck zum Router. Eine
  #     NEUE Verbindung eines Containers zum Router faellt weiterhin unter die
  #     Sperre gegen Nachbar-Container.
  #
  # Unterm Strich erreicht ein uebernommener Spielcontainer nach dieser Ausnahme
  # genau so viel wie vorher: nichts.
  if [[ -n "${ROUTER_IP}" ]]; then
    log "Ausnahme: Router ${ROUTER_IP} darf Spielserver auf Port ${ROUTER_TARGET_PORT} erreichen."
    iptables -A "${CHAIN_FWD}" -s "${ROUTER_IP}" -d "${GAMES_SUBNET}" \
      -p tcp --dport "${ROUTER_TARGET_PORT}" \
      -m comment --comment 'palantir: Hostname-Router -> Spielserver' -j ACCEPT
    iptables -A "${CHAIN_FWD}" -d "${ROUTER_IP}" \
      -m conntrack --ctstate ESTABLISHED,RELATED \
      -m comment --comment 'palantir: Antwort an den Hostname-Router' -j ACCEPT
  fi

  # --- Agent ------------------------------------------------------------------
  #
  # Dieselbe Bauart wie die Ausnahme fuer den Router, aus denselben zwei
  # Gruenden an dieser Stelle - mit einem Unterschied: Der Agent darf JEDEN
  # Port eines Spielcontainers erreichen, nicht nur einen. Er fragt die Server
  # periodisch ueber ihr Spieleprotokoll ab (Pflichtenheft §9, Fundpunkt 188),
  # und welcher Port das ist, haengt am Spiel; das Backend nennt ihn je Server.
  # Ueber den Host-Port ginge es nicht: Der ist an 127.0.0.1 der VM gebunden,
  # und der Agent laeuft im Compose-Netz, nicht im Host-Netz wie frpc.
  #
  # Das Angriffsbild ist dasselbe wie beim Router: Quelle ist allein die feste
  # Adresse des Agents, zurueck kommt nur ESTABLISHED/RELATED. Ein
  # uebernommener Spielcontainer erreicht den Agent damit genauso wenig wie
  # vorher - eine NEUE Verbindung an die Agent-Adresse faellt unter die Sperre
  # gegen Nachbar-Container.
  if [[ -n "${AGENT_IP}" ]]; then
    log "Ausnahme: Agent ${AGENT_IP} darf Spielserver abfragen."
    iptables -A "${CHAIN_FWD}" -s "${AGENT_IP}" -d "${GAMES_SUBNET}" \
      -m comment --comment 'palantir: Agent -> Spielserver (Abfrage)' -j ACCEPT
    iptables -A "${CHAIN_FWD}" -d "${AGENT_IP}" \
      -m conntrack --ctstate ESTABLISHED,RELATED \
      -m comment --comment 'palantir: Antwort an den Agent' -j ACCEPT
  fi

  # Antwortverkehr auf selbst aufgebaute Verbindungen. Steht vorn, damit eine
  # erlaubte Verbindung nicht mitten im Ablauf an einer der Sperren scheitert.
  iptables -A "${CHAIN_FWD}" -m conntrack --ctstate ESTABLISHED,RELATED \
    -m comment --comment 'palantir: bestehende Verbindung' -j RETURN

  # Ausnahmen des Betreibers, VOR den Sperren.
  local ziel
  for ziel in ${EGRESS_ALLOW}; do
    log "Ausnahme: ${ziel} bleibt erreichbar."
    iptables -A "${CHAIN_FWD}" -d "${ziel}" \
      -m comment --comment 'palantir: Ausnahme PALANTIR_EGRESS_ALLOW' -j RETURN
  done

  # Benannte Sperren zuerst - siehe Kommentar an GESPERRTE_BEREICHE.
  iptables -A "${CHAIN_FWD}" -d "${WG_SUBNET}" \
    -m comment --comment 'palantir: WireGuard-Subnetz (frps, Agent-Port)' -j DROP
  iptables -A "${CHAIN_FWD}" -d "${GAMES_SUBNET}" \
    -m comment --comment 'palantir: Nachbar-Container' -j DROP

  local eintrag bereich beschreibung
  for eintrag in "${GESPERRTE_BEREICHE[@]}"; do
    bereich="${eintrag%%|*}"
    beschreibung="${eintrag#*|}"
    iptables -A "${CHAIN_FWD}" -d "${bereich}" \
      -m comment --comment "palantir: ${beschreibung}" -j DROP
  done

  # Alles Uebrige ist eine oeffentliche Adresse und darf hinaus - genau dafuer
  # ist diese Kette eine Sperrliste und keine Positivliste. Mod-Repos,
  # Plugin-Portale und Registries wechseln ihre Adressen zu oft, als dass eine
  # Positivliste im Betrieb haltbar waere.
  iptables -A "${CHAIN_FWD}" \
    -m comment --comment 'palantir: oeffentliches Internet erlaubt' -j RETURN

  sprung_setzen 'DOCKER-USER' "${CHAIN_FWD}"
}

regeln_input() {
  kette_bereitstellen "${CHAIN_IN}"

  iptables -A "${CHAIN_IN}" -m conntrack --ctstate ESTABLISHED,RELATED \
    -m comment --comment 'palantir: bestehende Verbindung' -j RETURN
  # Namensaufloesung und Adressvergabe laufen ueber das Bridge-Gateway, also
  # ueber die Node selbst. Ohne diese beiden Ausnahmen loest im Container nichts
  # mehr auf, und der Container bekaeme keine Adresse.
  iptables -A "${CHAIN_IN}" -p udp --dport 53 \
    -m comment --comment 'palantir: DNS zum Gateway' -j RETURN
  iptables -A "${CHAIN_IN}" -p tcp --dport 53 \
    -m comment --comment 'palantir: DNS zum Gateway' -j RETURN
  iptables -A "${CHAIN_IN}" -p udp --dport 67 \
    -m comment --comment 'palantir: DHCP zum Gateway' -j RETURN
  iptables -A "${CHAIN_IN}" \
    -m comment --comment 'palantir: Dienste der Node gesperrt' -j DROP

  sprung_setzen 'INPUT' "${CHAIN_IN}"
}

# IPv6 nur, wenn die Node ueberhaupt IPv6 ueber iptables verwaltet. Docker legt
# `DOCKER-USER` in ip6tables nur an, wenn `ip6tables: true` im Daemon steht.
# Ist das nicht der Fall, haben die Container kein IPv6 - dann gibt es nichts zu
# sperren, und das Skript sagt das, statt still nichts zu tun.
regeln_ipv6() {
  if ! command -v ip6tables >/dev/null 2>&1; then
    log 'IPv6: ip6tables nicht vorhanden - uebersprungen.'
    return 0
  fi
  if ! ip6tables -n -L DOCKER-USER >/dev/null 2>&1; then
    log 'IPv6: Docker verwaltet kein ip6tables (Container haben kein IPv6) - uebersprungen.'
    return 0
  fi

  if ip6tables -n -L "${CHAIN_FWD}" >/dev/null 2>&1; then
    ip6tables -F "${CHAIN_FWD}"
  else
    ip6tables -N "${CHAIN_FWD}"
  fi

  ip6tables -A "${CHAIN_FWD}" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
  # Unique-Local, Link-Local und Multicast - das IPv6-Gegenstueck zu RFC1918.
  ip6tables -A "${CHAIN_FWD}" -d fc00::/7 -j DROP
  ip6tables -A "${CHAIN_FWD}" -d fe80::/10 -j DROP
  ip6tables -A "${CHAIN_FWD}" -d ff00::/8 -j DROP
  ip6tables -A "${CHAIN_FWD}" -j RETURN

  if ! ip6tables -C DOCKER-USER -i "${GAMES_BRIDGE}" -j "${CHAIN_FWD}" 2>/dev/null; then
    ip6tables -I DOCKER-USER 1 -i "${GAMES_BRIDGE}" -j "${CHAIN_FWD}"
  fi
  log 'IPv6: Sperren gesetzt.'
}

# -----------------------------------------------------------------------------
# Unterbefehle
# -----------------------------------------------------------------------------
befehl_apply() {
  pruefe_voraussetzungen
  netz_anlegen
  regeln_forward
  if [[ "${HOST_GUARD}" == '1' ]]; then
    regeln_input
  else
    log 'Host-Schutz abgeschaltet (PALANTIR_EGRESS_HOST_GUARD=0) - Container erreichen Dienste der Node.'
    sprung_loesen 'INPUT' "${CHAIN_IN}"
  fi
  regeln_ipv6
  log "Fertig. Netz ${GAMES_NETWORK}, Bridge ${GAMES_BRIDGE}, gesperrt u. a. ${WG_SUBNET} und ${GAMES_SUBNET}."
  log "Pruefen mit: $0 status"
}

befehl_status() {
  command -v iptables >/dev/null 2>&1 || fail 'iptables ist nicht installiert.'
  printf 'Netz:   %s (Bridge %s, Subnetz %s, Vergabe %s)\n' \
    "${GAMES_NETWORK}" "${GAMES_BRIDGE}" "${GAMES_SUBNET}" "${GAMES_IP_RANGE}"
  printf 'Tunnel: %s\n' "${WG_SUBNET}"
  printf 'Router: %s\n' "${ROUTER_IP:-nicht eingerichtet}"
  printf 'Agent:  %s\n\n' "${AGENT_IP:-nicht eingerichtet}"
  if iptables -n -L "${CHAIN_FWD}" -v >/dev/null 2>&1; then
    printf -- '--- %s (Zaehler zeigen Treffer seit "apply") ---\n' "${CHAIN_FWD}"
    iptables -n -L "${CHAIN_FWD}" -v --line-numbers
  else
    warn "Die Kette ${CHAIN_FWD} fehlt - das Regelwerk ist NICHT aktiv."
  fi
  if iptables -n -L "${CHAIN_IN}" >/dev/null 2>&1; then
    printf -- '\n--- %s ---\n' "${CHAIN_IN}"
    iptables -n -L "${CHAIN_IN}" -v --line-numbers
  fi
  printf -- '\n--- Sprung in DOCKER-USER ---\n'
  iptables -n -L DOCKER-USER -v --line-numbers
}

# Nimmt ausschliesslich die eigenen Ketten zurueck. Das Docker-Netz bleibt
# bestehen - es zu loeschen wuerde jeden laufenden Spielserver mitreissen. Wer
# es wirklich los wird, stoppt erst die Container und ruft dann
# `docker network rm` von Hand auf.
befehl_remove() {
  [[ "${EUID}" -eq 0 ]] || fail 'Das Skript braucht Root-Rechte (sudo).'
  command -v iptables >/dev/null 2>&1 || fail 'iptables ist nicht installiert.'

  sprung_loesen 'DOCKER-USER' "${CHAIN_FWD}"
  sprung_loesen 'INPUT' "${CHAIN_IN}"
  local kette
  for kette in "${CHAIN_FWD}" "${CHAIN_IN}"; do
    if iptables -n -L "${kette}" >/dev/null 2>&1; then
      iptables -F "${kette}"
      iptables -X "${kette}"
    fi
  done

  if command -v ip6tables >/dev/null 2>&1 && ip6tables -n -L DOCKER-USER >/dev/null 2>&1; then
    while ip6tables -C DOCKER-USER -i "${GAMES_BRIDGE}" -j "${CHAIN_FWD}" 2>/dev/null; do
      ip6tables -D DOCKER-USER -i "${GAMES_BRIDGE}" -j "${CHAIN_FWD}"
    done
    if ip6tables -n -L "${CHAIN_FWD}" >/dev/null 2>&1; then
      ip6tables -F "${CHAIN_FWD}"
      ip6tables -X "${CHAIN_FWD}"
    fi
  fi

  log 'Regelwerk entfernt. Das Netz selbst bleibt bestehen (laufende Server).'
  warn 'Die Spielcontainer erreichen jetzt wieder Heim-LAN und Tunnel.'
}

befehl_hilfe() {
  cat <<'HILFE'
Palantir - Ausgangsbeschraenkung fuer Spielserver-Container (Gamenode, als root).

  egress-firewall.sh apply    Netz anlegen und Regeln setzen (wiederholbar)
  egress-firewall.sh status   Ketten und Trefferzaehler anzeigen
  egress-firewall.sh remove   Nur die Palantir-Ketten zuruecknehmen
  egress-firewall.sh help     Diese Uebersicht

Umgebungsvariablen (alle optional):
  GAMES_NETWORK               Netzname (Vorgabe: AGENT_CONTAINER_NETWORK aus
                              der .env, sonst palantir-games)
  GAMES_BRIDGE                Bridge-Schnittstelle (Vorgabe: pal-games0)
  GAMES_SUBNET                Subnetz des Spielenetzes (Vorgabe 172.31.240.0/24)
  GAMES_IP_RANGE              Bereich der automatisch vergebenen Adressen
                              (Vorgabe 172.31.240.0/25); darueber bleibt Platz
                              fuer feste Adressen wie die des Routers
  ROUTER_IP                   Feste Adresse des Hostname-Routers (Vorgabe:
                              GAME_ROUTER_CONTAINER_IP aus der .env). Leer =
                              kein Router, keine Ausnahme
  ROUTER_TARGET_PORT          Port des Spielservers IM Container, den der Router
                              anwaehlen darf (Vorgabe: GAME_ROUTER_TARGET_PORT
                              aus der .env, sonst 25565)
  WG_SUBNET                   WireGuard-Subnetz (Vorgabe aus WIREGUARD_VPS_IP)
  PALANTIR_EGRESS_ALLOW       Zusaetzlich erlaubte Ziele, durch Leerzeichen
                              getrennt (z. B. "192.168.1.53" fuer einen
                              DNS-Server im Heim-LAN)
  PALANTIR_EGRESS_HOST_GUARD  1 (Vorgabe) sperrt zusaetzlich die Dienste der
                              Node selbst; 0 schaltet diesen Teil ab
  PALANTIR_ENV_FILE           Pfad zur zentralen .env (Vorgabe /opt/palantir/.env)
HILFE
}

case "${1:-apply}" in
  apply) befehl_apply ;;
  status) befehl_status ;;
  remove) befehl_remove ;;
  help | -h | --help) befehl_hilfe ;;
  *)
    befehl_hilfe >&2
    fail "Unbekannter Unterbefehl: ${1}"
    ;;
esac
