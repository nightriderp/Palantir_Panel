#!/bin/sh
#
# Startskript des Rust-Images.
#
# Vier Dinge:
#
#   1. Es holt die Serverdateien über SteamCMD in den Datenordner.
#   2. Es legt `steamclient.so` dorthin, wo RustDedicated sie sucht – ohne sie
#      bricht der Server beim Start mit einem Ladefehler ab, der nichts über
#      die Ursache sagt.
#   3. Es schaltet RCON auf das **Source-Protokoll** (`rcon.web 0`). Rust kann
#      beides; die Vorgabe ist WebSocket, und das spricht der Agent nicht.
#   4. Es ersetzt sich per `exec` durch den Server: Rust speichert beim
#      Stoppsignal selbst.
#
# **Alle Einstellungen stehen in der Argumentliste**, es gibt keine
# Konfigurationsdatei zu pflegen. Was der Betreiber darüber hinaus setzen will,
# hängt er über `PALANTIR_STARTUP_PARAMETERS` an – Rust nimmt jede weitere
# `+schluessel wert`-Angabe entgegen.

set -eu

. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/steam.sh"

# Anwendungsnummer des dedizierten Servers bei Valve.
RUST_ANWENDUNG=258550

SERVER="${PALANTIR_DATENORDNER}/server"

log() {
  palantir_log "$@"
}

palantir_intern_anlegen

# -----------------------------------------------------------------------------
# 1. Serverdateien
steam_app_holen "$RUST_ANWENDUNG" "$SERVER"

BINAERDATEI="${SERVER}/RustDedicated"

if [ ! -f "$BINAERDATEI" ]; then
  log "Der Server fehlt: ${BINAERDATEI}"
  log 'Den Ordner "server" im Datenordner löschen und neu starten holt ihn erneut.'
  exit 78
fi

chmod 0755 "$BINAERDATEI" 2> /dev/null || true

# -----------------------------------------------------------------------------
# 2. steamclient.so
#
# RustDedicated sucht sie neben seinen eigenen Bibliotheken; SteamCMD legt sie
# in seinen Ordner. Fehlt sie, bricht der Server mit einem Ladefehler ab, der
# nichts über die Ursache sagt – das ist die häufigste Stolperstelle bei
# Steam-Servern überhaupt.
PLUGINS="${SERVER}/RustDedicated_Data/Plugins/x86_64"
STEAMCLIENT="${PALANTIR_INTERN}/steam/linux64/steamclient.so"

if [ -f "$STEAMCLIENT" ]; then
  mkdir -p "$PLUGINS"
  cp -f "$STEAMCLIENT" "${PLUGINS}/steamclient.so"
else
  log "Hinweis: ${STEAMCLIENT} fehlt – wenn der Server gleich mit einem Ladefehler abbricht, liegt es daran."
fi

LD_LIBRARY_PATH="${SERVER}:${PLUGINS}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
export LD_LIBRARY_PATH

# -----------------------------------------------------------------------------
# 3. RCON
#
# Rust kann beides: WebSocket (Vorgabe) und das Source-Protokoll, das auch
# Minecraft spricht. Der Agent spricht nur das zweite, deshalb `rcon.web 0`.
# Das Passwort entsteht bei jedem Start neu und liegt nur im Datenordner (0600);
# der Port wird nie veröffentlicht.
RCON_PASSWORT_DATEI="${PALANTIR_INTERN}/rcon.password"
RCON_PASSWORT="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
ALTE_UMASK="$(umask)"
umask 077
printf '%s\n' "$RCON_PASSWORT" > "$RCON_PASSWORT_DATEI"
umask "$ALTE_UMASK"

# -----------------------------------------------------------------------------
# 4. Konsole und Start
palantir_konsole_oeffnen

PORT="${SERVER_PORT:-28015}"

set -- -batchmode -nographics \
  +server.port "$PORT" \
  +server.queryport "$PORT" \
  +server.identity 'palantir' \
  +server.hostname "${RUST_NAME:-Ein Palantir-Server}" \
  +server.description "${MOTD:-}" \
  +server.maxplayers "${MAX_PLAYERS:-50}" \
  +server.worldsize "${RUST_WORLD_SIZE:-3000}" \
  +server.level "${RUST_LEVEL:-Procedural Map}" \
  +server.saveinterval "${RUST_SAVE_INTERVAL:-300}" \
  +rcon.port "${RCON_PORT:-28016}" \
  +rcon.password "$RCON_PASSWORT" \
  +rcon.web 0

# Ein Startwert von 0 hieße „jedes Mal eine andere Welt" – die Karte entstünde
# bei jedem Neustart neu. Ohne Angabe bleibt es bei Rusts eigener Vorgabe.
if [ -n "${RUST_SEED:-}" ]; then
  set -- "$@" +server.seed "$RUST_SEED"
fi

if [ -n "${PALANTIR_STARTUP_PARAMETERS:-}" ]; then
  # Absichtlich ohne Anführungszeichen: die Wortzerlegung ist der Zweck.
  # shellcheck disable=SC2086
  set -- "$@" ${PALANTIR_STARTUP_PARAMETERS}
fi

log "Startet Rust auf Port ${PORT}, Weltgroesse ${RUST_WORLD_SIZE:-3000}"

# `cd` in den Serverordner: Rust legt `server/<identity>` relativ dazu an.
cd "$SERVER"

exec "$BINAERDATEI" "$@" 0<&3 3>&-
