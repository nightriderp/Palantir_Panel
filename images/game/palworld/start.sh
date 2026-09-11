#!/bin/sh
#
# Startskript des Palworld-Images.
#
# Vier Dinge:
#
#   1. Es holt die Serverdateien über SteamCMD in den Datenordner.
#   2. Es legt `steamclient.so` dorthin, wo der Server sie sucht.
#   3. Es schreibt `PalWorldSettings.ini` – und zwar nur die Schlüssel, für die
#      es im Panel ein Feld gibt. Palworld füllt den Rest mit seinen Vorgaben.
#   4. Es schaltet RCON ein (Source-Protokoll) und ersetzt sich per `exec` durch
#      den Server.
#
# **Die INI ist eine einzige Zeile.** Palworld liest seine Einstellungen als
# `OptionSettings=(Schluessel=Wert,...)` – kein `schluessel=wert` je Zeile, also
# auch nichts zum Verschmelzen. Werte werden deshalb von Zeichen befreit, die
# diese Zeile zerrissen: Anführungszeichen, Kommas und Klammern.

set -eu

. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/steam.sh"

# Anwendungsnummer des dedizierten Servers bei Valve.
PALWORLD_ANWENDUNG=2394010

SERVER="${PALANTIR_DATENORDNER}/server"

log() {
  palantir_log "$@"
}

palantir_intern_anlegen

# -----------------------------------------------------------------------------
# 1. Serverdateien
steam_app_holen "$PALWORLD_ANWENDUNG" "$SERVER"

BINAERDATEI="${SERVER}/PalServer.sh"

if [ ! -f "$BINAERDATEI" ]; then
  log "Der Server fehlt: ${BINAERDATEI}"
  log 'Den Ordner "server" im Datenordner löschen und neu starten holt ihn erneut.'
  exit 78
fi

chmod 0755 "$BINAERDATEI" 2> /dev/null || true
chmod 0755 "${SERVER}/Pal/Binaries/Linux/PalServer-Linux-Shipping" 2> /dev/null || true

# -----------------------------------------------------------------------------
# 2. steamclient.so
#
# Palworld sucht sie unter `~/.steam/sdk64`. Fehlt sie, meldet der Server beim
# Start einen Fehler beim Anmelden an Steam – und niemand kommt herein.
HOME="$PALANTIR_INTERN"
export HOME

STEAMCLIENT="${PALANTIR_INTERN}/steam/linux64/steamclient.so"

if [ -f "$STEAMCLIENT" ]; then
  mkdir -p "${HOME}/.steam/sdk64"
  cp -f "$STEAMCLIENT" "${HOME}/.steam/sdk64/steamclient.so"
else
  log "Hinweis: ${STEAMCLIENT} fehlt – wenn die Anmeldung an Steam scheitert, liegt es daran."
fi

# -----------------------------------------------------------------------------
# 3. PalWorldSettings.ini
#
# `ini_text` nimmt heraus, was die eine lange Zeile zerrisse. Lieber ein
# Servername ohne Anführungszeichen als ein Server, der wortlos mit Vorgaben
# startet, weil er seine Einstellungen nicht lesen konnte.
ini_text() {
  printf '%s' "$1" | tr -d '",()\r\n'
}

RCON_PASSWORT_DATEI="${PALANTIR_INTERN}/rcon.password"
RCON_PASSWORT="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
ALTE_UMASK="$(umask)"
umask 077
printf '%s\n' "$RCON_PASSWORT" > "$RCON_PASSWORT_DATEI"
umask "$ALTE_UMASK"

PORT="${SERVER_PORT:-8211}"
EINSTELLUNGEN="${SERVER}/Pal/Saved/Config/LinuxServer"
mkdir -p "$EINSTELLUNGEN"

{
  printf '[/Script/Pal.PalGameWorldSettings]\n'
  printf 'OptionSettings=('
  printf 'ServerName="%s",' "$(ini_text "${PALWORLD_NAME:-Ein Palantir-Server}")"
  printf 'ServerDescription="%s",' "$(ini_text "${MOTD:-}")"
  printf 'ServerPassword="%s",' "$(ini_text "${PALWORLD_PASSWORD:-}")"
  printf 'ServerPlayerMaxNum=%s,' "${MAX_PLAYERS:-32}"
  printf 'PublicPort=%s,' "$PORT"
  printf 'DeathPenalty="%s",' "$(ini_text "${PALWORLD_DEATH_PENALTY:-All}")"
  printf 'bIsPvP=%s,' "$([ "${PALWORLD_PVP:-false}" = 'true' ] && printf 'True' || printf 'False')"
  # **Das Administrator-Passwort ist zugleich das RCON-Passwort.** Palworld
  # kennt dafür kein eigenes Feld; wer RCON spricht, ist Administrator.
  printf 'AdminPassword="%s",' "$RCON_PASSWORT"
  printf 'RCONEnabled=True,'
  printf 'RCONPort=%s' "${RCON_PORT:-25575}"
  printf ')\n'
} > "${EINSTELLUNGEN}/PalWorldSettings.ini"

# -----------------------------------------------------------------------------
# 4. Konsole und Start
palantir_konsole_oeffnen

# `-useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS` sind die
# Schalter, die Pocketpair selbst für dedizierte Server nennt; ohne sie rechnet
# der Server auf einem Kern.
set -- "-port=${PORT}" "-players=${MAX_PLAYERS:-32}" \
  -useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS

if [ -n "${PALANTIR_STARTUP_PARAMETERS:-}" ]; then
  # Absichtlich ohne Anführungszeichen: die Wortzerlegung ist der Zweck.
  # shellcheck disable=SC2086
  set -- "$@" ${PALANTIR_STARTUP_PARAMETERS}
fi

log "Startet Palworld auf Port ${PORT} fuer bis zu ${MAX_PLAYERS:-32} Spieler"

cd "$SERVER"

exec sh "$BINAERDATEI" "$@" 0<&3 3>&-
