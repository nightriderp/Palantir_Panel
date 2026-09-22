#!/bin/sh
#
# Startskript des CS2-Images (`palantir-game-cs2`).
#
# Der Reihe nach:
#
#   1. Serverdateien über SteamCMD holen (Anwendung 730, anonym) – ausser der
#      Administrator hält Updates zurück (`PALANTIR_UPDATES_HALTEN`).
#   2. `steamclient.so` dorthin legen, wo der Server sie sucht – ohne sie
#      startet CS2 nicht.
#   3. Plugin-Grundlage: MetaMod:Source und CounterStrikeSharp, dazu die Zeile
#      in `gameinfo.gi`, ohne die MetaMod nie geladen wird.
#   4. Admins aus dem Panel nach CounterStrikeSharp.
#   5. Spielmodus, `gamemodes_server.txt` und `palantir.cfg`.
#   6. Konsole öffnen und den Server starten.
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

# Schalter aus dem Panel kommen als `true`/`false` an (siehe Abschnitt 5).
ist_an() {
  case "${1:-}" in
    true | 1) return 0 ;;
    *) return 1 ;;
  esac
}

# -----------------------------------------------------------------------------
# 1. Serverdateien
#
# Bei jedem Start, wie bei allen SteamCMD-Spielen: Ist alles auf dem Stand,
# kostet es Sekunden; ist es das nicht, kommt das Update, ohne dass jemand ein
# neues Image bauen muss.
#
# **Ausser, der Administrator hält Updates zurück** (Templates-Seite,
# `PALANTIR_UPDATES_HALTEN`). CounterStrikeSharp hängt an den Innereien von
# CS2; nach einem Update von Valve bricht es regelmässig, bis die Grundlage
# nachzieht. Dann lieber einen Tag auf der alten Version spielen als gar nicht.
# Beim allerersten Start wird trotzdem geholt – ohne Dateien gibt es nichts
# zurückzuhalten.
if ist_an "${PALANTIR_UPDATES_HALTEN:-}" && [ -f "$BINAERDATEI" ]; then
  log 'Updates sind zurueckgehalten (Templates-Seite) - SteamCMD bleibt aus.'
  log 'Spieler mit einem neueren Client kommen dann womoeglich nicht auf den Server.'
else
  steam_app_holen "$CS2_ANWENDUNG" "$SERVER"
fi

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
# 3. Plugin-Grundlage
#
# MetaMod:Source lädt Plugins in den Server, CounterStrikeSharp ist das
# Plugin, das C#-Plugins lädt – fast alles, was es für CS2 gibt, baut darauf.
#
# **Die Archive liegen nicht im Image**, wie bei tModLoader: Adresse und
# Prüfsumme setzt das Image, geholt wird beim ersten Start in den internen
# Ordner. Was nicht zur Summe passt, wird verworfen statt ausgepackt.
#
# **Ausgepackt wird nur, wenn sich eine der beiden Fassungen geändert hat**
# (Merkdatei im Addons-Ordner). Sonst bekäme der Betreiber bei jedem Start
# seine Änderungen an `metaplugins.ini` überschrieben, und 120 MB würden
# umsonst geschrieben.
#
# **Abschaltbar** (Feld „Plugins laden"): Nach einem CS2-Update, das MetaMod
# bricht, startet der Server mit Plugins gar nicht. Ohne sie läuft er als
# gewöhnlicher Server weiter – die Dateien bleiben liegen, nur die Zeile in
# `gameinfo.gi` fällt weg.
CSGO="${SERVER}/game/csgo"
ADDONS="${CSGO}/addons"
GAMEINFO="${CSGO}/gameinfo.gi"
METAMOD_ZEILE='			Game	csgo/addons/metamod'
MERKDATEI="${ADDONS}/.palantir-stand"
CSS_CONFIGS="${ADDONS}/counterstrikesharp/configs"

# Schreibt eine Datei ueber eine Zwischenkopie im selben Ordner: Ein Abbruch
# mittendrin liesse sonst eine halbe `gameinfo.gi` zurueck, und CS2 startete
# gar nicht mehr.
ersetze_datei() {
  mv "${1}.palantir" "$1"
}

gameinfo_eintragen() {
  if [ ! -f "$GAMEINFO" ]; then
    log "Hinweis: ${GAMEINFO} fehlt - MetaMod wird nicht geladen."

    return 0
  fi

  if grep -q 'csgo/addons/metamod' "$GAMEINFO"; then
    return 0
  fi

  if ! grep -q 'Game_LowViolence' "$GAMEINFO"; then
    log 'Hinweis: In gameinfo.gi fehlt die Zeile Game_LowViolence - MetaMod wird nicht geladen.'
    log 'Valve hat die Datei vermutlich umgebaut; die Plugin-Grundlage muss nachziehen.'

    return 0
  fi

  # Direkt hinter `Game_LowViolence`, vor `Game csgo`: So beschreibt es
  # MetaMod selbst, und nur an dieser Stelle wird der Ordner vor dem Spiel
  # durchsucht.
  awk -v zeile="$METAMOD_ZEILE" '
    { print }
    /Game_LowViolence/ && !erledigt { print zeile; erledigt = 1 }
  ' "$GAMEINFO" > "${GAMEINFO}.palantir"
  ersetze_datei "$GAMEINFO"
  log 'MetaMod in gameinfo.gi eingetragen.'
}

gameinfo_austragen() {
  if [ -f "$GAMEINFO" ] && grep -q 'csgo/addons/metamod' "$GAMEINFO"; then
    grep -v 'csgo/addons/metamod' "$GAMEINFO" > "${GAMEINFO}.palantir" || true
    ersetze_datei "$GAMEINFO"
    log 'Plugins sind aus - MetaMod aus gameinfo.gi genommen.'
  fi
}

plugin_grundlage_legen() {
  if [ -z "${CS2_METAMOD_URL:-}" ] || [ -z "${CS2_METAMOD_SHA256:-}" ] ||
    [ -z "${CS2_CSS_URL:-}" ] || [ -z "${CS2_CSS_SHA256:-}" ]; then
    log 'Es fehlen Adresse oder Pruefsumme von MetaMod bzw. CounterStrikeSharp. Beides setzt das Image.'

    return 1
  fi

  ablage="${PALANTIR_INTERN}/cs2-plugins"
  mkdir -p "$ablage" "$ADDONS"

  palantir_datei_holen "$CS2_METAMOD_URL" "$CS2_METAMOD_SHA256" "${ablage}/metamod.tar.gz" ||
    return 1
  palantir_datei_holen "$CS2_CSS_URL" "$CS2_CSS_SHA256" "${ablage}/counterstrikesharp.zip" ||
    return 1

  stand="${CS2_METAMOD_SHA256} ${CS2_CSS_SHA256}"

  if [ -f "$MERKDATEI" ] && [ "$(cat "$MERKDATEI")" = "$stand" ]; then
    return 0
  fi

  log "Packe MetaMod ${CS2_METAMOD_VERSION:-} und CounterStrikeSharp ${CS2_CSS_VERSION:-} aus ..."

  # `metaplugins.ini` gehört nach dem ersten Mal dem Betreiber – dort stehen
  # MetaMod-Plugins, die er von Hand dazulegt.
  if [ -f "${ADDONS}/metamod/metaplugins.ini" ]; then
    cp "${ADDONS}/metamod/metaplugins.ini" "${ablage}/metaplugins.ini.betreiber"
  fi

  palantir_tar_auspacken "${ablage}/metamod.tar.gz" "$CSGO" || return 1
  palantir_zip_auspacken "${ablage}/counterstrikesharp.zip" "$CSGO" || return 1

  if [ -f "${ablage}/metaplugins.ini.betreiber" ]; then
    mv "${ablage}/metaplugins.ini.betreiber" "${ADDONS}/metamod/metaplugins.ini"
  fi

  printf '%s\n' "$stand" > "$MERKDATEI"
}

if ist_an "${CS2_PLUGINS:-true}"; then
  if ! plugin_grundlage_legen; then
    log 'Die Plugin-Grundlage fehlt. Wer ohne Plugins spielen will, schaltet "Plugins laden" aus.'
    exit 69
  fi

  # `core.json` einmal aus der Vorlage - danach gehört sie dem Betreiber.
  if [ ! -f "${CSS_CONFIGS}/core.json" ] && [ -f "${CSS_CONFIGS}/core.example.json" ]; then
    cp "${CSS_CONFIGS}/core.example.json" "${CSS_CONFIGS}/core.json"
  fi

  # Bei jedem Start: Ein Update von Valve schreibt `gameinfo.gi` neu und nimmt
  # die Zeile dabei mit.
  gameinfo_eintragen
else
  gameinfo_austragen
fi

# -----------------------------------------------------------------------------
# 4. Admins
#
# SteamID64-Nummern aus dem Panel, getrennt durch Komma, Leerzeichen oder
# Zeilenumbruch. Jede bekommt `@css/root` – volle Rechte über alle Plugins.
#
# **Die Datei gehört dem Panel, sobald das Feld etwas enthält**: Sie wird bei
# jedem Start neu geschrieben. Ist das Feld leer, fasst das Skript sie nicht an
# – wer Admins lieber mit Gruppen und feineren Rechten von Hand pflegt, lässt
# das Feld leer.
#
# Nur gültige SteamID64 (17 Ziffern, beginnend mit 7656119). Etwas anderes
# landet nicht in der Datei: Ein Tippfehler dort würde von CounterStrikeSharp
# still übergangen, hier steht er wenigstens im Log.
if ist_an "${CS2_PLUGINS:-true}" && [ -n "${CS2_ADMINS:-}" ]; then
  mkdir -p "$CSS_CONFIGS"
  eintraege=''

  # Ohne Dateinamen-Erweiterung: Ein `*` im Feld soll nicht den Ordner auflisten.
  set -f
  for kennung in $(printf '%s' "$CS2_ADMINS" | tr ',;' '  '); do
    case "$kennung" in
      7656119[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9])
        if [ -n "$eintraege" ]; then
          eintraege="${eintraege},"
        fi
        eintraege="${eintraege}
  \"palantir-${kennung}\": { \"identity\": \"${kennung}\", \"immunity\": 100, \"flags\": [\"@css/root\"] }"
        ;;
      *)
        log "Keine SteamID64, uebergangen: ${kennung}"
        ;;
    esac
  done
  set +f

  if [ -n "$eintraege" ]; then
    printf '{%s\n}\n' "$eintraege" > "${CSS_CONFIGS}/admins.json"
    log 'Admins aus dem Panel nach CounterStrikeSharp geschrieben.'
  fi
fi

# -----------------------------------------------------------------------------
# 5. Spielmodus
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
# gamemodes_server.txt
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
# palantir.cfg
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
# heisst `mp_match_can_clinch 0`. Übersetzt wird mit `ist_an` von oben.
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
# Startparameter
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
# 6. Konsole und Start
#
# CS2 liest Befehle von der Standardeingabe. Das Rohr legt die Wurzel an;
# `palantir-console` schreibt hinein.
palantir_konsole_oeffnen

log "Startet CS2 (${CS2_GAME_MODE:-competitive}) auf Port ${PORT}"

cd "$SERVER"

exec "$BINAERDATEI" "$@" 0<&3 3>&-
