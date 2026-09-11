#!/bin/sh
#
# Startskript des 7-Days-to-Die-Images.
#
# Die Eigenheit dieses Servers ist seine Konfiguration: Sie ist **XML**, nicht
# `schluessel=wert`. Verschmelzen wie bei Minecraft oder Project Zomboid geht
# damit nicht – das Skript schreibt die Datei bei jedem Start vollständig neu.
# Wer eigene Eigenschaften setzen will, hängt eine eigene Datei über
# `PALANTIR_STARTUP_PARAMETERS` an (`-configfile=...`).
#
# Vier Dinge:
#
#   1. Serverdateien über SteamCMD in den Datenordner.
#   2. `steamclient.so` dorthin, wo der Server sie sucht.
#   3. `serverconfig.xml` aus den Feldern des Panels, mit maskierten Werten.
#   4. Start mit `-configfile=`, `-dedicated` und den übrigen Pflichtschaltern.

set -eu

. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/steam.sh"

# Anwendungsnummer des dedizierten Servers bei Valve.
SDTD_ANWENDUNG=294420

SERVER="${PALANTIR_DATENORDNER}/server"
# Alles, was dem Betreiber gehört – Welt, Spielerdaten, Logs – liegt neben den
# Serverdateien: SteamCMD räumt in seinem Ordner auf.
DATEN="${PALANTIR_DATENORDNER}/welt"

log() {
  palantir_log "$@"
}

palantir_intern_anlegen
mkdir -p "$DATEN"

# -----------------------------------------------------------------------------
# 1. Serverdateien
steam_app_holen "$SDTD_ANWENDUNG" "$SERVER"

BINAERDATEI="${SERVER}/7DaysToDieServer.x86_64"

if [ ! -f "$BINAERDATEI" ]; then
  log "Der Server fehlt: ${BINAERDATEI}"
  log 'Den Ordner "server" im Datenordner löschen und neu starten holt ihn erneut.'
  exit 78
fi

chmod 0755 "$BINAERDATEI" 2> /dev/null || true

# -----------------------------------------------------------------------------
# 2. steamclient.so
STEAMCLIENT="${PALANTIR_INTERN}/steam/linux64/steamclient.so"

if [ -f "$STEAMCLIENT" ]; then
  mkdir -p "${SERVER}/7DaysToDieServer_Data/Plugins/x86_64"
  cp -f "$STEAMCLIENT" "${SERVER}/7DaysToDieServer_Data/Plugins/x86_64/steamclient.so"
else
  log "Hinweis: ${STEAMCLIENT} fehlt – wenn der Server gleich mit einem Ladefehler abbricht, liegt es daran."
fi

LD_LIBRARY_PATH="${SERVER}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
export LD_LIBRARY_PATH

# -----------------------------------------------------------------------------
# 3. serverconfig.xml
#
# `xml_text` maskiert, was ein XML-Attribut nicht verträgt. Ohne das zerrisse
# ein Anführungszeichen im Servernamen die Datei, und der Server startete mit
# einer Meldung über Zeile und Spalte, mit der niemand etwas anfangen kann.
xml_text() {
  printf '%s' "$1" \
    | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' \
    | tr -d '\r\n'
}

KONFIG="${PALANTIR_INTERN}/serverconfig.xml"

eigenschaft() {
  printf '  <property name="%s" value="%s"/>\n' "$1" "$(xml_text "$2")" >> "$KONFIG"
}

printf '<?xml version="1.0"?>\n<ServerSettings>\n' > "$KONFIG"

eigenschaft 'ServerName' "${SDTD_NAME:-Ein Palantir-Server}"
eigenschaft 'ServerDescription' "${MOTD:-}"
eigenschaft 'ServerPassword' "${SDTD_PASSWORD:-}"
eigenschaft 'ServerPort' "${SERVER_PORT:-26900}"
eigenschaft 'ServerMaxPlayerCount' "${MAX_PLAYERS:-8}"
eigenschaft 'ServerVisibility' "$([ "${SDTD_PUBLIC:-true}" = 'true' ] && printf '2' || printf '0')"
eigenschaft 'GameWorld' "${SDTD_WORLD:-Navezgane}"
eigenschaft 'WorldGenSeed' "${SDTD_SEED:-palantir}"
eigenschaft 'WorldGenSize' "${SDTD_WORLD_SIZE:-6144}"
eigenschaft 'GameName' "${SDTD_GAME_NAME:-Palantir}"
eigenschaft 'GameDifficulty' "${SDTD_DIFFICULTY:-2}"
eigenschaft 'DayNightLength' "${SDTD_DAY_LENGTH:-60}"
# Alles, was dem Betreiber gehört, liegt neben den Serverdateien.
eigenschaft 'UserDataFolder' "$DATEN"
eigenschaft 'SaveGameFolder' "${DATEN}/Saves"
# Die Verwaltung läuft im Spiel; ein Telnet-Zugang wäre ein zweiter Weg hinein,
# den niemand abgesichert hat. Das Panel spricht ihn ohnehin nicht.
eigenschaft 'TelnetEnabled' 'false'
eigenschaft 'WebDashboardEnabled' 'false'

printf '</ServerSettings>\n' >> "$KONFIG"

# -----------------------------------------------------------------------------
# 4. Konsole und Start
#
# 7 Days to Die nimmt keine Befehle von der Standardeingabe entgegen – die
# Konsole läuft über Telnet, und das spricht der Agent nicht. Das Rohr entsteht
# trotzdem, damit sich das Image verhält wie jedes andere; die
# Spieltyp-Definition sagt mit `console: { kind: 'none' }`, dass das Panel nur
# die Ausgabe zeigt.
palantir_konsole_oeffnen

set -- -logfile /dev/stdout "-configfile=${KONFIG}" -quit -batchmode -nographics -dedicated

if [ -n "${PALANTIR_STARTUP_PARAMETERS:-}" ]; then
  # Absichtlich ohne Anführungszeichen: die Wortzerlegung ist der Zweck.
  # shellcheck disable=SC2086
  set -- "$@" ${PALANTIR_STARTUP_PARAMETERS}
fi

log "Startet 7 Days to Die: Welt ${SDTD_WORLD:-Navezgane} auf Port ${SERVER_PORT:-26900}"

cd "$SERVER"

exec "$BINAERDATEI" "$@" 0<&3 3>&-
