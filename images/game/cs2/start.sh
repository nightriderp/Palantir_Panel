#!/bin/sh
#
# Startskript des CS2-Images (`palantir-game-cs2`) – Schritt 1: nur Basic.
#
# Drei Dinge, sonst nichts:
#
#   1. Serverdateien über SteamCMD holen (Anwendung 730, anonym).
#   2. `steamclient.so` dorthin legen, wo CS2 sie sucht.
#   3. CS2 starten, wie Valves `game/cs2.sh` es tut – aber mit diesem Skript
#      als Hauptprozess, damit das Stoppsignal ankommt (Schritt 3.1).
#
# Einstellungen aus dem Panel: Servername, Server-Passwort, Spieleranzahl
# (Schritt 2), Startkarte, Spielmodus, Bots (Schritt 3), Workshop-Karte
# (Schritt 4), alle Runden spielen (Schritt 5). Keine Plugins.
#
# **Der Port kommt vom Panel** (`CS2_PORT`, Schritt 1.1): dieselbe Nummer, unter
# der der Server draußen erreichbar ist. CS2 nennt Clients seinen eigenen Port;
# weicht er vom öffentlichen ab, scheitert der Verbindungsaufbau still.
set -eu

. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/steam.sh"

SERVER="${PALANTIR_DATENORDNER}/server"
BINAERDATEI="${SERVER}/game/bin/linuxsteamrt64/cs2"
PORT="${CS2_PORT:-27015}"

palantir_intern_anlegen

# -----------------------------------------------------------------------------
# 1. Serverdateien – bei jedem Start abgeglichen, wie bei allen SteamCMD-Spielen.
steam_app_holen 730 "$SERVER"

if [ ! -f "$BINAERDATEI" ]; then
  palantir_log "Nach dem Holen fehlt ${BINAERDATEI}."
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
# 3. Einstellungen aus dem Panel
#
# **Name und Passwort in eine eigene Datei**, die CS2 beim Start ausführt
# (`+exec palantir`). Nicht als Startparameter: Das Passwort stünde sonst in der
# Prozessliste, und ein Name mit Leerzeichen müsste den Weg durch zwei
# Starter-Skripte überstehen. Die Datei schreibt das Skript bei jedem Start neu;
# eigene Zeilen gehören in `server.cfg`.
#
# Anführungszeichen und Zeilenumbrüche fallen weg: Sie beendeten den Wert in
# der Datei, und der Rest liefe als eigener Befehl.
sauber() {
  printf '%s' "$1" | tr -d '"\r\n;'
}

CFG_ORDNER="${SERVER}/game/csgo/cfg"
mkdir -p "$CFG_ORDNER"

# Spielmodus: CS2 kennt ihn nur als zwei Zahlen.
case "${CS2_GAME_MODE:-competitive}" in
  competitive) SPIEL_TYP=0; SPIEL_MODUS=1 ;;
  casual) SPIEL_TYP=0; SPIEL_MODUS=0 ;;
  wingman) SPIEL_TYP=0; SPIEL_MODUS=2 ;;
  armsrace) SPIEL_TYP=1; SPIEL_MODUS=0 ;;
  deathmatch) SPIEL_TYP=1; SPIEL_MODUS=2 ;;
  *)
    palantir_log "Unbekannter Spielmodus: ${CS2_GAME_MODE}."
    exit 78
    ;;
esac

# Nur Kartennamen, wie sie im Spiel heißen – der Wert landet als Argument
# hinter `+map`.
KARTE="${CS2_MAP:-de_dust2}"
case "$KARTE" in
  '' | *[!a-z0-9_]*)
    palantir_log "Ungueltige Karte: ${KARTE}."
    exit 78
    ;;
esac

# **Workshop-Karte** (Schritt 4): Karte `workshop` heißt „die Karte mit der
# Workshop-ID aus CS2_WORKSHOP_MAP". Nur Ziffern, und nicht 0: Ohne ID gäbe es
# nichts zu laden.
#
# **Nicht als Startparameter** (Fundpunkt 349, 24.09.2026). Mit
# `+host_workshop_map` in der Befehlszeile holte CS2 die Karte vollständig und
# blieb dann stehen – ohne Meldung, ohne CPU, der Status hing auf „startet".
# Bekannter CS2-Fehler: auf einer normalen Karte starten, dann wechseln. Das
# tut dieses Skript: Start auf de_dust2, und sobald CS2 bei Steam angemeldet
# ist, geht `host_workshop_map` in die Konsole – derselbe Weg wie beim
# Umstellen im laufenden Betrieb, und der funktioniert.
WORKSHOP_ID="${CS2_WORKSHOP_MAP:-0}"
case "$WORKSHOP_ID" in
  '' | *[!0-9]*)
    palantir_log "Ungueltige Workshop-ID: ${WORKSHOP_ID}."
    exit 78
    ;;
esac

if [ "$KARTE" = workshop ] && [ "$WORKSHOP_ID" -eq 0 ]; then
  palantir_log 'Als Startkarte ist "workshop" gewaehlt, aber keine Workshop-ID eingetragen.'
  exit 78
fi

# **Alle Runden spielen** (Schritt 5): `mp_match_can_clinch 0`. Das Panel
# schickt `true`/`false`; alles andere ist ein Fehler, kein stilles „aus".
case "${CS2_ALL_ROUNDS:-false}" in
  true) CLINCH=0 ;;
  false) CLINCH=1 ;;
  *)
    palantir_log "Ungueltiger Wert fuer alle Runden: ${CS2_ALL_ROUNDS}."
    exit 78
    ;;
esac

BOTS="${CS2_BOTS:-0}"
case "$BOTS" in
  '' | *[!0-9]*)
    palantir_log "Ungueltige Bot-Anzahl: ${BOTS}."
    exit 78
    ;;
esac

{
  echo '// Schreibt Palantir bei jedem Start neu - eigene Zeilen gehoeren in server.cfg.'
  printf 'hostname "%s"\n' "$(sauber "${CS2_HOSTNAME:-Palantir CS2}")"
  printf 'sv_password "%s"\n' "$(sauber "${CS2_PASSWORD:-}")"
  # `normal` heißt: genau so viele Bots, nicht „auffüllen bis".
  printf 'bot_quota_mode "normal"\n'
  printf 'bot_quota %s\n' "$BOTS"
  printf 'mp_match_can_clinch %s\n' "$CLINCH"
  # Kein Ruhezustand bei leerem Server (24.09.2026): Schlafend beantwortete
  # CS2 Konsolenbefehle aus dem Panel nicht – `mp_match_can_clinch` blieb
  # ohne Antwort, bis ein Spieler den Server weckte. Kostet etwas CPU im
  # Leerlauf.
  printf 'sv_hibernate_when_empty 0\n'
} > "${CFG_ORDNER}/palantir.cfg"

# **Nach der Modus-Konfiguration noch einmal** (Schritt 3). Beim Laden jeder
# Karte führt CS2 `gamemode_<modus>.cfg` aus, und die setzt unter anderem die
# Bot-Anzahl – unsere Werte vom Start wären danach überschrieben. Direkt
# danach sucht CS2 `gamemode_<modus>_server.cfg`, die dafür vorgesehene Stelle
# für eigene Einstellungen; dort steht nur `exec palantir`. Für alle Modi, damit
# kein Dateiname falsch geraten sein kann.
for modus in competitive casual competitive2v2 deathmatch armsrace; do
  printf '%s\n' '// Schreibt Palantir - fuehrt palantir.cfg nach der Modus-Konfiguration aus.' \
    'exec palantir' 'exec palantir_live' > "${CFG_ORDNER}/gamemode_${modus}_server.cfg"
done

# **Steuerung** (Schritt 3.2/3.3). Was im Panel bei laufendem Server
# umgestellt wird, schreibt das Backend in `palantir_live.cfg` – und in die
# Einstellungen, aus denen dieser Start schon `palantir.cfg` gebaut hat. Die
# Datei wird deshalb geleert.
printf '%s\n' '// Schreibt das Panel bei Live-Aenderungen; beim Start geleert.' \
  > "${CFG_ORDNER}/palantir_live.cfg"

set -- -dedicated -port "$PORT" +game_type "$SPIEL_TYP" +game_mode "$SPIEL_MODUS"

# Die Spieleranzahl ist ein Startparameter, kein Konsolenbefehl.
if [ -n "${CS2_MAX_PLAYERS:-}" ]; then
  set -- "$@" -maxplayers "$CS2_MAX_PLAYERS"
fi

if [ "$KARTE" = workshop ]; then
  set -- "$@" +map de_dust2 +exec palantir
else
  set -- "$@" +map "$KARTE" +exec palantir
fi

# -----------------------------------------------------------------------------
# 4. Start – und sauberes Ende (Schritt 3.1)
#
# **CS2 direkt, mit dem, was Valves `game/cs2.sh` für einen dedizierten Server
# tut:** Suchpfad `game/bin/linuxsteamrt64` (dort liegt u. a. `libv8.so`, ohne
# ihn „Unable to load module server"), Datei- und Stack-Limits, Arbeitsordner
# `game/`, `ENABLE_PATHMATCH`. Die Vorlage steht bei SteamTracking
# (`GameTracking-CS2/game/cs2.sh`).
#
# **Warum nicht mehr über `cs2.sh`:** Es startet CS2 als Kind und wartet. Mit
# `exec bash cs2.sh` war `bash` Prozess 1 im Container – und Prozess 1 bekommt
# SIGTERM nur, wenn er es abfängt. `bash` tat das nicht, CS2 bekam nichts
# davon mit, und jedes Stoppen lief in Dockers volle Frist (23.09.2026).
#
# **Darum bleibt dieses Skript stehen** und fängt das Signal selbst: Erst geht
# `quit` in die Konsole, damit CS2 sich selbst beendet; tut es das nicht
# binnen 20 Sekunden, bekommt CS2 das Signal direkt.
if [ -z "${ENABLE_PATHMATCH:-}" ]; then
  ENABLE_PATHMATCH=1
fi
LD_LIBRARY_PATH="${SERVER}/game/bin/linuxsteamrt64${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
export LD_LIBRARY_PATH ENABLE_PATHMATCH

# Wie `cs2.sh`. Als gewöhnlicher Benutzer darf das weiche Limit nicht über das
# harte – dann bleibt es, wie es ist.
# `-n` und `-s` stehen nicht in POSIX, `dash` (das `sh` im Image) kennt beide;
# eine Shell ohne sie scheitert still am `|| true`.
# shellcheck disable=SC3045
ulimit -n 65535 2> /dev/null || true
# shellcheck disable=SC3045
ulimit -s 2048 2> /dev/null || true

# CS2 liest Befehle von der Standardeingabe; das Rohr legt die Wurzel an.
palantir_konsole_oeffnen

# Eigene Variable fuer die Meldung - `KARTE` entscheidet unten noch, ob die
# Workshop-Karte nachgeladen wird.
KARTE_TEXT="$KARTE"
if [ "$KARTE" = workshop ]; then
  KARTE_TEXT="de_dust2, danach Workshop-Karte ${WORKSHOP_ID}"
fi
palantir_log "Startet CS2 (${CS2_GAME_MODE:-competitive}) auf ${KARTE_TEXT}, Port ${PORT}"

cd "${SERVER}/game"

beenden() {
  UNTERBROCHEN=1
  palantir_log 'Stoppsignal erhalten - schicke "quit" an die Konsole.'
  printf 'quit\n' >&3 2> /dev/null || true
  # Beendet sich CS2 nicht selbst, bekommt es das Signal direkt – als Kind
  # dieses Skripts, nicht als Prozess 1, also kommt es auch an.
  (
    sleep 20
    kill -TERM "${SERVER_PID:-}" 2> /dev/null || true
  ) &
}

# Liest die Ausgabe von CS2 mit, reicht jede Zeile weiter und schickt
# `host_workshop_map`, sobald CS2 seine Sitzung beim Game Coordinator hat – die
# letzte Startzeile, danach ist Steam bereit. Genau einmal; danach reicht
# `cat` den Rest durch, damit die Zeilenschleife nicht mitläuft.
workshop_nachladen() {
  while IFS= read -r zeile; do
    printf '%s\n' "$zeile"

    case "$zeile" in
      *'activated session on GC'*)
        palantir_log "Steam bereit - lade Workshop-Karte ${WORKSHOP_ID}."
        printf 'host_workshop_map %s\n' "$WORKSHOP_ID" >&3
        break
        ;;
    esac
  done

  cat
}

# Der Fang steht **vor** dem Start: Ein Signal in der Lücke dazwischen
# beendete die Shell sonst kommentarlos.
trap beenden TERM INT

if [ "$KARTE" = workshop ]; then
  # Nur mit Workshop-Karte läuft die Ausgabe über ein Rohr – der gewöhnliche
  # Start bleibt, wie er auf der Node bewiesen ist.
  AUSGABE="${PALANTIR_INTERN}/cs2-ausgabe"
  rm -f "$AUSGABE"
  mkfifo -m 600 "$AUSGABE"
  workshop_nachladen < "$AUSGABE" &
  "$BINAERDATEI" "$@" 0<&3 3>&- > "$AUSGABE" 2>&1 &
  SERVER_PID=$!
else
  "$BINAERDATEI" "$@" 0<&3 3>&- &
  SERVER_PID=$!
fi

# `wait` kehrt beim Signal mit 128+n zurück, auch wenn CS2 noch läuft – dann
# noch einmal warten; das zweite `wait` liefert den echten Status (Fundpunkt
# 337, wie bei Terraria und tModLoader).
ERGEBNIS=0
ERSTER_LAUF=1
while :; do
  UNTERBROCHEN=0

  if wait "$SERVER_PID"; then
    STATUS=0
  else
    STATUS=$?
  fi

  if [ "$ERSTER_LAUF" = 1 ] || [ "$STATUS" -ne 127 ]; then
    ERGEBNIS=$STATUS
  fi

  ERSTER_LAUF=0

  if [ "$UNTERBROCHEN" = 1 ] && [ "$STATUS" -gt 128 ]; then
    continue
  fi

  break
done

exit "$ERGEBNIS"
