#!/bin/sh
#
# Startskript des Abiotic-Factor-Images – ein Windows-Server unter Proton.
#
# Der Ablauf ist der der anderen Proton-Spiele:
#
#   1. SteamCMD holt die **Windows-Dateien** (Anwendung 2857200, anonym).
#   2. Ein Bildschirm entsteht, den es nicht gibt – die Unreal Engine verlangt
#      unter Wine eine X11-Verbindung, obwohl niemand zusieht.
#   3. Gestartet wird über `proton run`.
#
# **Ohne Konfigurationsdatei.** Abiotic Factor nimmt alles auf der
# Befehlszeile entgegen; die `Game.ini` im Serverordner ist für Feineinstellung
# da, die der Betreiber im Spiel macht. Ein Startskript, das sie schriebe,
# räumte nur weg, was er dort gesetzt hat.

set -eu

. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/steam.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/proton.sh"

# Anwendungsnummer des dedizierten Servers bei Valve.
ABIOTIC_ANWENDUNG=2857200

SERVER="${PALANTIR_DATENORDNER}/server"
# Die Spielstände gehören dem Betreiber und liegen deshalb neben den
# Serverdateien, nicht darin – siehe unten.
WELTEN="${PALANTIR_DATENORDNER}/welten"

log() {
  palantir_log "$@"
}

palantir_intern_anlegen
mkdir -p "$WELTEN"

# -----------------------------------------------------------------------------
# 1. Serverdateien (Windows)
proton_app_holen "$ABIOTIC_ANWENDUNG" "$SERVER"

BINAERDATEI="${SERVER}/AbioticFactor/Binaries/Win64/AbioticFactorServer-Win64-Shipping.exe"

if [ ! -f "$BINAERDATEI" ]; then
  log "Der Server fehlt: ${BINAERDATEI}"
  log 'Kam SteamCMD an die Windows-Dateien? Den Ordner "server" im Datenordner'
  log 'löschen und neu starten holt sie erneut.'
  exit 78
fi

# -----------------------------------------------------------------------------
# 2. Die Spielstände aus dem Serverordner herausholen
#
# Die Unreal Engine legt sie unter `AbioticFactor/Saved` ab – mitten in dem, was
# SteamCMD verwaltet. Wer den Serverordner löscht, um die Dateien neu zu holen,
# löschte damit die Welt. Ein Verweis führt sie nach `/data/welten`, wo sie zum
# Betreiber gehören; SteamCMD rührt ihn bei einer Aktualisierung nicht an.
GESPEICHERT="${SERVER}/AbioticFactor/Saved"

if [ -d "$GESPEICHERT" ] && [ ! -L "$GESPEICHERT" ]; then
  # Beim ersten Mal steht dort ein echter Ordner: Inhalt hinüberholen, dann
  # ersetzen. `cp -a` statt `mv`, damit ein halb geglückter Umzug nichts
  # verliert.
  log 'Hole die Spielstände aus dem Serverordner nach /data/welten.'
  cp -a "${GESPEICHERT}/." "$WELTEN/" 2> /dev/null || true
  rm -rf "$GESPEICHERT"
fi

if [ ! -L "$GESPEICHERT" ]; then
  mkdir -p "$(dirname "$GESPEICHERT")"
  ln -s "$WELTEN" "$GESPEICHERT"
fi

# -----------------------------------------------------------------------------
# 3. Proton und Bildschirm
proton_vorbereiten
proton_bildschirm_starten

# -----------------------------------------------------------------------------
# 4. Konsole und Start
#
# Abiotic Factor nimmt keine Befehle entgegen – weder über die Standardeingabe
# noch über RCON. Das Rohr entsteht trotzdem, damit sich das Image verhält wie
# jedes andere; die Spieltyp-Definition sagt mit `console: { kind: 'none' }`,
# dass das Panel nur die Ausgabe zeigt.
palantir_konsole_oeffnen

PORT="${SERVER_PORT:-7777}"
ABFRAGE_PORT="${ABIOTIC_QUERY_PORT:-27015}"

# `-useperfthreads -NoAsyncLoadingThread` sind die Schalter, die der Hersteller
# selbst für dedizierte Server nennt; `-nosound` spart einer Maschine ohne
# Tonausgabe den Versuch.
set -- -log -useperfthreads -NoAsyncLoadingThread -nosound \
  "-PORT=${PORT}" "-QueryPort=${ABFRAGE_PORT}" \
  "-MaxServerPlayers=${MAX_PLAYERS:-6}" \
  "-SteamServerName=${ABIOTIC_NAME:-Ein Palantir-Server}" \
  "-WorldSaveName=${ABIOTIC_WORLD:-Cascade}"

# Ein leeres Passwort als `-ServerPassword=` mitzugeben, hieße bei manchen
# Fassungen: Passwort ist der leere Text. Weglassen heißt: keins.
if [ -n "${ABIOTIC_PASSWORD:-}" ]; then
  set -- "$@" "-ServerPassword=${ABIOTIC_PASSWORD}"
fi

if [ -n "${PALANTIR_STARTUP_PARAMETERS:-}" ]; then
  # Absichtlich ohne Anführungszeichen: die Wortzerlegung ist der Zweck.
  # shellcheck disable=SC2086
  set -- "$@" ${PALANTIR_STARTUP_PARAMETERS}
fi

log "Startet Abiotic Factor auf Port ${PORT} (Abfrage ${ABFRAGE_PORT}) unter Proton"

cd "$SERVER"

# Ohne `exec`: Zwischen Signal und Spielserver stehen ohnehin Proton und Wine.
# Der Server speichert in Abständen von selbst; ein Konsolenbefehl wie bei
# Terraria ist nicht nötig – und wäre auch nicht möglich.
proton_lauf "$BINAERDATEI" "$@" 0<&3 3>&-
