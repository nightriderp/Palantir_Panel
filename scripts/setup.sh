#!/usr/bin/env bash
#
# Palantir - Setup-Wizard (Pflichtenheft §12.2)
#
# Ausführen auf der Maschine, auf der Palantir betrieben wird:
#   VPS:        /opt/palantir/scripts/setup.sh
#   Homeserver: /opt/palantir/scripts/setup.sh   (in der Gameserver-VM)
#
#   cd /opt/palantir && ./scripts/setup.sh
#
# Das Skript:
#   1. kopiert .env.example nach .env, falls noch nicht vorhanden
#   2. erzeugt sichere Secrets (JWT, CSRF, ALTCHA, Agent-Token, frp-Token)
#   3. erzeugt WireGuard-Schlüsselpaare für VPS und Homeserver
#   4. prüft die Pflichtfelder (Domain, OAuth-Provider, DATABASE_URL, frp-Token)
#
# Bestehende, bereits gefüllte Werte werden NIEMALS überschrieben.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"
ENV_EXAMPLE="${REPO_ROOT}/.env.example"

info() { printf '\033[0;36m[setup]\033[0m %s\n' "$1"; }
ok() { printf '\033[0;32m[ ok ]\033[0m %s\n' "$1"; }
warn() { printf '\033[0;33m[warn]\033[0m %s\n' "$1"; }
fail() {
  printf '\033[0;31m[fehler]\033[0m %s\n' "$1" >&2
  exit 1
}

# -----------------------------------------------------------------------------
# Hilfsfunktionen
# -----------------------------------------------------------------------------

# get_env_value KEY -> gibt den aktuellen Wert aus .env aus (leer, wenn ungesetzt)
get_env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "${ENV_FILE}" | head -n 1
}

# set_env_value KEY VALUE -> setzt den Wert in .env (Zeile muss existieren)
set_env_value() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  awk -v key="${key}" -v value="${value}" '
    BEGIN { done = 0 }
    !done && index($0, key "=") == 1 { print key "=" value; done = 1; next }
    { print }
    END { if (!done) print key "=" value }
  ' "${ENV_FILE}" >"${tmp}"
  mv "${tmp}" "${ENV_FILE}"
}

# fill_if_unset KEY VALUE -> setzt den Wert nur, wenn noch keiner dasteht
#
# "Kein Wert" ist dabei zweierlei: die leere Zeile UND der Platzhalter
# CHANGE_ME aus der Vorlage (Audit W2-23, infra-images-04). Ohne den zweiten
# Fall lief der Spiele-Tunnel mit dem öffentlich bekannten Token `CHANGE_ME`
# weiter, und der Wizard meldete trotzdem "Alle Pflichtfelder gesetzt".
# `sync_database_password` behandelt den Platzhalter seit jeher so; hier gilt
# nun dieselbe Regel. Ein echter, bereits gefüllter Wert bleibt unangetastet.
fill_if_unset() {
  local key="$1" value="$2" aktuell
  aktuell="$(get_env_value "${key}")"
  if [[ -z "${aktuell}" || "${aktuell}" == "CHANGE_ME" ]]; then
    set_env_value "${key}" "${value}"
    ok "${key} erzeugt"
  else
    info "${key} bereits gesetzt - bleibt unverändert"
  fi
}

random_secret() {
  # 48 Byte Zufall, base64-kodiert und auf URL-sichere Zeichen reduziert.
  openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-64
}

# -----------------------------------------------------------------------------
# 1. .env erzeugen
# -----------------------------------------------------------------------------

[[ -f "${ENV_EXAMPLE}" ]] || fail ".env.example nicht gefunden unter ${ENV_EXAMPLE}"

if [[ -f "${ENV_FILE}" ]]; then
  info ".env existiert bereits - vorhandene Werte werden nicht überschrieben"
else
  cp "${ENV_EXAMPLE}" "${ENV_FILE}"
  ok ".env aus .env.example erzeugt"
fi

# Sicherheitsauflage aus Pflichtenheft §12.1
chmod 600 "${ENV_FILE}"
ok "Dateirechte auf .env restriktiv gesetzt (600)"

# -----------------------------------------------------------------------------
# 2. Secrets erzeugen
# -----------------------------------------------------------------------------

command -v openssl >/dev/null 2>&1 || fail "openssl wird benötigt (apt install openssl)"

info "Erzeuge fehlende Secrets ..."
fill_if_unset JWT_SECRET "$(random_secret)"
fill_if_unset CSRF_SECRET "$(random_secret)"
fill_if_unset ALTCHA_HMAC_KEY "$(random_secret)"
fill_if_unset AGENT_TOKEN "$(random_secret)"
# Zweite Schranke des Spiele-Tunnels neben WireGuard (Pflichtenheft §2.4):
# ohne Token nimmt frps jeden Client an, der die Steuerkanal-Adresse erreicht,
# und kann Proxies für den gesamten Spielport-Bereich anmelden.
fill_if_unset FRP_TOKEN "$(random_secret)"

cat <<'HINT'

  Hinweis zu den gemeinsamen Geheimnissen:
    - AGENT_TOKEN und FRP_TOKEN müssen auf VPS und Homeserver IDENTISCH sein.
    - Dieses Skript erzeugt sie je Maschine neu. Wer es auf beiden Maschinen
      getrennt laufen lässt, bekommt zwei verschiedene Werte: Der Agent meldet
      sich dann nicht an und der Spiele-Tunnel bleibt zu.
    - Richtige Reihenfolge: zuerst auf der VPS ausführen, danach die beiden
      Werte in die .env des Homeservers übernehmen (oder die .env als Ganzes).

HINT

# Datenbank-Passwort erzeugen und konsistent in POSTGRES_PASSWORD *und* die
# darin eingebettete DATABASE_URL schreiben. POSTGRES_PASSWORD ist die Quelle der
# Wahrheit; die DATABASE_URL wird immer auf denselben Wert nachgezogen.
# Idempotent: ein bereits gesetztes echtes Passwort bleibt unverändert, nur der
# Platzhalter CHANGE_ME (bzw. ein leerer Wert) wird gefüllt.
sync_database_password() {
  local pg_pw db_url pw updated
  pg_pw="$(get_env_value POSTGRES_PASSWORD)"
  db_url="$(get_env_value DATABASE_URL)"

  if [[ -z "${pg_pw}" || "${pg_pw}" == "CHANGE_ME" ]]; then
    pw="$(random_secret)"
    set_env_value POSTGRES_PASSWORD "${pw}"
    ok "POSTGRES_PASSWORD erzeugt"
  else
    pw="${pg_pw}"
    info "POSTGRES_PASSWORD bereits gesetzt - bleibt unverändert"
  fi

  # DATABASE_URL auf denselben Wert bringen. random_secret liefert nur
  # URL-sichere Zeichen (A-Z a-z 0-9), daher ist keine Prozent-Kodierung nötig.
  if [[ -n "${db_url}" ]]; then
    # nur den Passwort-Teil zwischen "user:" und "@host" ersetzen
    updated="$(printf '%s' "${db_url}" |
      sed -E "s#^(postgresql://[^:/@]+:)[^@]*(@.*)#\1${pw}\2#")"
  else
    # Hostname `postgres` = der Datenbank-Dienst im Docker-Netz
    # (deploy/vps/docker-compose.yml). Backend und Migrationen laufen selbst
    # als Container; `127.0.0.1` wäre dort die Loopback-Adresse des eigenen
    # Containers und der Start endete mit ECONNREFUSED
    # (Audit W2-23, infra-images-16).
    updated="postgresql://$(get_env_value POSTGRES_USER):${pw}@postgres:5432/$(get_env_value POSTGRES_DB)"
  fi

  if [[ "${updated}" != "${db_url}" ]]; then
    set_env_value DATABASE_URL "${updated}"
    ok "DATABASE_URL auf das Datenbank-Passwort abgeglichen"
  else
    info "DATABASE_URL bereits konsistent - bleibt unverändert"
  fi
}

sync_database_password

# -----------------------------------------------------------------------------
# 3. WireGuard-Schlüsselpaare (Pflichtenheft §2.1)
# -----------------------------------------------------------------------------

if command -v wg >/dev/null 2>&1; then
  if [[ -z "$(get_env_value WIREGUARD_VPS_PRIVATE_KEY)" ]]; then
    vps_priv="$(wg genkey)"
    vps_pub="$(printf '%s' "${vps_priv}" | wg pubkey)"
    set_env_value WIREGUARD_VPS_PRIVATE_KEY "${vps_priv}"
    set_env_value WIREGUARD_VPS_PUBLIC_KEY "${vps_pub}"
    ok "WireGuard-Schlüsselpaar für die VPS erzeugt"
  else
    info "WireGuard-Schlüssel der VPS bereits gesetzt - bleibt unverändert"
  fi

  if [[ -z "$(get_env_value WIREGUARD_HOME_PRIVATE_KEY)" ]]; then
    home_priv="$(wg genkey)"
    home_pub="$(printf '%s' "${home_priv}" | wg pubkey)"
    set_env_value WIREGUARD_HOME_PRIVATE_KEY "${home_priv}"
    set_env_value WIREGUARD_HOME_PUBLIC_KEY "${home_pub}"
    ok "WireGuard-Schlüsselpaar für den Homeserver erzeugt"
  else
    info "WireGuard-Schlüssel des Homeservers bereits gesetzt - bleibt unverändert"
  fi

  cat <<'HINT'

  Hinweis zur Verteilung der WireGuard-Schlüssel:
    - WIREGUARD_VPS_PRIVATE_KEY  gehört ausschließlich in /etc/wireguard/wg0.conf auf der VPS
    - WIREGUARD_HOME_PRIVATE_KEY gehört ausschließlich in /etc/wireguard/wg0.conf des Homeservers
    - Die jeweils öffentlichen Schlüssel werden auf der Gegenseite als Peer eingetragen.
  Die fertigen wg0.conf werden weiter unten erzeugt (Verzeichnis wireguard/).

HINT
else
  warn "wg (wireguard-tools) nicht gefunden - Schlüsselpaare wurden NICHT erzeugt."
  warn "Nachholen mit:  apt install wireguard-tools && ./scripts/setup.sh"
fi

# -----------------------------------------------------------------------------
# 3b. Fertige wg0.conf für VPS und Homeserver erzeugen (SETUP.md §6.2/§6.3)
# -----------------------------------------------------------------------------
# Beide Dateien landen im lokalen, per .gitignore ausgeschlossenen Verzeichnis
# "wireguard/" - sie enthalten private Schlüssel und dürfen NIE ins Repo.
# Von dort werden sie an ihren jeweiligen Zielort kopiert (Ausgabe unten).
generate_wireguard_configs() {
  local wg_dir="${REPO_ROOT}/wireguard"
  local vps_priv vps_pub home_priv home_pub vps_ip home_ip port keepalive endpoint

  vps_priv="$(get_env_value WIREGUARD_VPS_PRIVATE_KEY)"
  vps_pub="$(get_env_value WIREGUARD_VPS_PUBLIC_KEY)"
  home_priv="$(get_env_value WIREGUARD_HOME_PRIVATE_KEY)"
  home_pub="$(get_env_value WIREGUARD_HOME_PUBLIC_KEY)"

  if [[ -z "${vps_priv}" || -z "${vps_pub}" || -z "${home_priv}" || -z "${home_pub}" ]]; then
    warn "WireGuard-Schlüssel noch unvollständig - wg0.conf wird noch nicht erzeugt."
    return 0
  fi

  vps_ip="$(get_env_value WIREGUARD_VPS_IP)"
  home_ip="$(get_env_value WIREGUARD_HOME_IP)"
  port="$(get_env_value WIREGUARD_LISTEN_PORT)"
  keepalive="$(get_env_value WIREGUARD_KEEPALIVE)"
  endpoint="$(get_env_value VPS_PUBLIC_IP)"

  mkdir -p "${wg_dir}"
  chmod 700 "${wg_dir}"

  # VPS: kennt keinen Endpoint des Homeservers (der sitzt hinter NAT).
  cat >"${wg_dir}/wg0.vps.conf" <<EOF
[Interface]
Address = ${vps_ip}/24
ListenPort = ${port}
PrivateKey = ${vps_priv}

[Peer]
# Homeserver
PublicKey = ${home_pub}
AllowedIPs = ${home_ip}/32
EOF

  # Homeserver: baut die Verbindung aktiv auf und verwirft eingehenden
  # Tunnelverkehr (PostUp/PostDown, Pflicht - siehe deploy/gamenode/wireguard-firewall.md).
  cat >"${wg_dir}/wg0.home.conf" <<EOF
[Interface]
Address = ${home_ip}/24
PrivateKey = ${home_priv}
PostUp = nft add table inet palantir_wg; nft add chain inet palantir_wg input '{ type filter hook input priority 0; policy accept; }'; nft add rule inet palantir_wg input iifname "wg0" ct state established,related accept; nft add rule inet palantir_wg input iifname "wg0" drop
PostDown = nft delete table inet palantir_wg

[Peer]
# VPS
PublicKey = ${vps_pub}
Endpoint = ${endpoint}:${port}
AllowedIPs = ${vps_ip}/32
PersistentKeepalive = ${keepalive}
EOF

  chmod 600 "${wg_dir}/wg0.vps.conf" "${wg_dir}/wg0.home.conf"

  ok "wg0.conf für beide Maschinen erzeugt"
  cat <<EOF

  Fertige WireGuard-Konfigurationen liegen unter ${wg_dir}/ .
  Jede gehört an GENAU EINEN Zielort (dort jeweils als /etc/wireguard/wg0.conf):
    - ${wg_dir}/wg0.vps.conf   ->  VPS:               /etc/wireguard/wg0.conf
    - ${wg_dir}/wg0.home.conf  ->  Homeserver (VM):   /etc/wireguard/wg0.conf
  Danach je Maschine:  systemctl enable --now wg-quick@wg0
  Die Datei mit dem PRIVATE-Key der jeweils ANDEREN Maschine wird NICHT kopiert.
EOF

  if [[ -z "${endpoint}" || "${endpoint}" == "203.0.113.10" ]]; then
    warn "VPS_PUBLIC_IP steht noch auf dem Beispielwert - Endpoint in wg0.home.conf vor dem Kopieren prüfen."
  fi
}

generate_wireguard_configs

# -----------------------------------------------------------------------------
# 4. Pflichtfeld-Prüfung
# -----------------------------------------------------------------------------

info "Prüfe Pflichtfelder ..."
errors=0

domain="$(get_env_value PALANTIR_DOMAIN)"
if [[ -z "${domain}" || "${domain}" == "example.tld" ]]; then
  warn "PALANTIR_DOMAIN ist nicht gesetzt (steht noch auf 'example.tld')"
  errors=$((errors + 1))
fi

has_oauth=0
[[ -n "$(get_env_value DISCORD_CLIENT_ID)" && -n "$(get_env_value DISCORD_CLIENT_SECRET)" ]] && has_oauth=1
[[ -n "$(get_env_value TWITCH_CLIENT_ID)" && -n "$(get_env_value TWITCH_CLIENT_SECRET)" ]] && has_oauth=1
[[ -n "$(get_env_value STEAM_API_KEY)" ]] && has_oauth=1

if [[ "${has_oauth}" -eq 0 ]]; then
  warn "Kein OAuth-/OpenID-Provider konfiguriert (Discord, Twitch oder Steam)"
  errors=$((errors + 1))
fi

database_url="$(get_env_value DATABASE_URL)"
if [[ -z "${database_url}" || "${database_url}" == *"CHANGE_ME"* ]]; then
  warn "DATABASE_URL enthält noch den Platzhalter CHANGE_ME"
  errors=$((errors + 1))
elif [[ "${database_url}" == *"@127.0.0.1:"* || "${database_url}" == *"@localhost:"* ]]; then
  # Kein Fehler, nur ein Hinweis: Für die lokale Entwicklung ist genau das
  # richtig. Im Docker-Stack dagegen ist 127.0.0.1 die Loopback-Adresse des
  # Backend-Containers selbst - die Migrationen scheitern mit ECONNREFUSED,
  # und Backend wie Frontend kommen wegen service_completed_successfully nie
  # hoch (Audit W2-23, infra-images-16).
  warn "DATABASE_URL zeigt auf 127.0.0.1/localhost - im Docker-Stack muss der Host 'postgres' heißen."
fi

# Der Spiele-Tunnel wird oben erzeugt; diese Prüfung ist der Rückfall für den
# Fall, dass das Erzeugen nichts geliefert hat oder jemand den Platzhalter von
# Hand zurückgeschrieben hat (Audit W2-23, infra-images-04). Ohne Token nimmt
# frps jeden Client an, der den Steuerkanal erreicht.
frp_token="$(get_env_value FRP_TOKEN)"
if [[ -z "${frp_token}" || "${frp_token}" == "CHANGE_ME" ]]; then
  warn "FRP_TOKEN ist leer oder steht noch auf CHANGE_ME - der Spiele-Tunnel hätte keine zweite Schranke"
  errors=$((errors + 1))
fi

echo
if [[ "${errors}" -gt 0 ]]; then
  warn "${errors} Pflichtfeld(er) offen - bitte ${ENV_FILE} ergänzen und Skript erneut ausführen."
  warn "Details zu jedem Feld stehen als Kommentar in .env.example, Schritt-für-Schritt in SETUP.md."
  exit 1
fi

ok "Alle Pflichtfelder gesetzt. Weiter mit:  docker compose up -d"
