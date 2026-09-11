#!/bin/sh
#
# Startskript des Enshrouded-Images – das erste Spiel unter Proton.
#
# Enshrouded gibt es nur als Windows-Server. Das Bild ist deshalb ein anderes
# als bei den Linux-Spielen:
#
#   1. SteamCMD holt die **Windows-Dateien** (`proton_app_holen`).
#   2. Proton legt beim ersten Start einen Wine-Prefix an – ein ganzes
#      Windows-Dateisystem in Miniatur. Das dauert und passiert genau einmal.
#   3. Die Einstellungen stehen in einer JSON-Datei, die bei jedem Start neu
#      geschrieben wird.
#   4. Gestartet wird über `proton run`, nicht direkt.

set -eu

. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/steam.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/proton.sh"

# Anwendungsnummer des dedizierten Servers bei Valve.
ENSHROUDED_ANWENDUNG=2278520

SERVER="${PALANTIR_DATENORDNER}/server"
# Enshrouded legt seine Spielstände neben die Serverdateien; `saveDirectory` in
# der Konfiguration zeigt sie woandershin – dorthin, wo sie eine
# Neuinstallation überleben.
WELTEN="${PALANTIR_DATENORDNER}/welten"

log() {
  palantir_log "$@"
}

palantir_intern_anlegen
mkdir -p "$WELTEN"

# -----------------------------------------------------------------------------
# 1. Serverdateien (Windows)
proton_app_holen "$ENSHROUDED_ANWENDUNG" "$SERVER"

BINAERDATEI="${SERVER}/enshrouded_server.exe"

if [ ! -f "$BINAERDATEI" ]; then
  log "Der Server fehlt: ${BINAERDATEI}"
  log 'Kam SteamCMD an die Windows-Dateien? Den Ordner "server" im Datenordner'
  log 'löschen und neu starten holt sie erneut.'
  exit 78
fi

# -----------------------------------------------------------------------------
# 2. enshrouded_server.json
#
# `json_text` maskiert, was ein JSON-Text nicht verträgt. Ohne das zerbräche ein
# Anführungszeichen im Servernamen die Datei, und der Server startete mit
# Vorgaben – ohne Passwort.
json_text() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\r//g' | tr -d '\n'
}

PORT="${SERVER_PORT:-15636}"
ABFRAGE_PORT="${ENSHROUDED_QUERY_PORT:-15637}"

# Proton sieht den Datenordner als Windows-Laufwerk `Z:`. Ein Linux-Pfad in der
# Konfiguration liefe ins Leere – deshalb die Übersetzung.
windows_pfad() {
  printf 'Z:%s' "$(printf '%s' "$1" | tr '/' '\\')"
}

{
  printf '{\n'
  printf '  "name": "%s",\n' "$(json_text "${ENSHROUDED_NAME:-Ein Palantir-Server}")"
  printf '  "saveDirectory": "%s",\n' "$(json_text "$(windows_pfad "$WELTEN")")"
  printf '  "logDirectory": "%s",\n' "$(json_text "$(windows_pfad "${PALANTIR_INTERN}/logs")")"
  printf '  "ip": "0.0.0.0",\n'
  printf '  "gamePort": %s,\n' "$PORT"
  printf '  "queryPort": %s,\n' "$ABFRAGE_PORT"
  printf '  "slotCount": %s,\n' "${MAX_PLAYERS:-16}"
  # Drei Rollen, wie das Spiel sie kennt. Das Passwort des Betreibers gilt für
  # die Rolle mit allen Rechten; die anderen beiden bekommen es ebenfalls, wenn
  # keines gesetzt ist – sonst käme niemand herein.
  printf '  "userGroups": [\n'
  printf '    { "name": "Admin", "password": "%s", "canKickBan": true, "canAccessInventories": true, "canEditBase": true, "canExtendBase": true, "reservedSlots": 0 },\n' \
    "$(json_text "${ENSHROUDED_ADMIN_PASSWORD:-}")"
  printf '    { "name": "Friend", "password": "%s", "canKickBan": false, "canAccessInventories": true, "canEditBase": true, "canExtendBase": false, "reservedSlots": 0 },\n' \
    "$(json_text "${ENSHROUDED_PASSWORD:-}")"
  printf '    { "name": "Guest", "password": "%s", "canKickBan": false, "canAccessInventories": false, "canEditBase": false, "canExtendBase": false, "reservedSlots": 0 }\n' \
    "$(json_text "${ENSHROUDED_GUEST_PASSWORD:-}")"
  printf '  ]\n'
  printf '}\n'
} > "${SERVER}/enshrouded_server.json"

mkdir -p "${PALANTIR_INTERN}/logs"

# -----------------------------------------------------------------------------
# 3. Proton
proton_vorbereiten

# -----------------------------------------------------------------------------
# 4. Konsole und Start
#
# Enshrouded nimmt keine Befehle entgegen – weder über die Standardeingabe noch
# über RCON. Das Rohr entsteht trotzdem, damit sich das Image verhält wie jedes
# andere; die Spieltyp-Definition sagt mit `console: { kind: 'none' }`, dass das
# Panel nur die Ausgabe zeigt.
palantir_konsole_oeffnen

log "Startet Enshrouded auf Port ${PORT} (Abfrage ${ABFRAGE_PORT}) unter Proton"

cd "$SERVER"

# Ohne `exec`: Zwischen Signal und Spielserver stehen hier ohnehin Proton und
# Wine. Das Signal erreicht die Shell, die es an die Gruppe weiterreicht – mehr
# ist bei einem Server, der nichts entgegennimmt, nicht zu holen.
proton_lauf "$BINAERDATEI" 0<&3 3>&-
