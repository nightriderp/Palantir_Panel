#!/bin/sh
#
# Startskript des Images für Assetto Corsa Competizione.
#
# **Anonym gibt es die Serverdateien nicht.** Bei Kunos ist der dedizierte
# Server ein Steam-Werkzeug am Elternspiel (Anwendung 1430110, Eltern 805550);
# ein anonymer Abruf endet mit „No subscription". Es braucht ein Konto, das ACC
# besitzt.
#
# Deshalb zwei Wege, und beide ohne Passwort im Panel:
#
#   1. **Steam-Konto.** Der Betreiber meldet sich einmal von Hand auf der Node
#      an; der Token wird schreibgeschützt eingehängt, im Panel steht nur der
#      Benutzername. Dann holt und aktualisiert sich der Server selbst.
#   2. **Von Hand.** Den Serverordner aus der eigenen ACC-Installation über den
#      Datei-Manager nach `/data/server` legen. Er wiegt keine hundert Megabyte.
#
# Was das Image tut: die drei Konfigurationsdateien schreiben – **in UTF-16 LE
# mit Byte-Reihenfolge-Marke**, denn UTF-8 liest ACC still falsch – und
# `accServer.exe` unter Proton starten.

set -eu

. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/steam.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/proton.sh"

SERVER="${PALANTIR_DATENORDNER}/server"
CFG="${SERVER}/cfg"

log() {
  palantir_log "$@"
}

palantir_intern_anlegen

# -----------------------------------------------------------------------------
# 1. Serverdateien holen – wenn ein Steam-Konto hinterlegt ist
#
# Anonym gibt Valve diese Anwendung nicht heraus („No subscription"): Sie ist
# ein Werkzeug am Elternspiel. Steht im Panel ein Steam-Benutzername, liegt auf
# der Node auch ein Anmelde-Token bereit – dann holt und **aktualisiert** sich
# der Server selbst, wie bei jedem anderen Spiel aus Steam.
ACC_ANWENDUNG=1430110
BINAERDATEI="${SERVER}/accServer.exe"

if [ -n "${STEAM_LOGIN:-}" ]; then
  if steam_konto_uebernehmen; then
    # Windows-Fassung: `proton_app_holen` setzt die Plattform vor der Anmeldung.
    proton_app_holen "$ACC_ANWENDUNG" "$SERVER" || true
  else
    log "Für das Konto ${STEAM_LOGIN} liegt auf dieser Node keine Anmeldung."
    log ''
    log 'Einmalig auf der Gamenode anmelden – Passwort und Steam-Guard-Code'
    log 'werden dort abgefragt, nicht im Panel:'
    log ''
    log '  mkdir -p /srv/palantir/steam-konto'
    log '  chown 1000:1000 /srv/palantir/steam-konto'
    log '  docker run -it --rm -v /srv/palantir/steam-konto:/heim -e HOME=/heim \'
    log '    ghcr.io/nightriderp/palantir-base-steam:3 \'
    log "    /opt/steamcmd/steamcmd.sh +login ${STEAM_LOGIN} +quit"
  fi
fi

# -----------------------------------------------------------------------------
# 2. Sind die Serverdateien da?
if [ ! -f "$BINAERDATEI" ]; then
  log 'Die Serverdateien fehlen.'
  log ''
  log 'Kunos gibt den dedizierten Server nur an ein Steam-Konto heraus, das ACC'
  log 'besitzt – anonym geht er nicht. Es gibt zwei Wege:'
  log ''
  log '1. Steam-Konto: In den Einstellungen des Servers den Steam-Benutzernamen'
  log '   eintragen und auf der Node einmal anmelden (siehe oben). Danach holt'
  log '   und aktualisiert sich der Server selbst.'
  log ''
  log '2. Von Hand: Den Ordner aus deiner eigenen ACC-Installation'
  log ''
  log '     steamapps/common/Assetto Corsa Competizione Dedicated Server'
  log ''
  log '   (accServer.exe und cfg/) über den Datei-Manager nach "server" im'
  log '   Datenordner hochladen. Als ZIP hochladen und entpacken geht auch.'
  exit 78
fi

mkdir -p "$CFG"

# -----------------------------------------------------------------------------
# 3. UTF-16 LE
#
# **Die eine Stolperstelle dieses Spiels.** ACC liest seine Konfiguration als
# UTF-16 LE mit Marke. Eine Datei in UTF-8 wird nicht etwa abgelehnt – sie wird
# still falsch gelesen: Der Server startet mit Vorgaben, ohne Passwort und auf
# anderen Ports, und im Log steht nichts davon.
utf16_schreiben() {
  utf16_ziel="$1"

  # `\377\376` ist die Byte-Reihenfolge-Marke FF FE.
  { printf '\377\376'; iconv -f UTF-8 -t UTF-16LE; } > "$utf16_ziel"
}

# Maskiert, was ein JSON-Text nicht verträgt.
json_text() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\r//g' | tr -d '\n'
}

json_schalter() {
  case "$1" in
    true | TRUE | True | 1 | ja | yes | on) printf 'true' ;;
    *) printf 'false' ;;
  esac
}

# -----------------------------------------------------------------------------
# 4. configuration.json
#
# Die beiden Portnummern kommen vom Panel und sind **dieselben wie draußen**
# (`usesPublicPortNumber` in der Spieltyp-Definition). Das ist bei diesem Spiel
# Bedingung: Der Server meldet dem Lobby-Dienst die Nummern aus dieser Datei,
# und wer den Eintrag dort abholt, verbindet sich dorthin. Eine Übersetzung
# davor zeigte auf einen Port, den es nicht gibt.
TCP_PORT="${ACC_TCP_PORT:-9232}"
UDP_PORT="${ACC_UDP_PORT:-9231}"
PLAETZE="${ACC_MAX_CAR_SLOTS:-30}"

{
  printf '{\n'
  printf '  "udpPort": %s,\n' "$UDP_PORT"
  printf '  "tcpPort": %s,\n' "$TCP_PORT"
  # Fahrer, Zuschauer und die Verbindungen, die eine Startaufstellung braucht.
  printf '  "maxConnections": %s,\n' "$((PLAETZE + 10))"
  printf '  "lanDiscovery": %s,\n' "${ACC_LAN_DISCOVERY:-1}"
  printf '  "registerToLobby": %s,\n' "${ACC_REGISTER_TO_LOBBY:-1}"
  printf '  "configVersion": 1\n'
  printf '}\n'
} | utf16_schreiben "${CFG}/configuration.json"

# -----------------------------------------------------------------------------
# 5. settings.json
{
  printf '{\n'
  printf '  "serverName": "%s",\n' "$(json_text "${ACC_NAME:-Ein Palantir-Server}")"
  printf '  "adminPassword": "%s",\n' "$(json_text "${ACC_ADMIN_PASSWORD:-}")"
  printf '  "password": "%s",\n' "$(json_text "${ACC_PASSWORD:-}")"
  printf '  "spectatorPassword": "%s",\n' "$(json_text "${ACC_SPECTATOR_PASSWORD:-}")"
  printf '  "carGroup": "%s",\n' "$(json_text "${ACC_CAR_GROUP:-FreeForAll}")"
  printf '  "trackMedalsRequirement": %s,\n' "${ACC_TRACK_MEDALS:-0}"
  printf '  "safetyRatingRequirement": %s,\n' "${ACC_SAFETY_RATING:--1}"
  printf '  "racecraftRatingRequirement": %s,\n' "${ACC_RACECRAFT_RATING:--1}"
  printf '  "maxCarSlots": %s,\n' "$PLAETZE"
  printf '  "isRaceLocked": %s,\n' "${ACC_RACE_LOCKED:-1}"
  printf '  "shortFormationLap": %s,\n' "${ACC_SHORT_FORMATION_LAP:-1}"
  printf '  "formationLapType": 3,\n'
  printf '  "allowAutoDQ": 1,\n'
  printf '  "dumpLeaderboards": 1,\n'
  printf '  "randomizeTrackWhenEmpty": 0,\n'
  printf '  "centralEntryListPath": "",\n'
  printf '  "configVersion": 1\n'
  printf '}\n'
} | utf16_schreiben "${CFG}/settings.json"

# -----------------------------------------------------------------------------
# 6. event.json
#
# Drei Sitzungen, wie sie ein Rennwochenende hat: freies Training, Qualifikation,
# Rennen. Wer mehr will (mehrere Trainings, Sprint), legt sich seine eigene
# `event.json` an – siehe unten.
{
  printf '{\n'
  printf '  "track": "%s",\n' "$(json_text "${ACC_TRACK:-monza}")"
  printf '  "preRaceWaitingTimeSeconds": 80,\n'
  printf '  "sessionOverTimeSeconds": 120,\n'
  printf '  "ambientTemp": %s,\n' "${ACC_AMBIENT_TEMP:-22}"
  printf '  "cloudLevel": %s,\n' "${ACC_CLOUD_LEVEL:-0.3}"
  printf '  "rain": %s,\n' "${ACC_RAIN:-0.0}"
  printf '  "weatherRandomness": %s,\n' "${ACC_WEATHER_RANDOMNESS:-1}"
  printf '  "postQualySeconds": 10,\n'
  printf '  "postRaceSeconds": 15,\n'
  printf '  "sessions": [\n'
  printf '    { "hourOfDay": 10, "dayOfWeekend": 1, "timeMultiplier": 1, "sessionType": "P", "sessionDurationMinutes": %s },\n' \
    "${ACC_PRACTICE_MINUTES:-20}"
  printf '    { "hourOfDay": 14, "dayOfWeekend": 2, "timeMultiplier": 1, "sessionType": "Q", "sessionDurationMinutes": %s },\n' \
    "${ACC_QUALIFYING_MINUTES:-15}"
  printf '    { "hourOfDay": 16, "dayOfWeekend": 3, "timeMultiplier": 2, "sessionType": "R", "sessionDurationMinutes": %s }\n' \
    "${ACC_RACE_MINUTES:-30}"
  printf '  ],\n'
  printf '  "configVersion": 1\n'
  printf '}\n'
} | utf16_schreiben "${CFG}/event.json"

# `entrylist.json`, `eventRules.json` und `assistRules.json` werden **nicht**
# angefasst. Sie gehören dem Betreiber: Darin stehen die Fahrer einer Liga, die
# Regeln eines Rennens, die erlaubten Hilfen. Wer sie braucht, legt sie über den
# Datei-Manager daneben – dieses Skript schreibt nur, was das Panel kennt.

# -----------------------------------------------------------------------------
# 7. Proton und Start
proton_vorbereiten

# ACC nimmt keine Befehle entgegen. Das Rohr entsteht trotzdem, damit sich das
# Image verhält wie jedes andere; die Definition sagt mit
# `console: { kind: 'none' }`, dass das Panel nur die Ausgabe zeigt.
palantir_konsole_oeffnen

log "Startet Assetto Corsa Competizione auf ${ACC_TRACK:-monza} (TCP ${TCP_PORT}, UDP ${UDP_PORT})"

cd "$SERVER"

# Ohne `exec`: Zwischen Signal und Spielserver stehen ohnehin Proton und Wine.
# ACC schreibt seine Ergebnisse nach jeder Sitzung weg; beim Stoppen ist kein
# Konsolenbefehl nötig – und wäre auch nicht möglich.
proton_lauf "$BINAERDATEI" 0<&3 3>&-
