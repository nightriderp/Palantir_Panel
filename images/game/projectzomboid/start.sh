#!/bin/sh
#
# Startskript des Project-Zomboid-Images.
#
# Fünf Dinge, und drei davon sind Eigenheiten dieses Servers:
#
#   1. Es holt die Serverdateien über SteamCMD in den Datenordner.
#   2. Es besteht auf einem Administrator-Passwort. Ohne `-adminpassword` fragt
#      der Server beim ersten Start **interaktiv** danach und wartet ewig – im
#      Container sieht das aus wie ein Hänger ohne Grund.
#   3. Es schreibt die verwalteten Schlüssel in die `.ini` des Servers, ohne die
#      übrigen anzutasten.
#   4. Es legt Spielstände und Einstellungen neben die Serverdateien
#      (`-cachedir`), nicht hinein – SteamCMD räumt in seinem Ordner auf.
#   5. Es fängt das Stoppsignal ab und schickt `quit` in die Konsole, statt sich
#      beenden zu lassen: Project Zomboid speichert bei SIGTERM nicht
#      zuverlässig.

set -eu

. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/steam.sh"

# Anwendungsnummer des dedizierten Servers bei Valve.
ZOMBOID_ANWENDUNG=380870

SERVER="${PALANTIR_DATENORDNER}/server"
# `-cachedir` ist bei Project Zomboid der Ort für alles, was dem Betreiber
# gehört: Welt, Spielerdaten, Einstellungen, Logs.
DATEN="${PALANTIR_DATENORDNER}/welt"

log() {
  palantir_log "$@"
}

palantir_intern_anlegen
mkdir -p "$DATEN" "${DATEN}/Server"

# -----------------------------------------------------------------------------
# 1. Einstellungen prüfen, bevor irgendetwas geholt wird
NAME="${ZOMBOID_NAME:-palantir}"
ADMIN_PASSWORT="${ZOMBOID_ADMIN_PASSWORD:-}"

if [ -z "$ADMIN_PASSWORT" ]; then
  log 'Der Server startet nicht: Project Zomboid verlangt ein Administrator-Passwort.'
  log 'Ohne es fragt der Server beim ersten Start danach und wartet – im Container'
  log 'ohne Aussicht auf eine Antwort. Im Panel unter Einstellungen eines setzen.'
  exit 78
fi

# Der Name wird zum Dateinamen der `.ini` und der Weltordner heißt genauso.
# Ein Schrägstrich oder ein Leerzeichen darin führt zu Pfaden, die niemand mehr
# wiederfindet.
case "$NAME" in
*[!A-Za-z0-9_-]*)
  log "Der Servername darf nur Buchstaben, Ziffern, - und _ enthalten: ${NAME}"
  log 'Er wird zum Dateinamen der Einstellungen und zum Namen des Weltordners.'
  exit 78
  ;;
esac

# -----------------------------------------------------------------------------
# 2. Serverdateien
steam_app_holen "$ZOMBOID_ANWENDUNG" "$SERVER"

STARTSKRIPT="${SERVER}/start-server.sh"

if [ ! -f "$STARTSKRIPT" ]; then
  log "Der Server fehlt: ${STARTSKRIPT}"
  log 'Den Ordner "server" im Datenordner löschen und neu starten holt ihn erneut.'
  exit 78
fi

chmod 0755 "$STARTSKRIPT" 2> /dev/null || true

# -----------------------------------------------------------------------------
# 3. Die `.ini` des Servers
#
# Verwaltet werden genau die Schlüssel, für die es im Panel ein Feld gibt. Alles
# andere – Zombie-Einstellungen, Mods, Sandbox-Regeln – gehört dem Betreiber und
# bleibt stehen (`palantir_schluessel_verschmelzen` aus der Wurzel).
VERWALTET="${PALANTIR_INTERN}/verwaltete.ini"
: > "$VERWALTET"

setze() {
  palantir_eigenschaft "$VERWALTET" "$1" "$2"
}

OEFFENTLICH="${ZOMBOID_PUBLIC:-true}"
[ "$OEFFENTLICH" = 'true' ] || OEFFENTLICH='false'

setze 'DefaultPort' "${SERVER_PORT:-16261}"
setze 'UDPPort' "${ZOMBOID_UDP_PORT:-16262}"
setze 'PublicName' "${ZOMBOID_PUBLIC_NAME:-Ein Palantir-Server}"
setze 'PublicDescription' "${MOTD:-}"
setze 'Public' "$OEFFENTLICH"
setze 'Password' "${ZOMBOID_PASSWORD:-}"
setze 'MaxPlayers' "${MAX_PLAYERS:-16}"
setze 'PVP' "${ZOMBOID_PVP:-true}"
# Ein leerer Server soll die Uhr anhalten – sonst altert die Welt, während
# niemand spielt, und die Node rechnet für nichts.
setze 'PauseEmpty' 'true'

palantir_schluessel_verschmelzen "$VERWALTET" "${DATEN}/Server/${NAME}.ini"

# -----------------------------------------------------------------------------
# 4. Konsole
palantir_konsole_oeffnen

set -- -servername "$NAME" -adminpassword "$ADMIN_PASSWORT" "-cachedir=${DATEN}"

if [ -n "${PALANTIR_STARTUP_PARAMETERS:-}" ]; then
  # Absichtlich ohne Anführungszeichen: die Wortzerlegung ist der Zweck.
  # shellcheck disable=SC2086
  set -- "$@" ${PALANTIR_STARTUP_PARAMETERS}
fi

log "Startet Project Zomboid: ${NAME}, oeffentlich: ${OEFFENTLICH}"

# -----------------------------------------------------------------------------
# 5. Starten und auf das Ende warten
#
# Der Server läuft im Hintergrund, damit diese Shell das Signal bekommt. Der
# Fang steht **vor** dem Start: Ein Signal in der Lücke dazwischen beendete die
# Shell sonst kommentarlos.
beenden() {
  log 'Stoppsignal erhalten – schicke "quit" an die Konsole, damit die Welt gespeichert wird.'
  printf 'quit\n' >&3 || true
}

trap beenden TERM INT

# `cd` in den Serverordner: `start-server.sh` sucht seine Bibliotheken relativ
# zum Arbeitsverzeichnis.
cd "$SERVER"

sh "$STARTSKRIPT" "$@" 0<&3 3>&- &
SERVER_PID=$!

ERGEBNIS=0
while kill -0 "$SERVER_PID" 2> /dev/null; do
  if wait "$SERVER_PID"; then
    ERGEBNIS=0
  else
    ERGEBNIS=$?
  fi
done

exit "$ERGEBNIS"
