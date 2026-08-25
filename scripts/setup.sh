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
#   2. erzeugt sichere Secrets (JWT, CSRF, ALTCHA, Agent-Token)
#   3. erzeugt WireGuard-Schlüsselpaare für VPS und Homeserver
#   4. prüft die Pflichtfelder (Domain, mindestens ein OAuth-Provider)
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

# fill_if_empty KEY VALUE -> setzt den Wert nur, wenn er noch leer ist
fill_if_empty() {
  local key="$1" value="$2"
  if [[ -z "$(get_env_value "${key}")" ]]; then
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
fill_if_empty JWT_SECRET "$(random_secret)"
fill_if_empty CSRF_SECRET "$(random_secret)"
fill_if_empty ALTCHA_HMAC_KEY "$(random_secret)"
fill_if_empty AGENT_TOKEN "$(random_secret)"

# TODO(setup): Datenbank-Passwort (POSTGRES_PASSWORD / DATABASE_URL) wird noch
# nicht automatisch erzeugt, weil DATABASE_URL denselben Wert eingebettet
# enthält und beide Stellen konsistent geschrieben werden müssen.
# Bis dahin: POSTGRES_PASSWORD und DATABASE_URL von Hand auf denselben Wert
# setzen (Platzhalter CHANGE_ME in beiden Zeilen).

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
  Die fertigen wg0.conf-Vorlagen stehen in SETUP.md.

HINT
else
  warn "wg (wireguard-tools) nicht gefunden - Schlüsselpaare wurden NICHT erzeugt."
  warn "Nachholen mit:  apt install wireguard-tools && ./scripts/setup.sh"
fi

# TODO(setup): Fertige wg0.conf für VPS und Homeserver direkt aus den Werten der
# .env generieren, sobald die endgültigen AllowedIPs/Routing-Regeln feststehen.

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

if [[ -z "$(get_env_value DATABASE_URL)" || "$(get_env_value DATABASE_URL)" == *"CHANGE_ME"* ]]; then
  warn "DATABASE_URL enthält noch den Platzhalter CHANGE_ME"
  errors=$((errors + 1))
fi

echo
if [[ "${errors}" -gt 0 ]]; then
  warn "${errors} Pflichtfeld(er) offen - bitte ${ENV_FILE} ergänzen und Skript erneut ausführen."
  warn "Details zu jedem Feld stehen als Kommentar in .env.example, Schritt-für-Schritt in SETUP.md."
  exit 1
fi

ok "Alle Pflichtfelder gesetzt. Weiter mit:  docker compose up -d"
