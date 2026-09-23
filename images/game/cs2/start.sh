#!/bin/sh
#
# Startskript des CS2-Images (`palantir-game-cs2`) – Schritt 1: nur Basic.
#
# Drei Dinge, sonst nichts:
#
#   1. Serverdateien über SteamCMD holen (Anwendung 730, anonym).
#   2. `steamclient.so` dorthin legen, wo CS2 sie sucht.
#   3. CS2 über Valves eigenen Starter `game/cs2.sh` starten.
#
# Keine Einstellungen aus dem Panel, keine Plugins: feste Karte `de_dust2`.
#
# **Der Port kommt vom Panel** (`CS2_PORT`, Schritt 1.1): dieselbe Nummer, unter
# der der Server draußen erreichbar ist. CS2 nennt Clients seinen eigenen Port;
# weicht er vom öffentlichen ab, scheitert der Verbindungsaufbau still.
set -eu

. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/steam.sh"

SERVER="${PALANTIR_DATENORDNER}/server"
STARTER="${SERVER}/game/cs2.sh"
PORT="${CS2_PORT:-27015}"

palantir_intern_anlegen

# -----------------------------------------------------------------------------
# 1. Serverdateien – bei jedem Start abgeglichen, wie bei allen SteamCMD-Spielen.
steam_app_holen 730 "$SERVER"

if [ ! -f "$STARTER" ]; then
  palantir_log "Nach dem Holen fehlt ${STARTER}."
  palantir_log 'Den Ordner "server" im Datenordner loeschen und neu starten holt alles erneut.'
  exit 69
fi

# -----------------------------------------------------------------------------
# 2. steamclient.so
#
# Ohne sie bricht CS2 beim Anmelden an Steam ab. Gesucht wird sie unter
# `~/.steam/sdk64`. `steam_vorbereiten` hat `HOME` in den SteamCMD-Ordner
# gelegt; für den Server ist es der interne Ordner.
HOME="$PALANTIR_INTERN"
export HOME

STEAMCLIENT="${PALANTIR_INTERN}/steam/linux64/steamclient.so"

if [ -f "$STEAMCLIENT" ]; then
  mkdir -p "${HOME}/.steam/sdk64"
  cp -f "$STEAMCLIENT" "${HOME}/.steam/sdk64/steamclient.so"
else
  palantir_log "Hinweis: ${STEAMCLIENT} fehlt - scheitert die Anmeldung an Steam, liegt es daran."
fi

# -----------------------------------------------------------------------------
# 3. Start
#
# **Über `game/cs2.sh`, nicht über die Binärdatei.** Seit dem Update vom
# 17.09.2025 braucht CS2 Bibliotheken aus seinen eigenen Ordnern (`libv8.so`);
# den Suchpfad setzt der Starter. Direkt gestartet bricht der Server mit
# „Unable to load module server" ab – so geschehen im ersten Anlauf.
#
# CS2 liest Befehle von der Standardeingabe; das Rohr legt die Wurzel an.
palantir_konsole_oeffnen

palantir_log "Startet CS2 auf de_dust2, Port ${PORT}"

cd "${SERVER}/game"

exec bash "$STARTER" -dedicated -port "$PORT" +map de_dust2 0<&3 3>&-
