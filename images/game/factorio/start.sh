#!/bin/sh
#
# Startskript des Factorio-Images.
#
# Fünf Dinge:
#
#   1. Es holt den Headless-Server beim ersten Start in den Datenordner und
#      packt ihn aus – Wube erlaubt das Herunterladen, nicht das Weiterverteilen.
#   2. Es legt eine Karte an, wenn noch keine da ist.
#   3. Es schreibt `server-settings.json` aus den Feldern des Panels.
#   4. Es erzeugt bei jedem Start ein neues RCON-Passwort – Factorio spricht das
#      Source-RCON-Protokoll, dasselbe wie Minecraft, das Panel kann seine
#      Konsole also direkt anschließen.
#   5. Es ersetzt sich per `exec` durch den Server: Factorio speichert bei
#      SIGTERM selbst, es braucht keinen Umweg über die Konsole.

set -eu

. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"

DATENORDNER="$PALANTIR_DATENORDNER"
INTERN="$PALANTIR_INTERN"

# Serverdateien und Spielstände getrennt: Eine neue Spielfassung ersetzt den
# Serverordner vollständig, die Karten gehören dem Betreiber.
SERVER="${INTERN}/server"
KARTEN="${DATENORDNER}/karten"

FASSUNG="${FACTORIO_VERSION:-unbekannt}"
BINAERDATEI="${SERVER}/factorio/bin/x64/factorio"

log() {
  palantir_log "$@"
}

palantir_intern_anlegen
mkdir -p "$KARTEN"

# Factorio legt sonst `~/.factorio` an; im Container gäbe es kein beschreibbares
# Zuhause.
HOME="$INTERN"
export HOME

# -----------------------------------------------------------------------------
# 1. Serverdateien
if [ ! -x "$BINAERDATEI" ]; then
  if [ -z "${FACTORIO_URL:-}" ] || [ -z "${FACTORIO_SHA256:-}" ]; then
    log 'Es fehlen FACTORIO_URL oder FACTORIO_SHA256. Beide setzt das Image.'
    exit 78
  fi

  ARCHIV="${INTERN}/factorio-${FASSUNG}.tar.xz"

  # 69 ist `EX_UNAVAILABLE`: Die Quelle war das Problem, nicht die Einstellung.
  if ! palantir_datei_holen "$FACTORIO_URL" "$FACTORIO_SHA256" "$ARCHIV"; then
    log 'Die Serverdateien konnten nicht geholt werden. Ein erneuter Start versucht es wieder.'
    exit 69
  fi

  # Der alte Ordner muss weg, sonst mischen sich zwei Fassungen: Das Archiv
  # trägt `factorio/` als oberste Ebene und `tar` überschreibt nur, was es
  # kennt.
  rm -rf "${SERVER}/factorio"

  if ! palantir_tar_auspacken "$ARCHIV" "$SERVER"; then
    rm -f "$ARCHIV"
    exit 69
  fi

  rm -f "$ARCHIV"

  if [ ! -f "$BINAERDATEI" ]; then
    log "Im Archiv steckt kein factorio/bin/x64/factorio."
    exit 69
  fi

  chmod 0755 "$BINAERDATEI"
fi

# -----------------------------------------------------------------------------
# 2. Karte
#
# `--create` legt eine an und beendet sich wieder. Danach startet der Server auf
# derselben Datei – ohne diesen Schritt bricht er mit „map file not found" ab,
# und im Log stünde nichts, womit ein Betreiber etwas anfangen kann.
KARTE="${KARTEN}/${FACTORIO_MAP:-palantir}.zip"

if [ ! -f "$KARTE" ]; then
  log "Legt eine neue Karte an: $(basename "$KARTE")"

  if [ -n "${FACTORIO_SEED:-}" ]; then
    "$BINAERDATEI" --create "$KARTE" --map-gen-seed "$FACTORIO_SEED"
  else
    "$BINAERDATEI" --create "$KARTE"
  fi
fi

# -----------------------------------------------------------------------------
# 3. server-settings.json
#
# Factorio liest die Einstellungen als JSON. Geschrieben wird die Datei bei
# jedem Start neu – anders als bei `server.properties` gibt es hier nichts zu
# verschmelzen: Wer eigene Schlüssel setzen will, hängt sie über
# `PALANTIR_STARTUP_PARAMETERS` an eine eigene Datei.
#
# `json_text` maskiert, was ein JSON-Text nicht verträgt. Ohne das zerbräche ein
# Anführungszeichen im Servernamen die Datei, und der Server startete nicht –
# mit einer Meldung über Zeile und Spalte, die niemandem hilft.
json_text() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\r//g' | tr -d '\n'
}

EINSTELLUNGEN="${INTERN}/server-settings.json"
OEFFENTLICH="${FACTORIO_PUBLIC:-false}"
[ "$OEFFENTLICH" = 'true' ] || OEFFENTLICH='false'

{
  printf '{\n'
  printf '  "name": "%s",\n' "$(json_text "${FACTORIO_NAME:-Ein Palantir-Server}")"
  printf '  "description": "%s",\n' "$(json_text "${MOTD:-}")"
  printf '  "max_players": %s,\n' "${MAX_PLAYERS:-0}"
  # `public` verlangt ein Konto bei Wube (`username`/`token`); ohne eines
  # bleibt der Server aus dem öffentlichen Verzeichnis heraus. `lan` kostet
  # nichts und schadet nicht: Im Container gibt es kein LAN, in dem er
  # auftauchen könnte.
  printf '  "visibility": { "public": %s, "lan": true },\n' "$OEFFENTLICH"
  printf '  "username": "%s",\n' "$(json_text "${FACTORIO_USERNAME:-}")"
  printf '  "token": "%s",\n' "$(json_text "${FACTORIO_TOKEN:-}")"
  printf '  "game_password": "%s",\n' "$(json_text "${FACTORIO_PASSWORD:-}")"
  # Ohne Konto bei Wube kann der Server die Spieler nicht prüfen; verlangte er
  # es trotzdem, käme niemand herein.
  printf '  "require_user_verification": false,\n'
  printf '  "autosave_interval": %s,\n' "${FACTORIO_AUTOSAVE_MINUTES:-10}"
  printf '  "autosave_slots": 5,\n'
  printf '  "allow_commands": "admins-only",\n'
  printf '  "auto_pause": true\n'
  printf '}\n'
} > "$EINSTELLUNGEN"

# -----------------------------------------------------------------------------
# 4. RCON
#
# Factorio spricht das Source-RCON-Protokoll – dasselbe wie Minecraft. Das Panel
# schließt seine Konsole deshalb direkt an und bekommt die Antwort eines Befehls
# zurück, statt sie im Log zu suchen. Das Passwort entsteht bei jedem Start neu
# und liegt nur im Datenordner (0600); der Port wird nie veröffentlicht.
RCON_PASSWORT_DATEI="${INTERN}/rcon.password"
RCON_PASSWORT="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
ALTE_UMASK="$(umask)"
umask 077
printf '%s\n' "$RCON_PASSWORT" > "$RCON_PASSWORT_DATEI"
umask "$ALTE_UMASK"

# -----------------------------------------------------------------------------
# 5. Konsole und Start
#
# Das Rohr entsteht zusätzlich zum RCON: Der Server liest auch von der
# Standardeingabe, und `palantir-console` bleibt damit für einen Zugriff von
# Hand brauchbar.
palantir_konsole_oeffnen

set -- --start-server "$KARTE" \
  --server-settings "$EINSTELLUNGEN" \
  --port "${SERVER_PORT:-34197}" \
  --bind 0.0.0.0 \
  --rcon-port "${RCON_PORT:-27015}" \
  --rcon-password "$RCON_PASSWORT"

if [ -n "${PALANTIR_STARTUP_PARAMETERS:-}" ]; then
  # Absichtlich ohne Anführungszeichen: die Wortzerlegung ist der Zweck.
  # shellcheck disable=SC2086
  set -- "$@" ${PALANTIR_STARTUP_PARAMETERS}
fi

log "Startet Factorio ${FASSUNG} auf Karte $(basename "$KARTE")"

exec "$BINAERDATEI" "$@" 0<&3 3>&-
