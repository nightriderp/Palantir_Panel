#!/bin/sh
#
# Startskript des Satisfactory-Images.
#
# Kurz, weil es wenig zu entscheiden gibt: Satisfactory kennt keine
# Konfigurationsdatei, die von außen gesetzt würde. Servername, Passwörter und
# Spielstand vergibt der erste Spieler **im Spiel**, wenn er den Server
# übernimmt („claimt"). Das Panel liefert deshalb nur Port und Ressourcen.
#
# Drei Dinge tut es trotzdem:
#
#   1. Es holt die Serverdateien über SteamCMD in den Datenordner.
#   2. Es legt `steamclient.so` nach `~/.steam/sdk64` – ohne sie scheitert die
#      Anmeldung an Steam und niemand kommt herein.
#   3. Es zeigt `HOME` in den Datenordner, damit die Spielstände dort landen und
#      nicht in einem Zuhause, das es im Container nicht gibt.

set -eu

. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/steam.sh"

# Anwendungsnummer des dedizierten Servers bei Valve.
SATISFACTORY_ANWENDUNG=1690800

SERVER="${PALANTIR_DATENORDNER}/server"

log() {
  palantir_log "$@"
}

palantir_intern_anlegen

# -----------------------------------------------------------------------------
# 1. Serverdateien
steam_app_holen "$SATISFACTORY_ANWENDUNG" "$SERVER"

BINAERDATEI="${SERVER}/FactoryServer.sh"

if [ ! -f "$BINAERDATEI" ]; then
  log "Der Server fehlt: ${BINAERDATEI}"
  log 'Den Ordner "server" im Datenordner löschen und neu starten holt ihn erneut.'
  exit 78
fi

chmod 0755 "$BINAERDATEI" 2> /dev/null || true

# -----------------------------------------------------------------------------
# 2. Zuhause und steamclient.so
#
# Satisfactory legt seine Spielstände unter `$HOME/.config/Epic/FactoryGame` ab.
# Zeigte `HOME` ins schreibgeschützte Wurzeldateisystem, verlöre der Server
# jeden Spielstand beim Neuaufbau des Containers – und das fiele erst auf, wenn
# es zu spät ist.
HOME="${PALANTIR_DATENORDNER}/spielstaende"
export HOME
mkdir -p "$HOME"

STEAMCLIENT="${PALANTIR_INTERN}/steam/linux64/steamclient.so"

if [ -f "$STEAMCLIENT" ]; then
  mkdir -p "${HOME}/.steam/sdk64"
  cp -f "$STEAMCLIENT" "${HOME}/.steam/sdk64/steamclient.so"
else
  log "Hinweis: ${STEAMCLIENT} fehlt – wenn die Anmeldung an Steam scheitert, liegt es daran."
fi

# -----------------------------------------------------------------------------
# 3. Konsole und Start
#
# Das Rohr entsteht wie bei jedem Image; Satisfactory liest allerdings nichts
# davon – die Verwaltung läuft über den Server-Manager im Spiel. Die
# Spieltyp-Definition sagt das mit `console: { kind: 'none' }`, das Panel zeigt
# deshalb nur die Ausgabe.
palantir_konsole_oeffnen

PORT="${SERVER_PORT:-7777}"

# `-multihome=0.0.0.0`: Ohne das lauscht der Server nur auf einer Adresse, die
# im Container niemandem gehört. `-Port` ist seit Update 1.0 der einzige Port –
# Spiel und Abfrage teilen ihn sich, TCP und UDP.
set -- "-multihome=0.0.0.0" "-Port=${PORT}" -unattended

if [ -n "${PALANTIR_STARTUP_PARAMETERS:-}" ]; then
  # Absichtlich ohne Anführungszeichen: die Wortzerlegung ist der Zweck.
  # shellcheck disable=SC2086
  set -- "$@" ${PALANTIR_STARTUP_PARAMETERS}
fi

log "Startet Satisfactory auf Port ${PORT} (TCP und UDP)"

cd "$SERVER"

exec sh "$BINAERDATEI" "$@" 0<&3 3>&-
