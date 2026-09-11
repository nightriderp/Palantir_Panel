#!/bin/sh
#
# Startskript des V-Rising-Images – ein Windows-Server unter Proton.
#
# Stunlock gibt den Server nur als Windows-Programm heraus; das Panel führt ihn
# über Proton aus. Der Ablauf:
#
#   1. SteamCMD holt die **Windows-Dateien** (Anwendung 1829350, anonym).
#   2. Ein Bildschirm entsteht, den es nicht gibt: V Rising ist ein
#      Unity-Programm und verlangt unter Wine eine X11-Verbindung, obwohl
#      niemand zusieht.
#   3. Die Einstellungen stehen in `Settings/ServerHostSettings.json` unterhalb
#      des `-persistentDataPath`. Stunlock liest erst die Vorgaben aus dem
#      Installationsordner und legt diese Datei darüber – **es muss also nur
#      drinstehen, was abweicht.**
#   4. Gestartet wird über `proton run`.
#
# RCON ist an: V Rising spricht das Source-Protokoll, und damit hat dieses
# Spiel als eines der wenigen Windows-Spiele eine echte Konsole im Panel.

set -eu

. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/steam.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/proton.sh"

# Anwendungsnummer des dedizierten Servers bei Valve. Beim Laufen meldet sich
# der Server mit der Nummer des Spiels – die steht in `steam_appid.txt` neben
# der Programmdatei und kommt mit den Serverdateien.
VRISING_ANWENDUNG=1829350

SERVER="${PALANTIR_DATENORDNER}/server"
# `-persistentDataPath`: Darunter legt der Server `Settings/` und `Saves/` an.
# Beides gehört dem Betreiber und überlebt eine Neuinstallation der
# Serverdateien.
WELTEN="${PALANTIR_DATENORDNER}/welten"
EINSTELLUNGEN="${WELTEN}/Settings"

log() {
  palantir_log "$@"
}

palantir_intern_anlegen
mkdir -p "$EINSTELLUNGEN"

# -----------------------------------------------------------------------------
# 1. Serverdateien (Windows)
proton_app_holen "$VRISING_ANWENDUNG" "$SERVER"

BINAERDATEI="${SERVER}/VRisingServer.exe"

if [ ! -f "$BINAERDATEI" ]; then
  log "Der Server fehlt: ${BINAERDATEI}"
  log 'Kam SteamCMD an die Windows-Dateien? Den Ordner "server" im Datenordner'
  log 'löschen und neu starten holt sie erneut.'
  exit 78
fi

# -----------------------------------------------------------------------------
# 2. RCON-Passwort
#
# Es entsteht bei jedem Start neu und verlässt die Node nie: Der RCON-Port wird
# nicht veröffentlicht, erreichbar ist er allein für den Agent.
RCON_PASSWORT_DATEI="${PALANTIR_INTERN}/rcon.password"
RCON_PASSWORT="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
ALTE_UMASK="$(umask)"
umask 077
printf '%s\n' "$RCON_PASSWORT" > "$RCON_PASSWORT_DATEI"
umask "$ALTE_UMASK"

# -----------------------------------------------------------------------------
# 3. ServerHostSettings.json
#
# `json_text` maskiert, was ein JSON-Text nicht verträgt. Ohne das zerbräche ein
# Anführungszeichen im Servernamen die Datei – und der Server startete mit den
# Vorgaben, also ohne Passwort und auf fremden Ports.
json_text() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\r//g' | tr -d '\n'
}

# `true` oder `false` – aus einem Schalter des Panels, der auch „1" oder „ja"
# sein darf.
json_schalter() {
  case "$1" in
    true | TRUE | True | 1 | ja | yes | on) printf 'true' ;;
    *) printf 'false' ;;
  esac
}

PORT="${SERVER_PORT:-9876}"
ABFRAGE_PORT="${VRISING_QUERY_PORT:-9877}"
OEFFENTLICH="$(json_schalter "${VRISING_PUBLIC:-true}")"

{
  printf '{\n'
  printf '  "Name": "%s",\n' "$(json_text "${VRISING_NAME:-Ein Palantir-Server}")"
  printf '  "Description": "%s",\n' "$(json_text "${VRISING_DESCRIPTION:-}")"
  printf '  "Port": %s,\n' "$PORT"
  printf '  "QueryPort": %s,\n' "$ABFRAGE_PORT"
  printf '  "MaxConnectedUsers": %s,\n' "${MAX_PLAYERS:-40}"
  printf '  "MaxConnectedAdmins": 4,\n'
  printf '  "ServerFps": 30,\n'
  printf '  "SaveName": "%s",\n' "$(json_text "${VRISING_SAVE_NAME:-welt}")"
  printf '  "Password": "%s",\n' "$(json_text "${VRISING_PASSWORD:-}")"
  printf '  "Secure": true,\n'
  # Beide Verzeichnisse hängen an einem Schalter: Das Steam-Verzeichnis trägt
  # die Abfrage, über die das Panel Spielerzahl und Ping erfährt, das
  # EOS-Verzeichnis ist die Liste, in der der Spieler tatsächlich sucht. Wer
  # „nicht listen" wählt, meint beide.
  printf '  "ListOnSteam": %s,\n' "$OEFFENTLICH"
  printf '  "ListOnEOS": %s,\n' "$OEFFENTLICH"
  printf '  "AutoSaveCount": 20,\n'
  printf '  "AutoSaveInterval": %s,\n' "${VRISING_SAVE_INTERVAL:-120}"
  printf '  "GameSettingsPreset": "%s",\n' "$(json_text "${VRISING_PRESET:-}")"
  printf '  "GameDifficultyPreset": "%s",\n' "$(json_text "${VRISING_DIFFICULTY:-}")"
  printf '  "Rcon": {\n'
  printf '    "Enabled": true,\n'
  printf '    "Port": %s,\n' "${RCON_PORT:-25575}"
  printf '    "Password": "%s"\n' "$(json_text "$RCON_PASSWORT")"
  printf '  }\n'
  printf '}\n'
} > "${EINSTELLUNGEN}/ServerHostSettings.json"

# Wer im Spiel Administrator sein will, trägt hier seine Steam-Kennung ein –
# eine je Zeile. Die Datei wird nur angelegt, nie überschrieben: Was der
# Betreiber hineinschreibt, bleibt.
if [ ! -f "${EINSTELLUNGEN}/adminlist.txt" ]; then
  : > "${EINSTELLUNGEN}/adminlist.txt"
fi

if [ ! -f "${EINSTELLUNGEN}/banlist.txt" ]; then
  : > "${EINSTELLUNGEN}/banlist.txt"
fi

# -----------------------------------------------------------------------------
# 4. Proton und Bildschirm
proton_vorbereiten
proton_bildschirm_starten

# -----------------------------------------------------------------------------
# 5. Konsole und Start
#
# Das Rohr entsteht wie bei jedem Image; bedient wird die Konsole aber über
# RCON (`console: { kind: 'rcon' }` in der Spieltyp-Definition), nicht über die
# Standardeingabe – die liest V Rising nicht.
palantir_konsole_oeffnen

# Proton sieht den Datenordner als Windows-Laufwerk `Z:`. Ein Linux-Pfad als
# `-persistentDataPath` liefe ins Leere, und der Server legte Einstellungen und
# Spielstände irgendwohin – sichtbar erst, wenn sie beim nächsten Neuaufbau des
# Containers fehlen.
windows_pfad() {
  printf 'Z:%s' "$(printf '%s' "$1" | tr '/' '\\')"
}

set -- -persistentDataPath "$(windows_pfad "$WELTEN")"

if [ -n "${PALANTIR_STARTUP_PARAMETERS:-}" ]; then
  # Absichtlich ohne Anführungszeichen: die Wortzerlegung ist der Zweck.
  # shellcheck disable=SC2086
  set -- "$@" ${PALANTIR_STARTUP_PARAMETERS}
fi

log "Startet V Rising auf Port ${PORT} (Abfrage ${ABFRAGE_PORT}) unter Proton"

cd "$SERVER"

# Ohne `exec`: Zwischen Signal und Spielserver stehen ohnehin Proton und Wine.
# V Rising speichert in kurzen Abständen von selbst (`AutoSaveInterval`); beim
# Stoppen ist deshalb kein Konsolenbefehl nötig wie bei Terraria.
proton_lauf "$BINAERDATEI" "$@" 0<&3 3>&-
