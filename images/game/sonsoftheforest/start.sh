#!/bin/sh
#
# Startskript des Sons-of-the-Forest-Images – ein Windows-Server unter Proton.
#
# Endnight gibt den Server nur als Windows-Programm heraus. Der Ablauf:
#
#   1. SteamCMD holt die **Windows-Dateien** (Anwendung 2465200, anonym).
#   2. Ein Bildschirm entsteht, den es nicht gibt: Der Server läuft auf Unity
#      und verlangt unter Wine eine X11-Verbindung, obwohl niemand zusieht.
#   3. `dedicatedserver.cfg` – eine JSON-Datei trotz der Endung – wird bei jedem
#      Start neu geschrieben.
#   4. Gestartet wird über `proton run`.
#
# **Drei Ports, alle UDP**: Spiel (8766), Abfrage (27016) und ein dritter für
# den Abgleich der Weltdaten beim Beitreten (9700). Fehlt der dritte, verbindet
# sich der Spieler und bleibt im Ladebildschirm hängen – der Server sieht dabei
# nichts Auffälliges.

set -eu

. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/steam.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/proton.sh"

# Anwendungsnummer des dedizierten Servers bei Valve.
SOTF_ANWENDUNG=2465200

SERVER="${PALANTIR_DATENORDNER}/server"
# `-userdatapath`: Darunter liegen die Konfiguration und die Spielstände. Beides
# gehört dem Betreiber und überlebt eine Neuinstallation der Serverdateien.
WELTEN="${PALANTIR_DATENORDNER}/welten"

log() {
  palantir_log "$@"
}

palantir_intern_anlegen
mkdir -p "$WELTEN"

# -----------------------------------------------------------------------------
# 1. Serverdateien (Windows)
proton_app_holen "$SOTF_ANWENDUNG" "$SERVER"

BINAERDATEI="${SERVER}/SonsOfTheForestDS.exe"

if [ ! -f "$BINAERDATEI" ]; then
  log "Der Server fehlt: ${BINAERDATEI}"
  log 'Kam SteamCMD an die Windows-Dateien? Den Ordner "server" im Datenordner'
  log 'löschen und neu starten holt sie erneut.'
  exit 78
fi

# -----------------------------------------------------------------------------
# 2. dedicatedserver.cfg
#
# `json_text` maskiert, was ein JSON-Text nicht verträgt. Ohne das zerbräche ein
# Anführungszeichen im Servernamen die Datei – und der Server startete mit den
# Vorgaben, also ohne Passwort und auf fremden Ports.
json_text() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\r//g' | tr -d '\n'
}

PORT="${SERVER_PORT:-8766}"
ABFRAGE_PORT="${SOTF_QUERY_PORT:-27016}"
ABGLEICH_PORT="${SOTF_BLOB_PORT:-9700}"

# „Continue" setzt fort, was liegt, und legt beim ersten Start an; „New"
# begänne bei jedem Start von vorn – das wäre in einem Panel, das den Container
# neu aufbauen darf, ein Weltenfresser.
{
  printf '{\n'
  printf '  "IpAddress": "0.0.0.0",\n'
  printf '  "GamePort": %s,\n' "$PORT"
  printf '  "QueryPort": %s,\n' "$ABFRAGE_PORT"
  printf '  "BlobSyncPort": %s,\n' "$ABGLEICH_PORT"
  printf '  "ServerName": "%s",\n' "$(json_text "${SOTF_NAME:-Ein Palantir-Server}")"
  printf '  "MaxPlayers": %s,\n' "${MAX_PLAYERS:-8}"
  printf '  "Password": "%s",\n' "$(json_text "${SOTF_PASSWORD:-}")"
  printf '  "LanOnly": false,\n'
  printf '  "SaveSlot": %s,\n' "${SOTF_SAVE_SLOT:-1}"
  printf '  "SaveMode": "Continue",\n'
  printf '  "GameMode": "%s",\n' "$(json_text "${SOTF_GAME_MODE:-Normal}")"
  printf '  "SaveInterval": %s,\n' "${SOTF_SAVE_INTERVAL:-600}"
  # Wenn niemand spielt, darf der Server langsamer rechnen: Das spart der Node
  # spürbar Rechenzeit, und die Tage im Spiel vergehen trotzdem.
  printf '  "IdleDayCycleSpeed": 0.0,\n'
  printf '  "IdleTargetFramerate": 5,\n'
  printf '  "ActiveTargetFramerate": 60,\n'
  # Die Ausgabe läuft ohnehin durch das Panel; eigene Dateien im Datenordner
  # wüchsen nur unbemerkt mit.
  printf '  "LogFilesEnabled": false,\n'
  printf '  "TimestampLogEntries": true,\n'
  # Der Server prüft beim Start, ob er von außen erreichbar ist – und beendet
  # sich, wenn die Prüfung fehlschlägt. Hinter dem Rückwärtstunnel schlägt sie
  # immer fehl: Die öffentliche Adresse ist die der VPS, nicht die der Node.
  printf '  "SkipNetworkAccessibilityTest": true,\n'
  printf '  "GameSettings": {},\n'
  printf '  "CustomGameModeSettings": {}\n'
  printf '}\n'
} > "${WELTEN}/dedicatedserver.cfg"

# -----------------------------------------------------------------------------
# 3. Proton und Bildschirm
proton_vorbereiten
proton_bildschirm_starten

# -----------------------------------------------------------------------------
# 4. Konsole und Start
#
# Sons of the Forest nimmt keine Befehle entgegen – weder über die
# Standardeingabe noch über RCON. Das Rohr entsteht trotzdem, damit sich das
# Image verhält wie jedes andere; die Spieltyp-Definition sagt mit
# `console: { kind: 'none' }`, dass das Panel nur die Ausgabe zeigt.
palantir_konsole_oeffnen

# Proton sieht den Datenordner als Windows-Laufwerk `Z:`. Ein Linux-Pfad als
# `-userdatapath` liefe ins Leere, und der Server legte Konfiguration und
# Spielstände irgendwohin – sichtbar erst, wenn sie beim nächsten Neuaufbau des
# Containers fehlen.
windows_pfad() {
  printf 'Z:%s' "$(printf '%s' "$1" | tr '/' '\\')"
}

set -- -userdatapath "$(windows_pfad "$WELTEN")"

if [ -n "${PALANTIR_STARTUP_PARAMETERS:-}" ]; then
  # Absichtlich ohne Anführungszeichen: die Wortzerlegung ist der Zweck.
  # shellcheck disable=SC2086
  set -- "$@" ${PALANTIR_STARTUP_PARAMETERS}
fi

log "Startet Sons of the Forest auf Port ${PORT} (Abfrage ${ABFRAGE_PORT}, Abgleich ${ABGLEICH_PORT}) unter Proton"

cd "$SERVER"

# Ohne `exec`: Zwischen Signal und Spielserver stehen ohnehin Proton und Wine.
# Der Server speichert in Abständen von selbst (`SaveInterval`) und beim
# Beenden; ein Konsolenbefehl wie bei Terraria ist nicht nötig.
proton_lauf "$BINAERDATEI" "$@" 0<&3 3>&-
