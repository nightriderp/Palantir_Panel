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
# (Schritt 4), alle Runden spielen (Schritt 5), GOTV (Schritt 5.1),
# Plugin-Grundlage MetaMod + CounterStrikeSharp (Schritt 7, abschaltbar),
# Admins (Schritt 8), einzelne Plugins (ab Schritt 9, `plugins.sh`).
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
#
# **Außer, der Administrator hält Updates zurück** (Schritt 6, Administration >
# Templates, `PALANTIR_UPDATES_HALTEN`). CounterStrikeSharp hängt an den
# Innereien von CS2 und bricht nach einem Update von Valve regelmäßig, bis es
# nachzieht – dann lieber auf der alten Fassung spielen als gar nicht. Beim
# allerersten Start wird trotzdem geholt: Ohne Dateien gibt es nichts
# zurückzuhalten. Nur `true` hält zurück; alles andere holt wie immer.
if [ "${PALANTIR_UPDATES_HALTEN:-}" = true ] && [ -f "$BINAERDATEI" ]; then
  palantir_log 'Updates zurueckgehalten (Administration > Templates) - SteamCMD bleibt aus.'
  palantir_log 'Spieler mit einem neueren CS2 kommen dann womoeglich nicht auf den Server.'
else
  steam_app_holen 730 "$SERVER"
fi

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
# 2b. Plugin-Grundlage (Schritt 7)
#
# MetaMod:Source lädt Plugins in den Server, CounterStrikeSharp ist das
# MetaMod-Plugin, das C#-Plugins lädt – fast alles, was es für CS2 gibt, baut
# darauf. **Hinter einem Schalter** (`CS2_PLUGINS`, Vorgabe aus): Nach einem
# CS2-Update, das MetaMod bricht, startet der Server mit Plugins gar nicht;
# ohne läuft er als gewöhnlicher Server weiter. Die Dateien bleiben liegen,
# nur die Zeile in `gameinfo.gi` fällt weg.
#
# **Geholt in den internen Ordner**, geprüft gegen die Summe aus dem Image;
# was nicht passt, wird verworfen. **Ausgepackt nur bei neuer Fassung**
# (Merkdatei) – sonst überschriebe jeder Start `metaplugins.ini` und
# `core.json`, die danach dem Betreiber gehören.
#
# Ausgepackt wird MetaMod mit `tar` selbst: `palantir_tar_auspacken` kam erst
# mit Basis-Linux 3, dieses Image steht auf `base-steam:6` über Linux 2.
CSGO="${SERVER}/game/csgo"
ADDONS="${CSGO}/addons"
GAMEINFO="${CSGO}/gameinfo.gi"
MERKDATEI="${ADDONS}/.palantir-grundlage"

case "${CS2_PLUGINS:-false}" in
  true) PLUGINS=1 ;;
  false) PLUGINS=0 ;;
  *)
    palantir_log "Ungueltiger Wert fuer die Plugins: ${CS2_PLUGINS}."
    exit 78
    ;;
esac

# Spielmodus-Plugin (Auswahl im Panel, Fundpunkt 361): keins, MatchZy oder
# Retakes – nie zwei. Etwas anderes ist ein Fehler, kein stilles „keins".
case "${CS2_MODE_PLUGIN:-none}" in
  none | matchzy | retakes) ;;
  *)
    palantir_log "Unbekanntes Spielmodus-Plugin: ${CS2_MODE_PLUGIN}."
    exit 78
    ;;
esac

# Schreibt über eine Zwischenkopie im selben Ordner: Ein Abbruch mittendrin
# ließe sonst eine halbe `gameinfo.gi` zurück, und CS2 startete gar nicht mehr.
gameinfo_ersetzen() {
  mv "${GAMEINFO}.palantir" "$GAMEINFO"
}

# Direkt hinter `Game_LowViolence`, vor `Game csgo` – so beschreibt es MetaMod,
# und nur dort wird der Ordner vor dem Spiel durchsucht. Bei jedem Start: Ein
# Update von Valve schreibt `gameinfo.gi` neu und nimmt die Zeile mit.
gameinfo_eintragen() {
  if [ ! -f "$GAMEINFO" ]; then
    palantir_log "Hinweis: ${GAMEINFO} fehlt - MetaMod wird nicht geladen."
    return 0
  fi

  if grep -q 'csgo/addons/metamod' "$GAMEINFO"; then
    return 0
  fi

  if ! grep -q 'Game_LowViolence' "$GAMEINFO"; then
    palantir_log 'Hinweis: In gameinfo.gi fehlt Game_LowViolence - MetaMod wird nicht geladen.'
    return 0
  fi

  awk '
    { print }
    /Game_LowViolence/ && !erledigt { print "\t\t\tGame\tcsgo/addons/metamod"; erledigt = 1 }
  ' "$GAMEINFO" > "${GAMEINFO}.palantir"
  gameinfo_ersetzen
  palantir_log 'MetaMod in gameinfo.gi eingetragen.'
}

gameinfo_austragen() {
  if [ -f "$GAMEINFO" ] && grep -q 'csgo/addons/metamod' "$GAMEINFO"; then
    grep -v 'csgo/addons/metamod' "$GAMEINFO" > "${GAMEINFO}.palantir" || true
    gameinfo_ersetzen
    palantir_log 'Plugins aus - MetaMod aus gameinfo.gi genommen.'
  fi
}

grundlage_legen() {
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

  palantir_log "Packe MetaMod ${CS2_METAMOD_VERSION:-} und CounterStrikeSharp ${CS2_CSS_VERSION:-} aus ..."

  # `metaplugins.ini` gehört nach dem ersten Mal dem Betreiber.
  if [ -f "${ADDONS}/metamod/metaplugins.ini" ]; then
    cp "${ADDONS}/metamod/metaplugins.ini" "${ablage}/metaplugins.ini.betreiber"
  fi

  # MetaMod bei einem Fassungswechsel erst wegräumen: Ein älterer Build über
  # einem neueren ließe dessen zusätzliche Dateien liegen (git1469 → git1411,
  # 19 MB über 6,9 MB). `metaplugins.ini` ist oben gesichert; eigene
  # MetaMod-Plugins liegen in eigenen Ordnern unter `addons/`.
  rm -rf "${ADDONS}/metamod" "${ADDONS}/metamod.vdf" "${ADDONS}/metamod_x64.vdf"

  if ! tar -xzf "${ablage}/metamod.tar.gz" -C "$CSGO"; then
    palantir_log 'Das MetaMod-Archiv liess sich nicht auspacken.'
    return 1
  fi
  palantir_zip_auspacken "${ablage}/counterstrikesharp.zip" "$CSGO" || return 1

  if [ -f "${ablage}/metaplugins.ini.betreiber" ]; then
    mv "${ablage}/metaplugins.ini.betreiber" "${ADDONS}/metamod/metaplugins.ini"
  fi

  printf '%s\n' "$stand" > "$MERKDATEI"
}

# **Admins** (Schritt 8): SteamID64-Nummern aus dem Panel, getrennt durch
# Komma, Semikolon, Leerzeichen oder Zeilenumbruch. Jede bekommt `@css/root` –
# volle Rechte über CounterStrikeSharp und seine Plugins.
#
# **Die Datei gehört dem Panel, sobald das Feld etwas enthält**: Sie wird bei
# jedem Start neu geschrieben. Ist das Feld leer, bleibt sie unangetastet – wer
# Admins mit Gruppen und feineren Rechten von Hand pflegt, lässt es leer.
#
# **Nur gültige SteamID64** (17 Ziffern, beginnend mit 7656119). Etwas anderes
# bricht den Start ab: CounterStrikeSharp überginge einen Tippfehler still, und
# der Betreiber hielte sich für Admin, ohne es zu sein. Durch die Prüfung kann
# auch nichts anderes als Ziffern in die JSON-Datei gelangen.
admins_schreiben() {
  if [ -z "${CS2_ADMINS:-}" ]; then
    return 0
  fi

  admins_eintraege=''

  # Ohne Dateinamen-Erweiterung: Ein `*` im Feld soll nicht den Ordner auflisten.
  set -f
  for kennung in $(printf '%s' "$CS2_ADMINS" | tr ',;' '  '); do
    case "$kennung" in
      7656119[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;;
      *)
        set +f
        palantir_log "Keine gueltige SteamID64 bei den Admins: ${kennung} (17 Ziffern, beginnt mit 7656119)."
        exit 78
        ;;
    esac

    if [ -n "$admins_eintraege" ]; then
      admins_eintraege="${admins_eintraege},"
    fi
    admins_eintraege="${admins_eintraege}
  \"palantir-${kennung}\": { \"identity\": \"${kennung}\", \"immunity\": 100, \"flags\": [\"@css/root\"] }"
  done
  set +f

  if [ -z "$admins_eintraege" ]; then
    return 0
  fi

  mkdir -p "$CSS_CONFIGS"
  printf '{%s\n}\n' "$admins_eintraege" > "${CSS_CONFIGS}/admins.json"
  palantir_log 'Admins aus dem Panel nach CounterStrikeSharp geschrieben.'
}

if [ "$PLUGINS" = 1 ]; then
  if [ -z "${CS2_METAMOD_URL:-}" ] || [ -z "${CS2_METAMOD_SHA256:-}" ] ||
    [ -z "${CS2_CSS_URL:-}" ] || [ -z "${CS2_CSS_SHA256:-}" ]; then
    palantir_log 'Adresse oder Pruefsumme von MetaMod bzw. CounterStrikeSharp fehlt - das setzt das Image.'
    exit 69
  fi

  if ! grundlage_legen; then
    palantir_log 'Die Plugin-Grundlage fehlt. Wer ohne Plugins spielen will, schaltet sie in den Einstellungen aus.'
    exit 69
  fi

  # **Gamedata-Nachtrag** (24.09.2026). Das CS2-Update 1.41.8.2 (23.09.) hat
  # Offsets und Signaturen verschoben, auf die CounterStrikeSharp v1.0.374
  # zeigt – Retakes stürzte beim ersten Teamwechsel ab (`ChangeTeam` liegt
  # jetzt bei 104 statt 102). Die Korrektur steht auf CounterStrikeSharp
  # `main` (2f984988), eine Fassung gibt es noch nicht. `cs2-gamedata.json` ist
  # jene Datei plus der Eintrag `CheckTransmit`, den `main` entfernt hat,
  # v1.0.374 aber noch braucht. Bei jedem Start, weil ein Auspacken der
  # Grundlage die Datei zurücksetzt. Weg damit, sobald eine CounterStrikeSharp-
  # Fassung mit passenden Gamedata im Image steht.
  GAMEDATA_NACHTRAG="${CS2_SKRIPTE:-/opt/palantir}/cs2-gamedata.json"
  if [ -f "$GAMEDATA_NACHTRAG" ] && [ -d "${ADDONS}/counterstrikesharp/gamedata" ]; then
    cp "$GAMEDATA_NACHTRAG" "${ADDONS}/counterstrikesharp/gamedata/gamedata.json"
    palantir_log 'Gamedata fuer CS2 1.41.8 eingespielt (CounterStrikeSharp main 2f984988).'
  fi

  # `core.json` einmal aus der Vorlage – danach gehört sie dem Betreiber.
  CSS_CONFIGS="${ADDONS}/counterstrikesharp/configs"
  if [ ! -f "${CSS_CONFIGS}/core.json" ] && [ -f "${CSS_CONFIGS}/core.example.json" ]; then
    cp "${CSS_CONFIGS}/core.example.json" "${CSS_CONFIGS}/core.json"
  fi

  gameinfo_eintragen
  admins_schreiben

  # Die einzelnen Plugins (ab Schritt 9). Scheitert eines, startet der Server
  # nicht: Einer, der ohne das gewünschte Admin-Plugin hochkommt, ist schlimmer
  # als einer, der sagt, was fehlt.
  . "${CS2_SKRIPTE:-/opt/palantir}/plugins.sh"

  if ! plugins_abgleichen; then
    palantir_log 'Ein Plugin fehlt. Ausschalten oder neu starten - der Download wird dann wiederholt.'
    exit 69
  fi
else
  gameinfo_austragen
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
  # Custom (Betreiber 25.09.2026): Valves leerer Modus ohne eigene Regeln –
  # gut für Training, weil keine Modus-Konfiguration dazwischenfunkt.
  custom) SPIEL_TYP=3; SPIEL_MODUS=0 ;;
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

# **Training** (Betreiber 25.09.2026): Schalter für Übungsserver. Nur `true`
# schaltet ein; alles andere außer `false` ist ein Fehler.
schalter() {
  case "$2" in
    true) printf '1' ;;
    false | '') printf '0' ;;
    *)
      palantir_log "Ungueltiger Wert fuer ${1}: ${2}."
      exit 78
      ;;
  esac
}
MUNITION="$(schalter 'Unendlich Munition' "${CS2_INFINITE_AMMO:-false}")" || exit 78
GRANATEN="$(schalter 'Alle Granaten' "${CS2_ALL_GRENADES:-false}")" || exit 78
ENDLOS="$(schalter 'Endlos-Runde' "${CS2_ENDLESS_ROUND:-false}")" || exit 78
GRANATEN_KAMERA="$(schalter 'Granaten-Kamera' "${CS2_GRENADE_CAM:-false}")" || exit 78
KAUFEN="$(schalter 'Ueberall kaufen' "${CS2_BUY_ANYWHERE:-false}")" || exit 78
OHNE_AUFWAERMEN="$(schalter 'Aufwaermphase ueberspringen' "${CS2_SKIP_WARMUP:-false}")" || exit 78
OHNE_STANDZEIT="$(schalter 'Keine Standzeit' "${CS2_NO_FREEZETIME:-false}")" || exit 78
SOFORT_SPAWNEN="$(schalter 'Sofort spawnen' "${CS2_INSTANT_RESPAWN:-false}")" || exit 78
UEBUNG="$(schalter 'Uebungs-Einstellungen' "${CS2_PRACTICE:-false}")" || exit 78
NUR_CT="$(schalter 'Nur CT' "${CS2_CT_ONLY:-false}")" || exit 78

# **GOTV** (Schritt 5.1): der Zuschauerzugang, eigener UDP-Port aus dem Pool –
# drinnen dieselbe Nummer wie draußen (`CS2_TV_PORT`), aus demselben Grund wie
# beim Spielport. `tv_enable` muss vor dem ersten Kartenladen stehen, deshalb
# als Startparameter vor `+map`.
case "${CS2_GOTV:-false}" in
  true) GOTV=1 ;;
  false) GOTV=0 ;;
  *)
    palantir_log "Ungueltiger Wert fuer GOTV: ${CS2_GOTV}."
    exit 78
    ;;
esac

TV_PORT="${CS2_TV_PORT:-27020}"
case "$TV_PORT" in
  '' | *[!0-9]*)
    palantir_log "Ungueltiger GOTV-Port: ${TV_PORT}."
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
  # Zuschauer brauchen dasselbe Passwort wie Spieler – sonst sähe über GOTV
  # jeder mit der Adresse einem geschlossenen Server zu.
  printf 'tv_password "%s"\n' "$(sauber "${CS2_PASSWORD:-}")"
  # `normal` heißt: genau so viele Bots, nicht „auffüllen bis".
  printf 'bot_quota_mode "normal"\n'
  printf 'bot_quota %s\n' "$BOTS"
  printf 'mp_match_can_clinch %s\n' "$CLINCH"

  # Training. Unendlich Munition und Granaten-Kamera sind in CS2
  # cheat-geschützt – ohne `sv_cheats 1` wiese der Server sie ab. Ausgeschaltetes
  # schreibt nichts: Dann gelten die Werte der Modus-Konfiguration.
  # Die Übungs-Einstellungen brauchen es auch (Regeneration, Puppen-Bots).
  if [ "$MUNITION" = 1 ] || [ "$GRANATEN_KAMERA" = 1 ] || [ "$UEBUNG" = 1 ]; then
    printf 'sv_cheats 1\n'
  else
    printf 'sv_cheats 0\n'
  fi
  [ "$MUNITION" = 1 ] && printf 'sv_infinite_ammo 1\n'
  [ "$GRANATEN_KAMERA" = 1 ] && printf 'sv_grenade_trajectory_prac_pipreview 1\n'
  if [ "$GRANATEN" = 1 ]; then
    printf 'ammo_grenade_limit_total 5\n'
    printf 'mp_ct_default_grenades "weapon_smokegrenade weapon_flashbang weapon_hegrenade weapon_incgrenade weapon_decoy"\n'
    printf 'mp_t_default_grenades "weapon_smokegrenade weapon_flashbang weapon_hegrenade weapon_molotov weapon_decoy"\n'
  fi
  if [ "$ENDLOS" = 1 ]; then
    printf 'mp_roundtime 60\nmp_roundtime_defuse 60\nmp_roundtime_hostage 60\n'
    printf 'mp_ignore_round_win_conditions 1\n'
  fi
  # Übung (Betreiber 25.09.2026): keine Aufwärmphase, keine Standzeit, sofort
  # spawnen – auch wer nach Rundenstart ein Team wählt, statt bis Rundenende
  # zuzuschauen. Aus schreibt nichts: Dann gilt, was der Modus mitbringt.
  # Aufwärmphase (25.09.2026): Sie beginnt erst, wenn der erste Spieler
  # verbindet – nach dieser Datei; ein `mp_warmup_end` hier liefe ins Leere,
  # und `mp_warmup_online_enabled 0` fror eine schon laufende bei 2:00 ein.
  # Stattdessen die kürzeste Aufwärmzeit, die CS2 zulässt (5 s). „Alle
  # verbunden“ (`mp_endwarmup_player_count 1`) kürzte zwar, schrieb aber jede
  # Sekunde „Das Spiel beginnt in 1 Sekunden“ in den Chat (v2.4.41).
  if [ "$OHNE_AUFWAERMEN" = 1 ]; then
    printf 'mp_warmup_pausetimer 0\nmp_warmuptime 5\n'
  fi
  [ "$OHNE_STANDZEIT" = 1 ] && printf 'mp_freezetime 0\n'
  if [ "$SOFORT_SPAWNEN" = 1 ]; then
    printf 'mp_respawn_on_death_ct 1\nmp_respawn_on_death_t 1\n'
    printf 'mp_respawnwavetime_ct 0\nmp_respawnwavetime_t 0\n'
  fi
  if [ "$KAUFEN" = 1 ]; then
    printf 'mp_buy_anywhere 1\nmp_buytime 9999\n'
    printf 'mp_maxmoney 60000\nmp_startmoney 60000\nmp_afterroundmoney 60000\n'
  fi
  [ "$UEBUNG" = 1 ] && printf 'exec palantir_uebung_an\n'
  # Nur CT wie die Utility-Map: gesperrt auf CT und nach 1 s zugeteilt – ohne
  # `mp_force_pick_time` kam trotzdem 15 s das Teammenü (v2.4.41).
  [ "$NUR_CT" = 1 ] && printf 'mp_humanteam ct\nmp_force_pick_time 1\n'
  # Kein Ruhezustand bei leerem Server (24.09.2026): Schlafend beantwortete
  # CS2 Konsolenbefehle aus dem Panel nicht – `mp_match_can_clinch` blieb
  # ohne Antwort, bis ein Spieler den Server weckte. Kostet etwas CPU im
  # Leerlauf.
  printf 'sv_hibernate_when_empty 0\n'
} > "${CFG_ORDNER}/palantir.cfg"

# **Übungs-Einstellungen** (Betreiber 25.09.2026): die Befehle der Workshop-Map
# „Dust 2 Utility“, nicht deren Map-Daten. Eigene Dateien, weil das Panel sie
# live mit `exec` schaltet – als Konsolenzeile wären sie zu lang.
#
# `…_aus` setzt nur zurück, was kein Modus selbst setzt (Valves Grundwerte aus
# der Cvar-Liste). Rüstung, Waffe beim Tod, Bot-Funk, Teamgrenzen, Zeitlimit
# usw. bringt die Modus-Konfiguration beim nächsten Kartenwechsel zurück – ein
# fester Wert hier nagelte sonst z. B. Deathmatch fest.
{
  echo '// Schreibt Palantir bei jedem Start - Uebungs-Einstellungen an.'
  printf '%s\n' \
    'sv_cheats 1' \
    'mp_timelimit 0' 'mp_match_end_changelevel 0' \
    'sv_regeneration_force_on 1' 'sv_falldamage_scale 0' \
    'mp_respawn_immunitytime 0' 'mp_free_armor 1' 'mp_death_drop_gun 0' \
    'mp_weapons_allow_map_placed 0' 'mp_solid_teammates 0' \
    'mp_limitteams 0' 'mp_autoteambalance 0' 'mp_playercashawards 0' \
    'mp_radar_showall 1' 'sv_disable_radar 1' \
    'sv_grenade_trajectory_prac_trailtime 8' \
    'player_ping_token_cooldown 0' 'sv_radio_throttle_window 0' \
    'sv_staminajumpcost 0' 'sv_staminalandcost 0' 'sv_staminamax 0' \
    'sv_staminarecoveryrate 0' \
    'sv_enablebunnyhopping 1' 'sv_autobunnyhopping 1' \
    'sv_jump_spam_penalty_time 0' \
    'bot_stop 1' 'bot_zombie 1' 'bot_dont_shoot 1' 'bot_chatter off'
} > "${CFG_ORDNER}/palantir_uebung_an.cfg"
{
  echo '// Schreibt Palantir bei jedem Start - Uebungs-Einstellungen aus.'
  printf '%s\n' \
    'sv_regeneration_force_on 0' 'sv_falldamage_scale 1' \
    'mp_autoteambalance 1' 'mp_radar_showall 0' 'sv_disable_radar 0' \
    'sv_grenade_trajectory_prac_trailtime 0' \
    'player_ping_token_cooldown 20' 'sv_radio_throttle_window 10' \
    'sv_staminajumpcost 0.08' 'sv_staminalandcost 0.05' 'sv_staminamax 80' \
    'sv_staminarecoveryrate 60' \
    'sv_enablebunnyhopping 0' 'sv_autobunnyhopping 0' \
    'sv_jump_spam_penalty_time 0.015625' \
    'bot_stop 0' 'bot_zombie 0' 'bot_dont_shoot 0'
} > "${CFG_ORDNER}/palantir_uebung_aus.cfg"

# **Nach der Modus-Konfiguration noch einmal** (Schritt 3). Beim Laden jeder
# Karte führt CS2 `gamemode_<modus>.cfg` aus, und die setzt unter anderem die
# Bot-Anzahl – unsere Werte vom Start wären danach überschrieben. Direkt
# danach sucht CS2 `gamemode_<modus>_server.cfg`, die dafür vorgesehene Stelle
# für eigene Einstellungen; dort steht nur `exec palantir`. Für alle Modi, damit
# kein Dateiname falsch geraten sein kann.
for modus in competitive casual competitive2v2 deathmatch armsrace custom; do
  printf '%s\n' '// Schreibt Palantir - fuehrt palantir.cfg nach der Modus-Konfiguration aus.' \
    'exec palantir' 'exec palantir_live' > "${CFG_ORDNER}/gamemode_${modus}_server.cfg"
done

# **Steuerung** (Schritt 3.2/3.3). Was im Panel bei laufendem Server
# umgestellt wird, schreibt das Backend in `palantir_live.cfg` – und in die
# Einstellungen, aus denen dieser Start schon `palantir.cfg` gebaut hat. Die
# Datei wird deshalb geleert.
printf '%s\n' '// Schreibt das Panel bei Live-Aenderungen; beim Start geleert.' \
  > "${CFG_ORDNER}/palantir_live.cfg"

# **Bots aus dem Panel, auch mit Spielmodus-Plugin** (Betreiber 25.09.2026).
# MatchZy und Retakes führen nach dem Kartenladen eigene Konfigurationen aus –
# mit `bot_kick` und `bot_quota 0`, also nach unserer. Ans Ende dieser Dateien
# kommt deshalb ein markierter Block, der unsere Bots danach wieder setzt:
# `palantir_bots` (Startwert aus den Einstellungen) und `palantir_live` (was in
# der Steuerung umgestellt wurde). Bei jedem Start neu geschrieben, nie doppelt.
{
  echo '// Schreibt Palantir bei jedem Start neu - Bots aus dem Panel.'
  printf 'bot_quota_mode "normal"\n'
  printf 'bot_quota %s\n' "$BOTS"
} > "${CFG_ORDNER}/palantir_bots.cfg"

BOTS_BLOCK_ANFANG='// >>> Palantir: Bots aus dem Panel (bei jedem Start neu geschrieben)'
BOTS_BLOCK_ENDE='// <<< Palantir'

bots_block_setzen() {
  [ -f "$1" ] || return 1

  # Alten Block weg, neuen ans Ende – über eine Zwischendatei, damit ein
  # Abbruch keine halbe Konfiguration des Plugins hinterlässt.
  awk -v anfang="$BOTS_BLOCK_ANFANG" -v ende="$BOTS_BLOCK_ENDE" '
    $0 == anfang { im_block = 1; next }
    im_block && $0 == ende { im_block = 0; next }
    !im_block { print }
  ' "$1" > "${1}.palantir"
  printf '%s\n' "$BOTS_BLOCK_ANFANG" 'exec palantir_bots' 'exec palantir_live' \
    "$BOTS_BLOCK_ENDE" >> "${1}.palantir"
  mv "${1}.palantir" "$1"
}

if [ "$PLUGINS" = 1 ]; then
  # **Für alle Spielmodus-Plugins, nicht nur das gewählte** (25.09.2026): Seit
  # Plugins im laufenden Betrieb umschalten, kann MatchZy oder Retakes später
  # dazukommen – ihre Dateien brauchen den Block dann schon.
  #
  # MatchZy: Warmup hat keine Override-Datei; Live schon – dort gehört es hin.
  for datei in warmup.cfg live_override.cfg live_wingman_override.cfg; do
    bots_block_setzen "${CFG_ORDNER}/MatchZy/${datei}" || true
  done

  # Retakes legt `retakes.cfg` erst beim ersten eigenen Kartenstart an – und
  # führt sie sofort aus. Fehlt sie, legt das Image sie mit Retakes' eigener
  # Vorgabe an (`retakes-vorgabe.cfg`, aus 3.1.1); Retakes nimmt dann diese.
  RETAKES_CFG="${CFG_ORDNER}/cs2-retakes/retakes.cfg"
  RETAKES_VORGABE="${CS2_SKRIPTE:-/opt/palantir}/retakes-vorgabe.cfg"
  if [ ! -f "$RETAKES_CFG" ] && [ -f "$RETAKES_VORGABE" ]; then
    mkdir -p "${CFG_ORDNER}/cs2-retakes"
    cp "$RETAKES_VORGABE" "$RETAKES_CFG"
  fi
  bots_block_setzen "$RETAKES_CFG" || true
fi

set -- -dedicated -port "$PORT" +game_type "$SPIEL_TYP" +game_mode "$SPIEL_MODUS"

# Die Spieleranzahl ist ein Startparameter, kein Konsolenbefehl.
if [ -n "${CS2_MAX_PLAYERS:-}" ]; then
  set -- "$@" -maxplayers "$CS2_MAX_PLAYERS"
fi

if [ "$GOTV" = 1 ]; then
  set -- "$@" +tv_port "$TV_PORT" +tv_enable 1
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

# **Zeilenweise schreiben** (24.09.2026). In ein Rohr statt in ein Terminal
# puffert CS2 seine Ausgabe blockweise: Antworten auf Konsolenbefehle aus dem
# Panel kamen erst, wenn genug anderes nachdrängte – im Docker-Log standen 25
# Zeilen mit demselben Zeitstempel, danach minutenlang nichts. `stdbuf` stellt
# die Ausgabe auf Zeilenpuffer und ersetzt sich per `exec` durch CS2; die
# Prozessnummer bleibt die von CS2, das Stoppsignal kommt weiter an.
if command -v stdbuf > /dev/null 2>&1; then
  set -- stdbuf -oL -eL "$BINAERDATEI" "$@"
else
  palantir_log 'Hinweis: stdbuf fehlt - Antworten auf Konsolenbefehle kommen verzoegert.'
  set -- "$BINAERDATEI" "$@"
fi

# **Eigener Temp-Ordner** (24.09.2026). `/tmp` ist im Container ein tmpfs ohne
# Ausführrecht (Härtung). .NET packt dort native Bibliotheken aus und lädt sie –
# SimpleAdmin scheiterte daran („SQLite.Interop.dll: failed to map segment"),
# Banns und Mutes wurden nicht gespeichert. Der interne Ordner liegt im
# Datenordner, aus dem CS2 ohnehin ausgeführt wird.
TMPDIR="${PALANTIR_INTERN}/tmp"
mkdir -p "$TMPDIR"
export TMPDIR

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
  "$@" 0<&3 3>&- > "$AUSGABE" 2>&1 &
  SERVER_PID=$!
else
  "$@" 0<&3 3>&- &
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
