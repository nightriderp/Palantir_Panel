#!/bin/sh
#
# Startskript des ARK-Images (Survival Ascended) – ein Windows-Server unter
# Proton **10**.
#
# Der Ablauf ist der der anderen Proton-Spiele, mit drei Unterschieden:
#
#   1. Die Laufzeit ist `base/proton10`, nicht `base/proton`. GE-Proton 11
#      bleibt beim Start dieses Servers hängen – ohne Meldung und ohne Ende.
#   2. Die Einstellungen stehen in einer **Optionskette** hinter dem Kartennamen,
#      mit `?` getrennt, und nicht in einer Konfigurationsdatei.
#   3. Der Serverordner ist riesig (zweistellig viele Gigabyte). Der erste Start
#      dauert entsprechend.
#
# **Das Verwalter-Passwort ist zugleich das RCON-Passwort.** ARK kennt dafür
# kein eigenes Feld: Wer RCON spricht, ist Verwalter. Setzt der Betreiber keins,
# entsteht ein zufälliges – dann hat das Panel seine Konsole, und im Spiel wird
# niemand Verwalter.

set -eu

. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/steam.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/proton.sh"

# Anwendungsnummer des dedizierten Servers bei Valve.
ARK_ANWENDUNG=2430930

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
proton_app_holen "$ARK_ANWENDUNG" "$SERVER"

BINAERDATEI="${SERVER}/ShooterGame/Binaries/Win64/ArkAscendedServer.exe"

if [ ! -f "$BINAERDATEI" ]; then
  log "Der Server fehlt: ${BINAERDATEI}"
  log 'Kam SteamCMD an die Windows-Dateien? Den Ordner "server" im Datenordner'
  log 'löschen und neu starten holt sie erneut – das sind allerdings zweistellig'
  log 'viele Gigabyte.'
  exit 78
fi

# -----------------------------------------------------------------------------
# 2. Die Spielstände aus dem Serverordner herausholen
#
# Die Unreal Engine legt sie unter `ShooterGame/Saved` ab – mitten in dem, was
# SteamCMD verwaltet. Wer den Serverordner löscht, um die Dateien neu zu holen,
# löschte damit die Welt. Ein Verweis führt sie nach `/data/welten`, wo sie zum
# Betreiber gehören; SteamCMD rührt ihn bei einer Aktualisierung nicht an.
GESPEICHERT="${SERVER}/ShooterGame/Saved"

if [ -d "$GESPEICHERT" ] && [ ! -L "$GESPEICHERT" ]; then
  log 'Hole die Spielstände aus dem Serverordner nach /data/welten.'
  cp -a "${GESPEICHERT}/." "$WELTEN/" 2> /dev/null || true
  rm -rf "$GESPEICHERT"
fi

if [ ! -L "$GESPEICHERT" ]; then
  mkdir -p "$(dirname "$GESPEICHERT")"
  ln -s "$WELTEN" "$GESPEICHERT"
fi

# -----------------------------------------------------------------------------
# 3. Verwalter- und RCON-Passwort
#
# Es verlässt die Node nie: Der RCON-Port wird nicht veröffentlicht, erreichbar
# ist er allein für den Agent.
RCON_PASSWORT_DATEI="${PALANTIR_INTERN}/rcon.password"

if [ -n "${ARK_ADMIN_PASSWORD:-}" ]; then
  RCON_PASSWORT="$ARK_ADMIN_PASSWORD"
else
  # Ohne Passwort des Betreibers ein zufälliges: Das Panel bekommt seine
  # Konsole, im Spiel wird niemand Verwalter.
  RCON_PASSWORT="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
fi

ALTE_UMASK="$(umask)"
umask 077
printf '%s\n' "$RCON_PASSWORT" > "$RCON_PASSWORT_DATEI"
umask "$ALTE_UMASK"

# -----------------------------------------------------------------------------
# 4. Die Optionskette
#
# Alles hinter dem Kartennamen wird mit `?` getrennt. Ein `?` im Servernamen
# zerschnitte die Kette und der Server startete mit halben Einstellungen –
# deshalb fliegen `?`, Anführungszeichen und Zeilenumbrüche heraus.
ketten_text() {
  printf '%s' "$1" | tr -d '?"\r\n'
}

KARTE="$(ketten_text "${ARK_MAP:-TheIsland_WP}")"

KETTE="${KARTE}?listen"
KETTE="${KETTE}?SessionName=$(ketten_text "${ARK_NAME:-Ein Palantir-Server}")"
KETTE="${KETTE}?ServerPassword=$(ketten_text "${ARK_PASSWORD:-}")"
KETTE="${KETTE}?ServerAdminPassword=$(ketten_text "$RCON_PASSWORT")"
KETTE="${KETTE}?RCONEnabled=True"
KETTE="${KETTE}?RCONPort=${RCON_PORT:-27020}"
# Wie oft die Welt von selbst gespeichert wird. Das ist bei diesem Spiel keine
# Feinheit: ARK speichert beim Stoppsignal **nicht**, und was seit dem letzten
# Mal geschehen ist, ist dann fort.
KETTE="${KETTE}?AutoSavePeriodMinutes=${ARK_AUTOSAVE:-10}"

# -----------------------------------------------------------------------------
# 5. Proton und Bildschirm
proton_vorbereiten
proton_bildschirm_starten

# -----------------------------------------------------------------------------
# 6. Konsole und Start
#
# Das Rohr entsteht wie bei jedem Image; bedient wird die Konsole aber über RCON
# (`console: { kind: 'rcon' }` in der Spieltyp-Definition). ARK liest seine
# Standardeingabe nicht.
palantir_konsole_oeffnen

PORT="${SERVER_PORT:-7777}"
ABFRAGE_PORT="${ARK_QUERY_PORT:-27015}"

set -- "$KETTE" \
  "-WinLiveMaxPlayers=${MAX_PLAYERS:-70}" \
  "-Port=${PORT}" \
  "-QueryPort=${ABFRAGE_PORT}" \
  "-RCONPort=${RCON_PORT:-27020}" \
  -game -server -log \
  -NoHangDetection

# BattlEye ist Vorgabe **aus**: Unter Proton ist der Dienst eine zusätzliche
# Fehlerquelle, und ein Server, der wegen BattlEye nicht startet, sieht aus wie
# ein Server, der gar nicht startet.
case "${ARK_BATTLEYE:-false}" in
  true | TRUE | True | 1 | ja | yes | on) ;;
  *) set -- "$@" -NoBattlEye ;;
esac

# Crossplay lässt auch Spieler aus dem Microsoft Store herein; ohne es bleibt
# der Server unter Steam.
case "${ARK_CROSSPLAY:-false}" in
  true | TRUE | True | 1 | ja | yes | on) set -- "$@" -crossplay ;;
  *) ;;
esac

# Mods holt der Server selbst von CurseForge – Kennungen mit Komma getrennt.
if [ -n "${ARK_MODS:-}" ]; then
  set -- "$@" "-mods=$(printf '%s' "$ARK_MODS" | tr -d ' \r\n')"
fi

if [ -n "${PALANTIR_STARTUP_PARAMETERS:-}" ]; then
  # Absichtlich ohne Anführungszeichen: die Wortzerlegung ist der Zweck.
  # shellcheck disable=SC2086
  set -- "$@" ${PALANTIR_STARTUP_PARAMETERS}
fi

log "Startet ARK (${KARTE}) auf Port ${PORT} (Abfrage ${ABFRAGE_PORT}) unter Proton"

cd "$SERVER"

# Ohne `exec`: Zwischen Signal und Spielserver stehen ohnehin Proton und Wine.
#
# **ARK speichert beim Stoppsignal nicht.** Anders als bei Terraria lässt sich
# das hier nicht auffangen: Der Befehl dafür (`DoExit`) ginge über RCON, und
# einen RCON-Sprecher hat dieses Image nicht. Was seit dem letzten
# selbsttätigen Speichern geschehen ist, ist nach einem Stopp fort – deshalb
# steht `AutoSavePeriodMinutes` niedriger, als ARK es vorgibt.
proton_lauf "$BINAERDATEI" "$@" 0<&3 3>&-
