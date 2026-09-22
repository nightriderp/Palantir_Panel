#!/bin/sh
#
# Plugins des CS2-Images (Betreiber-Wunsch 22.09.2026).
#
# Wird von `start.sh` eingebunden, nicht ausgeführt – und erst, nachdem die
# Plugin-Grundlage (MetaMod, CounterStrikeSharp) liegt. Erwartet von dort:
# `CSGO`, `ADDONS`, `CSS_CONFIGS`, `ist_an` und `log`.
#
# Welche Plugins es gibt, steht in `plugins.list` neben diesem Skript; hier
# steht nur, wie eines ein- und ausgeschaltet wird.

CSS="${ADDONS}/counterstrikesharp"
CSS_PLUGINS="${CSS}/plugins"
PLUGIN_ABLAGE="${PALANTIR_INTERN}/cs2-plugins"

# -----------------------------------------------------------------------------
# Einschalten
# -----------------------------------------------------------------------------
# `plugin_an <name> <adresse> <summe> <zuordnung> <ordner>`
#
# Holt das Archiv (einmal, geprüft), packt es aber nur aus, wenn sich die
# Summe seit dem letzten Mal geändert hat – Merkdatei je Plugin. Sonst bekäme
# der Betreiber bei jedem Start zum Beispiel die Kartenliste von RockTheVote
# überschrieben, die im Plugin-Ordner liegt.
#
# Ein abgeschaltetes Plugin liegt unter `plugins/disabled` und wird zuerst
# zurückgeholt; seine Dateien sind dieselben wie vorher.
plugin_an() {
  p_name="$1"
  p_adresse="$2"
  p_summe="$3"
  p_zuordnung="$4"
  p_ordner="$5"

  plugin_zurueckholen "$p_name" "$p_ordner"

  case "$p_adresse" in
    *.tar.gz) p_archiv="${PLUGIN_ABLAGE}/${p_name}.tar.gz" ;;
    *) p_archiv="${PLUGIN_ABLAGE}/${p_name}.zip" ;;
  esac

  mkdir -p "$PLUGIN_ABLAGE" "$CSS"
  palantir_datei_holen "$p_adresse" "$p_summe" "$p_archiv" || return 1

  p_merk="${CSS}/.palantir-plugin-${p_name}"

  if [ -f "$p_merk" ] && [ "$(cat "$p_merk")" = "$p_summe" ]; then
    return 0
  fi

  p_bau="${PLUGIN_ABLAGE}/auspacken-${p_name}"
  rm -rf "$p_bau"

  case "$p_archiv" in
    *.tar.gz) palantir_tar_auspacken "$p_archiv" "$p_bau" || return 1 ;;
    *) palantir_zip_auspacken "$p_archiv" "$p_bau" || return 1 ;;
  esac

  # Zuordnungen `quelle=ziel`, durch Komma getrennt. Jede Quelle muss es geben –
  # sonst ist das Archiv anders gepackt als beim Eintragen, und ein halb
  # verteiltes Plugin wäre schwerer zu finden als ein fehlendes.
  p_alt_ifs="$IFS"
  IFS=','
  for p_paar in $p_zuordnung; do
    IFS="$p_alt_ifs"
    p_quelle="${p_paar%%=*}"
    p_ziel="${p_paar#*=}"

    if [ ! -e "${p_bau}/${p_quelle}" ]; then
      log "Im Archiv von ${p_name} fehlt ${p_quelle} - anders gepackt als erwartet."
      rm -rf "$p_bau"

      return 1
    fi

    mkdir -p "${CSGO}/${p_ziel}"
    cp -a "${p_bau}/${p_quelle}/." "${CSGO}/${p_ziel}/"
  done
  IFS="$p_alt_ifs"

  rm -rf "$p_bau"
  printf '%s\n' "$p_summe" > "$p_merk"
  log "Plugin ${p_name} ausgepackt."
}

# -----------------------------------------------------------------------------
# Ausschalten
# -----------------------------------------------------------------------------
# `plugin_aus <name> <ordner>`
#
# Verschiebt die Plugin-Ordner nach `plugins/disabled` – CounterStrikeSharp
# lädt dort nichts. Gelöscht wird nichts: Einstellungen und eigene Dateien im
# Plugin-Ordner sind beim Wiedereinschalten noch da.
#
# Fake RCON ist ein MetaMod-Plugin; MetaMod lädt jede `.vdf` in
# `addons/metamod`. Abgeschaltet wird es, indem seine Datei dort weggeht.
plugin_aus() {
  p_name="$1"
  p_ordner="$2"

  if [ "$p_name" = 'fakercon' ]; then
    if [ -f "${ADDONS}/metamod/fake_rcon.vdf" ]; then
      mkdir -p "${ADDONS}/fake_rcon"
      mv "${ADDONS}/metamod/fake_rcon.vdf" "${ADDONS}/fake_rcon/fake_rcon.vdf.aus"
      log 'Plugin fakercon abgeschaltet.'
    fi

    return 0
  fi

  [ "$p_ordner" = '-' ] && return 0

  p_alt_ifs="$IFS"
  IFS=','
  for p_eins in $p_ordner; do
    IFS="$p_alt_ifs"

    if [ -d "${CSS_PLUGINS}/${p_eins}" ]; then
      mkdir -p "${CSS_PLUGINS}/disabled"
      rm -rf "${CSS_PLUGINS}/disabled/${p_eins}"
      mv "${CSS_PLUGINS}/${p_eins}" "${CSS_PLUGINS}/disabled/${p_eins}"
      log "Plugin ${p_eins} abgeschaltet."
    fi
  done
  IFS="$p_alt_ifs"
}

plugin_zurueckholen() {
  p_name="$1"
  p_ordner="$2"

  if [ "$p_name" = 'fakercon' ]; then
    if [ -f "${ADDONS}/fake_rcon/fake_rcon.vdf.aus" ]; then
      mv "${ADDONS}/fake_rcon/fake_rcon.vdf.aus" "${ADDONS}/metamod/fake_rcon.vdf"
    fi

    return 0
  fi

  [ "$p_ordner" = '-' ] && return 0

  p_alt_ifs="$IFS"
  IFS=','
  for p_eins in $p_ordner; do
    IFS="$p_alt_ifs"

    if [ -d "${CSS_PLUGINS}/disabled/${p_eins}" ] && [ ! -e "${CSS_PLUGINS}/${p_eins}" ]; then
      mv "${CSS_PLUGINS}/disabled/${p_eins}" "${CSS_PLUGINS}/${p_eins}"
    fi
  done
  IFS="$p_alt_ifs"
}

# -----------------------------------------------------------------------------
# Welche Plugins an sind
# -----------------------------------------------------------------------------
# Aus den Schaltern des Panels, plus die Abhängigkeiten. Die Abhängigkeiten
# stehen hier und nicht als eigene Schalter: Wer WeaponPaints einschaltet, will
# nicht wissen müssen, dass es MenuManager braucht, das PlayerSettings braucht,
# das AnyBaseLib braucht.
plugins_gewuenscht() {
  gewuenscht=''

  ist_an "${CS2_PLUGIN_MATCHZY:-}" && gewuenscht="${gewuenscht} matchzy"
  ist_an "${CS2_PLUGIN_SIMPLEADMIN:-}" && gewuenscht="${gewuenscht} simpleadmin"
  ist_an "${CS2_PLUGIN_WEAPONPAINTS:-}" && gewuenscht="${gewuenscht} weaponpaints"
  ist_an "${CS2_PLUGIN_ROCKTHEVOTE:-}" && gewuenscht="${gewuenscht} rockthevote"
  ist_an "${CS2_PLUGIN_RETAKES:-}" && gewuenscht="${gewuenscht} retakes"
  ist_an "${CS2_PLUGIN_SHARPTIMER:-}" && gewuenscht="${gewuenscht} sharptimer"
  ist_an "${CS2_PLUGIN_FAKERCON:-}" && gewuenscht="${gewuenscht} fakercon"

  if ist_an "${CS2_PLUGIN_SIMPLEADMIN:-}" || ist_an "${CS2_PLUGIN_WEAPONPAINTS:-}"; then
    gewuenscht="${gewuenscht} anybaselib playersettings menumanager"
  fi

  if ist_an "${CS2_PLUGIN_SHARPTIMER:-}"; then
    gewuenscht="${gewuenscht} tags"
  fi

  printf '%s\n' "$gewuenscht"
}

enthalten() {
  case " $2 " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

# `plugins_abgleichen` – schaltet jedes Plugin aus der Liste ein oder aus.
plugins_abgleichen() {
  liste="${PALANTIR_CS2_PLUGINLISTE:-${CS2_SKRIPTE}/plugins.list}"

  if [ ! -f "$liste" ]; then
    log "Die Plugin-Liste fehlt: ${liste}"

    return 1
  fi

  gewuenscht="$(plugins_gewuenscht)"

  # MatchZy und Retakes wollen beide den Ablauf einer Runde bestimmen.
  if enthalten matchzy "$gewuenscht" && enthalten retakes "$gewuenscht"; then
    log 'Hinweis: MatchZy und Retakes gleichzeitig - beide steuern die Runden und stoeren sich.'
  fi

  fehler=0

  # `read` aus einer Datei, nicht aus einer Pipe: In einer Pipe liefe die
  # Schleife in einer Nebenshell, und `fehler` wäre danach wieder 0.
  while read -r l_name l_version l_adresse l_summe l_zuordnung l_ordner; do
    case "$l_name" in
      '' | '#'*) continue ;;
    esac

    if enthalten "$l_name" "$gewuenscht"; then
      if ! plugin_an "$l_name" "$l_adresse" "$l_summe" "$l_zuordnung" "$l_ordner"; then
        log "Plugin ${l_name} ${l_version} liess sich nicht einrichten."
        fehler=1
      fi
    else
      plugin_aus "$l_name" "$l_ordner"
    fi
  done < "$liste"

  return "$fehler"
}

# -----------------------------------------------------------------------------
# JSON-Einstellungen
# -----------------------------------------------------------------------------
# `json_setzen <datei> <jq-ausdruck> [jq-argumente ...]`
#
# Über eine Zwischenkopie: Ein Abbruch mittendrin hinterliesse sonst eine leere
# Datei, und CounterStrikeSharp legte beim nächsten Laden eine frische mit
# Vorgaben an – die eigenen Einstellungen des Betreibers wären weg.
json_setzen() {
  j_datei="$1"
  shift

  if ! jq "$@" "$j_datei" > "${j_datei}.palantir"; then
    rm -f "${j_datei}.palantir"
    log "Konnte ${j_datei} nicht anpassen - ist es gueltiges JSON?"

    return 1
  fi

  mv "${j_datei}.palantir" "$j_datei"
}

# `richtlinie_setzen` – FollowCS2ServerGuidelines in core.json.
#
# WeaponPaints verlangt `false`: Valve verbietet Skins auf Community-Servern,
# CounterStrikeSharp hält sich mit `true` daran und blockiert, was WeaponPaints
# braucht. Der Betreiber hat das Risiko bewusst gewählt (privater Server).
#
# **Zurückgesetzt wird nur, was dieses Skript gesetzt hat** (Merkdatei). Wer
# den Schalter von Hand auf `false` gestellt hat, behält ihn.
richtlinie_setzen() {
  r_core="${CSS_CONFIGS}/core.json"
  r_merk="${CSS_CONFIGS}/.palantir-richtlinie-aus"

  [ -f "$r_core" ] || return 0

  if ist_an "${CS2_PLUGIN_WEAPONPAINTS:-}"; then
    if [ ! -f "$r_merk" ]; then
      json_setzen "$r_core" '.FollowCS2ServerGuidelines = false' || return 1
      : > "$r_merk"
      log 'FollowCS2ServerGuidelines aus - WeaponPaints braucht es so.'
    fi
  elif [ -f "$r_merk" ]; then
    json_setzen "$r_core" '.FollowCS2ServerGuidelines = true' || return 1
    rm -f "$r_merk"
    log 'WeaponPaints ist aus - FollowCS2ServerGuidelines wieder an.'
  fi
}

# -----------------------------------------------------------------------------
# MariaDB für WeaponPaints
# -----------------------------------------------------------------------------
# WeaponPaints kennt nur MySQL. Statt eines zweiten Containers läuft MariaDB im
# selben – nur, wenn WeaponPaints an ist (Entscheidung des Betreibers,
# 22.09.2026).
#
# - **Nur auf 127.0.0.1**, im eigenen Netz-Namensraum des Containers: von
#   aussen nicht erreichbar, auch nicht von anderen Spielservern.
# - **Daten im internen Ordner**, also mit dem Server gesichert und umgezogen.
# - **Passwort einmal erzeugt** und im internen Ordner abgelegt (nur für den
#   Eigentümer lesbar). Benutzer und Datenbank legt `--init-file` bei jedem
#   Start an bzw. zieht sie gerade – ohne dass sich jemand als root anmelden
#   muss.
# - **Klein eingestellt:** 32 MB Puffer, kein Performance-Schema. Eine
#   Skin-Tabelle für eine Handvoll Spieler braucht nicht mehr.
DB_ORDNER="${PALANTIR_INTERN}/mariadb"
DB_PASSWORTDATEI="${PALANTIR_INTERN}/mariadb-passwort"
DB_SOCKET="${TMPDIR:-/tmp}/palantir-mariadb.sock"
DB_INIT="${TMPDIR:-/tmp}/palantir-mariadb-init.sql"
DB_PORT=3306
DB_NAME='weaponpaints'
DB_BENUTZER='weaponpaints'
DB_PID=''

db_passwort() {
  if [ ! -s "$DB_PASSWORTDATEI" ]; then
    # 48 Hexadezimalzeichen – nichts, was in SQL oder JSON maskiert werden muss.
    (
      umask 077
      od -An -N24 -tx1 /dev/urandom | tr -d ' \n' > "$DB_PASSWORTDATEI"
    )
  fi

  cat "$DB_PASSWORTDATEI"
}

mariadb_starten() {
  mkdir -p "$DB_ORDNER"
  db_pw="$(db_passwort)"

  if [ ! -d "${DB_ORDNER}/mysql" ]; then
    log 'Lege die Datenbank fuer WeaponPaints an ...'

    if ! mariadb-install-db --no-defaults --datadir="$DB_ORDNER" \
      --auth-root-authentication-method=normal --skip-test-db > "${PALANTIR_INTERN}/mariadb-anlegen.log" 2>&1; then
      log "MariaDB liess sich nicht anlegen - siehe ${PALANTIR_INTERN}/mariadb-anlegen.log"

      return 1
    fi
  fi

  (
    umask 077
    {
      printf "CREATE DATABASE IF NOT EXISTS \`%s\`;\n" "$DB_NAME"
      printf "CREATE USER IF NOT EXISTS '%s'@'127.0.0.1' IDENTIFIED BY '%s';\n" "$DB_BENUTZER" "$db_pw"
      printf "ALTER USER '%s'@'127.0.0.1' IDENTIFIED BY '%s';\n" "$DB_BENUTZER" "$db_pw"
      printf "GRANT ALL PRIVILEGES ON \`%s\`.* TO '%s'@'127.0.0.1';\n" "$DB_NAME" "$DB_BENUTZER"
      printf 'FLUSH PRIVILEGES;\n'
    } > "$DB_INIT"
  )

  mariadbd --no-defaults --datadir="$DB_ORDNER" --socket="$DB_SOCKET" \
    --pid-file="${TMPDIR:-/tmp}/palantir-mariadb.pid" --tmpdir="${TMPDIR:-/tmp}" \
    --bind-address=127.0.0.1 --port="$DB_PORT" --skip-name-resolve \
    --innodb-buffer-pool-size=32M --performance-schema=OFF --skip-log-bin \
    --init-file="$DB_INIT" --log-error="${PALANTIR_INTERN}/mariadb.log" &
  DB_PID=$!

  # Bis zu 60 Sekunden. Eine frisch angelegte Datenbank braucht beim ersten
  # Mal ein paar Sekunden länger.
  db_versuch=0
  while ! mariadb-admin --no-defaults --socket="$DB_SOCKET" ping > /dev/null 2>&1; do
    db_versuch=$((db_versuch + 1))

    if [ "$db_versuch" -ge 60 ] || ! kill -0 "$DB_PID" 2> /dev/null; then
      rm -f "$DB_INIT"
      log "MariaDB kommt nicht hoch - siehe ${PALANTIR_INTERN}/mariadb.log"
      mariadb_stoppen

      return 1
    fi

    sleep 1
  done

  # Gelesen hat MariaDB die Datei beim Start; das Passwort soll danach nicht
  # länger als nötig herumliegen.
  rm -f "$DB_INIT"
  log 'MariaDB fuer WeaponPaints laeuft (nur 127.0.0.1).'
}

mariadb_stoppen() {
  [ -n "$DB_PID" ] || return 0

  kill -TERM "$DB_PID" 2> /dev/null || true

  while kill -0 "$DB_PID" 2> /dev/null; do
    wait "$DB_PID" 2> /dev/null || true
  done

  DB_PID=''
}

# `weaponpaints_einrichten` – trägt die Datenbank in die Plugin-Einstellungen
# ein.
#
# Fehlt die Datei, legt das Skript eine kleine an; CounterStrikeSharp ergänzt
# beim Laden die übrigen Schlüssel mit Vorgaben. Gibt es sie, werden nur die
# fünf Datenbank-Schlüssel überschrieben – Skins, Befehle und Menüs gehören dem
# Betreiber.
weaponpaints_einrichten() {
  w_ordner="${CSS_CONFIGS}/plugins/WeaponPaints"
  w_datei="${w_ordner}/WeaponPaints.json"
  w_pw="$(db_passwort)"

  mkdir -p "$w_ordner"

  if [ ! -f "$w_datei" ]; then
    printf '{}\n' > "$w_datei"
  fi

  json_setzen "$w_datei" \
    --arg host 127.0.0.1 --argjson port "$DB_PORT" --arg user "$DB_BENUTZER" \
    --arg pw "$w_pw" --arg name "$DB_NAME" \
    '.DatabaseHost = $host | .DatabasePort = $port | .DatabaseUser = $user | .DatabasePassword = $pw | .DatabaseName = $name'
}
