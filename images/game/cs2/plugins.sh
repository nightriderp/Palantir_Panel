#!/bin/sh
#
# Einzelne Plugins des CS2-Images (Schritte 9–15).
#
# Wird von `start.sh` eingebunden, nicht ausgeführt – und erst, nachdem die
# Plugin-Grundlage (MetaMod, CounterStrikeSharp) liegt. Erwartet von dort:
# `CSGO`, `ADDONS` und `palantir_log`.
#
# Welche Plugins es gibt, steht in `plugins.list` neben diesem Skript; hier
# steht nur, wie eines ein- und ausgeschaltet wird. Vorlage ist der erste
# Anlauf (#662), diesmal Plugin für Plugin.

# `CSGO`, `ADDONS` und `PALANTIR_INTERN` setzt `start.sh` vor dem Einbinden.
# shellcheck disable=SC2154

CSS_PLUGINS="${ADDONS}/counterstrikesharp/plugins"
PLUGIN_ABLAGE="${PALANTIR_INTERN}/cs2-plugins"

# -----------------------------------------------------------------------------
# Einschalten
# -----------------------------------------------------------------------------
# `plugin_an <name> <adresse> <summe> <zuordnung> <ordner>`
#
# Holt das Archiv (einmal, geprüft), packt es aber nur aus, wenn sich die Summe
# seit dem letzten Mal geändert hat – Merkdatei je Plugin. Sonst überschriebe
# jeder Start, was der Betreiber im Plugin-Ordner geändert hat.
#
# Ein abgeschaltetes Plugin liegt unter `plugins/disabled` und wird zuerst
# zurückgeholt; seine Dateien sind dieselben wie vorher.
plugin_an() {
  p_name="$1"
  p_adresse="$2"
  p_summe="$3"
  p_zuordnung="$4"
  p_ordner="$5"

  plugin_zurueckholen "$p_ordner"

  case "$p_adresse" in
    *.tar.gz) p_archiv="${PLUGIN_ABLAGE}/${p_name}.tar.gz" ;;
    *) p_archiv="${PLUGIN_ABLAGE}/${p_name}.zip" ;;
  esac

  mkdir -p "$PLUGIN_ABLAGE" "$CSS_PLUGINS"
  palantir_datei_holen "$p_adresse" "$p_summe" "$p_archiv" || return 1

  p_merk="${ADDONS}/counterstrikesharp/.palantir-plugin-${p_name}"

  if [ -f "$p_merk" ] && [ "$(cat "$p_merk")" = "$p_summe" ]; then
    return 0
  fi

  p_bau="${PLUGIN_ABLAGE}/auspacken-${p_name}"
  rm -rf "$p_bau"
  mkdir -p "$p_bau"

  case "$p_archiv" in
    *.tar.gz)
      if ! tar -xzf "$p_archiv" -C "$p_bau"; then
        palantir_log "Das Archiv von ${p_name} liess sich nicht auspacken."
        rm -rf "$p_bau"
        return 1
      fi
      ;;
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
      palantir_log "Im Archiv von ${p_name} fehlt ${p_quelle} - anders gepackt als erwartet."
      rm -rf "$p_bau"
      return 1
    fi

    mkdir -p "${CSGO}/${p_ziel}"
    cp -a "${p_bau}/${p_quelle}/." "${CSGO}/${p_ziel}/"
  done
  IFS="$p_alt_ifs"

  rm -rf "$p_bau"
  printf '%s\n' "$p_summe" > "$p_merk"
  palantir_log "Plugin ${p_name} ausgepackt."
}

# -----------------------------------------------------------------------------
# Ausschalten
# -----------------------------------------------------------------------------
# `plugin_aus <ordner>`
#
# Verschiebt die Plugin-Ordner nach `plugins/disabled` – CounterStrikeSharp
# lädt dort nichts. Gelöscht wird nichts: Einstellungen und eigene Dateien sind
# beim Wiedereinschalten noch da. Bibliotheken (`-`) bleiben liegen; ohne
# Plugin, das sie lädt, tun sie nichts.
plugin_aus() {
  [ "$1" = '-' ] && return 0

  p_alt_ifs="$IFS"
  IFS=','
  for p_eins in $1; do
    IFS="$p_alt_ifs"

    if [ -d "${CSS_PLUGINS}/${p_eins}" ]; then
      mkdir -p "${CSS_PLUGINS}/disabled"
      rm -rf "${CSS_PLUGINS}/disabled/${p_eins}"
      mv "${CSS_PLUGINS}/${p_eins}" "${CSS_PLUGINS}/disabled/${p_eins}"
      palantir_log "Plugin ${p_eins} abgeschaltet."
    fi
  done
  IFS="$p_alt_ifs"
}

plugin_zurueckholen() {
  [ "$1" = '-' ] && return 0

  p_alt_ifs="$IFS"
  IFS=','
  for p_eins in $1; do
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
# Aus den Schaltern des Panels, plus die Abhängigkeiten. Die stehen hier und
# nicht als eigene Schalter: Wer SimpleAdmin einschaltet, will nicht wissen
# müssen, dass es MenuManager braucht, das PlayerSettings braucht, das
# AnyBaseLib braucht. Nur `true` schaltet ein.
plugins_gewuenscht() {
  gewuenscht=''

  if [ "${CS2_PLUGIN_SIMPLEADMIN:-}" = true ]; then
    gewuenscht="${gewuenscht} simpleadmin anybaselib playersettings menumanager"
  fi

  # Spielmodus-Plugin: eine Auswahl, nicht zwei Schalter (Fundpunkt 361) –
  # MatchZy und Retakes steuern beide Runden und Bots. `start.sh` hat den Wert
  # schon geprüft.
  case "${CS2_MODE_PLUGIN:-none}" in
    matchzy) gewuenscht="${gewuenscht} matchzy" ;;
    retakes) gewuenscht="${gewuenscht} retakes" ;;
  esac

  printf '%s\n' "$gewuenscht"
}

enthalten() {
  case " $2 " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

# -----------------------------------------------------------------------------
# Plugins im laufenden Betrieb (Betreiber 25.09.2026)
# -----------------------------------------------------------------------------
# CounterStrikeSharp lädt und entlädt Plugins zur Laufzeit
# (`css_plugins load/unload <pfad>`). Das Panel schickt dafür nur
# `exec palantir_plugin_an_<name>` bzw. `…_aus_…` und `exec palantir_modus_<wert>`
# – die Befehle selbst stehen in Dateien, die hier beim Start entstehen. Eine
# einzige Konsolenzeile wäre für fünf Plugin-Pfade zu lang (CS2 kappt bei gut
# 500 Zeichen), und nur das Image kennt die Ordner aus `plugins.list`.
#
# Jedes Plugin liegt nach dem Start entweder unter `plugins/<ordner>` oder unter
# `plugins/disabled/<ordner>` – je nachdem, ob es beim Start an war. Die Dateien
# nennen deshalb beide Pfade; der falsche scheitert harmlos mit „Could not
# load/unload“ in der Konsole.

# Abhängigkeiten, die mit einem Plugin geladen werden müssen – in dieser
# Reihenfolge, vor dem Plugin selbst. Dieselben wie in `plugins_gewuenscht`.
plugin_abhaengigkeiten() {
  case "$1" in
    simpleadmin) printf '%s\n' 'playersettings menumanager' ;;
    *) printf '\n' ;;
  esac
}

plugin_befehle_schreiben() {
  p_name="$1"
  p_ordner="$2"

  [ "$p_ordner" = '-' ] && return 0

  p_cfg="${CSGO}/cfg"
  mkdir -p "$p_cfg"

  {
    echo '// Schreibt Palantir bei jedem Start - Plugin im laufenden Betrieb laden.'
    for p_dep in $(plugin_abhaengigkeiten "$p_name"); do
      echo "exec palantir_plugin_an_${p_dep}"
    done
    p_alt_ifs="$IFS"
    IFS=','
    for p_eins in $p_ordner; do
      echo "css_plugins load plugins/${p_eins}/${p_eins}.dll"
      echo "css_plugins load plugins/disabled/${p_eins}/${p_eins}.dll"
    done
    IFS="$p_alt_ifs"
  } > "${p_cfg}/palantir_plugin_an_${p_name}.cfg"

  {
    echo '// Schreibt Palantir bei jedem Start - Plugin im laufenden Betrieb entladen.'
    p_alt_ifs="$IFS"
    IFS=','
    for p_eins in $p_ordner; do
      echo "css_plugins unload plugins/${p_eins}/${p_eins}.dll"
      echo "css_plugins unload plugins/disabled/${p_eins}/${p_eins}.dll"
    done
    IFS="$p_alt_ifs"
  } > "${p_cfg}/palantir_plugin_aus_${p_name}.cfg"
}

# Spielmodus-Plugin wechseln: das andere entladen, das gewählte laden. Nie zwei.
modus_befehle_schreiben() {
  p_cfg="${CSGO}/cfg"
  mkdir -p "$p_cfg"

  printf '%s\n' '// Schreibt Palantir - kein Spielmodus-Plugin.' \
    'exec palantir_plugin_aus_matchzy' 'exec palantir_plugin_aus_retakes' \
    > "${p_cfg}/palantir_modus_none.cfg"
  printf '%s\n' '// Schreibt Palantir - MatchZy als Spielmodus-Plugin.' \
    'exec palantir_plugin_aus_retakes' 'exec palantir_plugin_an_matchzy' \
    > "${p_cfg}/palantir_modus_matchzy.cfg"
  printf '%s\n' '// Schreibt Palantir - Retakes als Spielmodus-Plugin.' \
    'exec palantir_plugin_aus_matchzy' 'exec palantir_plugin_an_retakes' \
    > "${p_cfg}/palantir_modus_retakes.cfg"
}

# `plugins_abgleichen` – legt jedes Plugin aus der Liste bereit und schaltet es
# ein oder aus.
#
# **Alle werden geholt**, auch nicht gewählte (Betreiber 25.09.2026): Nur was
# schon ausgepackt liegt, kann das Panel im laufenden Betrieb laden. Nicht
# gewählte landen gleich unter `plugins/disabled`. Scheitert dabei ein nicht
# gewähltes, startet der Server trotzdem – es fehlt dann nur zum Umschalten.
plugins_abgleichen() {
  liste="${PALANTIR_CS2_PLUGINLISTE:-${CS2_SKRIPTE:-/opt/palantir}/plugins.list}"

  if [ ! -f "$liste" ]; then
    palantir_log "Die Plugin-Liste fehlt: ${liste}"
    return 1
  fi

  gewuenscht="$(plugins_gewuenscht)"
  fehler=0

  # `read` aus einer Datei, nicht aus einer Pipe: In einer Pipe liefe die
  # Schleife in einer Nebenshell, und `fehler` wäre danach wieder 0.
  while read -r l_name l_version l_adresse l_summe l_zuordnung l_ordner; do
    case "$l_name" in
      '' | '#'*) continue ;;
    esac

    if enthalten "$l_name" "$gewuenscht"; then
      if ! plugin_an "$l_name" "$l_adresse" "$l_summe" "$l_zuordnung" "$l_ordner"; then
        palantir_log "Plugin ${l_name} ${l_version} liess sich nicht einrichten."
        fehler=1
      fi
    else
      if ! plugin_an "$l_name" "$l_adresse" "$l_summe" "$l_zuordnung" "$l_ordner"; then
        palantir_log "Hinweis: ${l_name} ${l_version} liegt nicht bereit - im laufenden Betrieb nicht zuschaltbar."
      fi
      plugin_aus "$l_ordner"
    fi

    plugin_befehle_schreiben "$l_name" "$l_ordner"
  done < "$liste"

  modus_befehle_schreiben

  return "$fehler"
}
