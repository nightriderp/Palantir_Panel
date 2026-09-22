#!/bin/sh
#
# Startskript des CS2-Images (`palantir-game-cs2`).
#
# Fünf Dinge:
#
#   1. Serverdateien über SteamCMD holen (Anwendung 730, anonym).
#   2. `steamclient.so` dorthin legen, wo der Server sie sucht – ohne sie
#      startet CS2 nicht.
#   3. `gamemodes_server.txt` anlegen, falls Valve nur die Vorlage mitbringt.
#   4. Die Felder des Panels in eine eigene `palantir.cfg` schreiben.
#   5. Konsole öffnen und den Server starten.
#
# **CS2 hat kein RCON.** Valve hat es nie freigeschaltet; die Konsole geht
# deshalb über die Standardeingabe, wie bei Terraria. Wer RCON im Spiel möchte,
# braucht das Fake-RCON-Plugin – das ist eine Sache der Plugin-Verwaltung, nicht
# dieses Skripts.
set -eu

. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/steam.sh"

# Anwendungsnummer des dedizierten Servers bei Valve. Dieselbe wie beim Spiel,
# und anonym zu holen.
CS2_ANWENDUNG=730

SERVER="${PALANTIR_DATENORDNER}/server"
BINAERDATEI="${SERVER}/game/bin/linuxsteamrt64/cs2"
CFG_ORDNER="${SERVER}/game/csgo/cfg"

log() {
  palantir_log "$@"
}

palantir_intern_anlegen

# -----------------------------------------------------------------------------
# 1. Serverdateien
#
# Bei jedem Start, wie bei allen SteamCMD-Spielen: Ist alles auf dem Stand,
# kostet es Sekunden; ist es das nicht, kommt das Update, ohne dass jemand ein
# neues Image bauen muss.
steam_app_holen "$CS2_ANWENDUNG" "$SERVER"

if [ ! -f "$BINAERDATEI" ]; then
  log "Nach dem Holen fehlt ${BINAERDATEI}."
  log 'Den Ordner "server" im Datenordner loeschen und neu starten holt alles erneut.'
  exit 69
fi

chmod 0755 "$BINAERDATEI" 2> /dev/null || true

# -----------------------------------------------------------------------------
# 2. steamclient.so
#
# **Ohne sie startet CS2 nicht.** Der Server sucht sie unter `~/.steam/sdk64`
# und bricht sonst beim Anmelden an Steam ab.
#
# `HOME` wird hier ausdruecklich umgesetzt: `steam_vorbereiten` legt es in den
# SteamCMD-Ordner, damit dessen Zwischenspeicher dort landet. Fuer den Server
# soll es der interne Ordner sein - sonst lieferte `~` zwei verschiedene Orte,
# je nachdem, wer gerade fragt. Genauso macht es das Palworld-Image.
#
# Kopiert statt verlinkt: Ein Symlink zeigte auf einen Pfad im Datenordner, der
# beim Umziehen eines Servers nicht mitwandert.
HOME="$PALANTIR_INTERN"
export HOME

STEAMCLIENT="${PALANTIR_INTERN}/steam/linux64/steamclient.so"

if [ -f "$STEAMCLIENT" ]; then
  mkdir -p "${HOME}/.steam/sdk64"
  cp -f "$STEAMCLIENT" "${HOME}/.steam/sdk64/steamclient.so"
else
  log "Hinweis: ${STEAMCLIENT} fehlt - wenn die Anmeldung an Steam scheitert, liegt es daran."
fi

# -----------------------------------------------------------------------------
# 3. Spielmodus
#
# CS2 kennt Modi nur als zwei Zahlen. Im Panel stehen Wörter – ein Auswahlfeld
# mit „0, 1" wäre für den Betreiber nicht zu entziffern. Übersetzt wird hier,
# damit die Zahlen an einer Stelle stehen.
case "${CS2_GAME_MODE:-competitive}" in
  casual) SPIEL_TYP=0; SPIEL_MODUS=0 ;;
  competitive) SPIEL_TYP=0; SPIEL_MODUS=1 ;;
  wingman) SPIEL_TYP=0; SPIEL_MODUS=2 ;;
  armsrace) SPIEL_TYP=1; SPIEL_MODUS=0 ;;
  deathmatch) SPIEL_TYP=1; SPIEL_MODUS=2 ;;
  custom) SPIEL_TYP=3; SPIEL_MODUS=0 ;;
  *)
    log "Unbekannter Spielmodus: ${CS2_GAME_MODE}."
    log 'Erlaubt sind casual, competitive, wingman, armsrace, deathmatch, custom.'
    exit 78
    ;;
esac

# -----------------------------------------------------------------------------
# 4. gamemodes_server.txt
#
# Hier stehen die Spielerzahl je Modus und die eigene Kartenliste. Die Datei
# gehört dem Betreiber – das Skript legt sie an, wenn es sie nicht gibt, und
# fasst sie danach nicht mehr an. Eine Zeile je Schlüssel gibt es dort nicht,
# es ist ein verschachteltes Valve-Format; verschmelzen wäre Raterei.
GAMEMODES="${SERVER}/game/csgo/gamemodes_server.txt"

if [ ! -f "$GAMEMODES" ] && [ -f "${GAMEMODES}.example" ]; then
  log 'Lege gamemodes_server.txt aus der Vorlage an (Spielerzahl und Kartenliste stehen dort).'
  cp "${GAMEMODES}.example" "$GAMEMODES"
fi

# -----------------------------------------------------------------------------
# 5. palantir.cfg
#
# Die Felder des Panels landen in einer **eigenen** Datei, nicht in der
# `server.cfg` des Betreibers.
#
# **Warum nicht verschmelzen wie bei Terraria:** `palantir_schluessel_verschmelzen`
# kann `schluessel=wert`; eine `server.cfg` trennt mit Leerzeichen und kennt
# Anfuehrungszeichen. Eine zweite Auslegung derselben Aufgabe waere eine
# Fehlerquelle mehr – und die `server.cfg` ist die Datei, in der Serverbetreiber
# ihre eigenen Zeilen erwarten.
#
# **Wer gewinnt, wenn beide dasselbe setzen:** die `server.cfg`. Sie laeuft bei
# jedem Kartenwechsel, unsere Datei einmal beim Start. Wer eine Zeile von Hand
# dorthin schreibt, will sie offenbar – dann soll sie auch gelten. Das steht so
# in der README des Images.
mkdir -p "$CFG_ORDNER"

ZIEL="${CFG_ORDNER}/palantir.cfg"

# **Schalter kommen als `true`/`false` an**, nicht als Zahlen: Das Panel
# schreibt jeden Wert mit `String()` in die Umgebung. CS2 will `0` und `1` –
# und beim Rundenschalter auch noch umgekehrt: „Alle Runden spielen“ an
# heisst `mp_match_can_clinch 0`. Beides steht hier, an einer Stelle.
ist_an() {
  case "${1:-}" in
    true | 1) return 0 ;;
    *) return 1 ;;
  esac
}

if ist_an "${CS2_ALL_ROUNDS:-}"; then
  KANN_ENTSCHEIDEN=0
else
  KANN_ENTSCHEIDEN=1
fi

if ist_an "${CS2_GOTV:-}"; then
  GOTV=1
else
  GOTV=0
fi

# Anfuehrungszeichen im Wert wuerden die Zeile zerreissen; sie fallen weg.
sauber() {
  printf '%s' "$1" | tr -d '"\r\n'
}

{
  echo '// Diese Datei schreibt Palantir bei jedem Start neu.'
  echo '// Eigene Zeilen gehoeren in server.cfg - die laeuft danach und sticht.'
  printf 'hostname "%s"\n' "$(sauber "${CS2_HOSTNAME:-Ein Palantir-Server}")"
  printf 'sv_password "%s"\n' "$(sauber "${CS2_PASSWORD:-}")"
  # Ohne diese Zeile laeuft ein Spiel bis zum Sieg. Mit `0` werden alle Runden
  # gespielt, egal wie es steht (DatHost: „Play all 24 rounds").
  printf 'mp_match_can_clinch %s\n' "$KANN_ENTSCHEIDEN"
  # GOTV. `tv_autorecord` bleibt aus: Es ist ausdruecklich nicht empfohlen und
  # legte bei jedem Spiel eine Aufzeichnung an, bis die Platte voll ist.
  printf 'tv_enable %s\n' "$GOTV"
  printf 'tv_autorecord 0\n'
} > "$ZIEL"

# -----------------------------------------------------------------------------
# 6. Startparameter
#
# Die Reihenfolge ist die, die Valve selbst nennt: erst die Schalter mit
# Bindestrich, dann die Konsolenbefehle mit Plus.
PORT="${SERVER_PORT:-27015}"

set -- -dedicated -port "$PORT" +game_type "$SPIEL_TYP" +game_mode "$SPIEL_MODUS" \
  +exec palantir

# **Workshop statt FastDL.** Valve hat den alten Weg abgeschafft: Eigene Karten
# kommen nur noch aus dem Steam-Workshop (DatHost: „The conventional method
# involving FastDL is no longer supported").
case "${CS2_MAP_SOURCE:-standard}" in
  standard)
    set -- "$@" +map "${CS2_MAP:-de_dust2}"
    ;;
  workshop-map)
    if [ -z "${CS2_WORKSHOP_ID:-}" ]; then
      log 'Fuer eine Workshop-Karte fehlt die Workshop-Nummer.'
      exit 78
    fi
    set -- "$@" +host_workshop_map "$CS2_WORKSHOP_ID"
    ;;
  workshop-collection)
    if [ -z "${CS2_WORKSHOP_ID:-}" ]; then
      log 'Fuer eine Workshop-Sammlung fehlt die Sammlungsnummer.'
      exit 78
    fi
    # Eine Startkarte laesst sich hier nicht setzen - das kann Valve nicht
    # (DatHost: „Setting a start map for the Workshop collection is currently
    # not supported").
    set -- "$@" +host_workshop_collection "$CS2_WORKSHOP_ID"
    ;;
  *)
    log "Unbekannte Kartenquelle: ${CS2_MAP_SOURCE}."
    log 'Erlaubt sind standard, workshop-map, workshop-collection.'
    exit 78
    ;;
esac

if [ -n "${MAX_PLAYERS:-}" ]; then
  set -- "$@" +maxplayers "$MAX_PLAYERS"
fi

# **Der GSLT ist keine Pflicht, aber ohne ihn taucht der Server nicht im
# Serverbrowser auf** (DatHost). Valve will das kuenftig erzwingen.
#
# Er steht als Startparameter und nicht in der server.cfg, weil Valve es so
# dokumentiert. Dass er damit in der Prozessliste steht, ist hinnehmbar: In den
# Container sieht nur, wer ohnehin an den Datenordner kaeme.
if [ -n "${CS2_GSLT:-}" ]; then
  set -- "$@" +sv_setsteamaccount "$CS2_GSLT"
fi

if [ -n "${PALANTIR_STARTUP_PARAMETERS:-}" ]; then
  # Absichtlich ohne Anführungszeichen: die Wortzerlegung ist der Zweck.
  # shellcheck disable=SC2086
  set -- "$@" ${PALANTIR_STARTUP_PARAMETERS}
fi

# -----------------------------------------------------------------------------
# 7. Konsole und Start
#
# CS2 liest Befehle von der Standardeingabe. Das Rohr legt die Wurzel an;
# `palantir-console` schreibt hinein.
palantir_konsole_oeffnen

log "Startet CS2 (${CS2_GAME_MODE:-competitive}) auf Port ${PORT}"

cd "$SERVER"

exec "$BINAERDATEI" "$@" 0<&3 3>&-
