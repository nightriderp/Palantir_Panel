#!/bin/sh
#
# Gemeinsame Bausteine für Spiele aus Steam (`palantir-base-steam`).
#
# Wird vom Startskript eines Spiel-Images eingebunden, nicht ausgeführt, und
# **nach** `palantir.sh` – die Orte im Datenordner kommen von dort:
#
#   . "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
#   . "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/steam.sh"
#
# Mit Abstand die größte Gruppe der Spiele aus Anhang A holt ihre Serverdateien
# über SteamCMD. Was dabei bei jedem gleich ist – wo SteamCMD liegt, wie es
# aufgerufen wird, dass ein Fehlschlag wiederholt wird –, steht hier; was das
# Spiel selbst ausmacht, im Startskript.

# Die Vorlage im Image. `PALANTIR_STEAMCMD_DIR` existiert, damit sich die
# Bibliothek außerhalb eines Containers prüfen lässt.
STEAM_VORLAGE="${PALANTIR_STEAMCMD_DIR:-/opt/steamcmd}"

# Der Ort, von dem aus SteamCMD wirklich läuft.
STEAM_HEIM="${PALANTIR_INTERN}/steam"
STEAM_CMD="${STEAM_HEIM}/steamcmd.sh"

# -----------------------------------------------------------------------------
# `steam_vorbereiten`
# -----------------------------------------------------------------------------
# Kopiert SteamCMD aus dem Image in den Datenordner und setzt `HOME` dorthin.
#
# **Warum nicht einfach aus `/opt` starten:** SteamCMD aktualisiert sich beim
# ersten Aufruf selbst und schreibt dabei in sein eigenes Verzeichnis. Das
# Wurzeldateisystem des Containers ist schreibgeschützt (Pflichtenheft §2.3),
# der Aufruf schlüge dort fehl. Die Kopie ist gut zwei Megabyte und liegt im
# internen Unterordner, also außer Sichtweite des Datei-Managers.
#
# **Warum `HOME` mitgesetzt wird:** SteamCMD legt seinen Zwischenspeicher und
# seine Konfiguration unter `$HOME/Steam` ab. Ohne diese Zeile landet das im
# Wurzelverzeichnis des Datenordners und steht dem Betreiber zwischen seinen
# Spielständen.
steam_vorbereiten() {
  mkdir -p "$STEAM_HEIM"

  if [ ! -x "$STEAM_CMD" ]; then
    palantir_log 'Lege SteamCMD im Datenordner an ...'
    cp -a "${STEAM_VORLAGE}/." "${STEAM_HEIM}/"
  fi

  HOME="$STEAM_HEIM"
  export HOME
}

# -----------------------------------------------------------------------------
# `steam_app_holen <anwendungsnummer> <zielordner>`
# -----------------------------------------------------------------------------
# Holt oder aktualisiert die Serverdateien einer Steam-Anwendung.
#
# **Bei jedem Start**, nicht nur beim ersten: So wie es SteamCMD-Server üblich
# machen. Ist alles auf dem Stand, kostet der Aufruf ein paar Sekunden; ist es
# das nicht, holt er die Änderung, ohne dass jemand ein neues Image bauen muss.
# Genau dafür liegen die Dateien im Datenordner (siehe `palantir.sh`).
#
# **Ohne `validate`.** Das würde jede Datei gegen den Stand von Valve prüfen und
# Abweichungen ersetzen – und damit die Mods des Betreibers wegräumen, die bei
# vielen dieser Spiele genau dort liegen. Wer eine kaputte Installation
# geradeziehen will, löscht den Ordner; der nächste Start holt sie neu.
#
# **Dreimal versuchen.** SteamCMD bricht regelmäßig mit einem
# Verbindungsfehler ab, der beim nächsten Versuch weg ist. Ein Serverstart, der
# daran scheitert, wäre für den Betreiber nicht zu unterscheiden von einem
# echten Fehler.
steam_app_holen() {
  steam_anwendung="$1"
  steam_ziel="$2"

  steam_vorbereiten
  mkdir -p "$steam_ziel"

  steam_versuch=1

  while [ "$steam_versuch" -le 3 ]; do
    palantir_log "SteamCMD holt Anwendung ${steam_anwendung} (Versuch ${steam_versuch} von 3) ..."

    if "$STEAM_CMD" +force_install_dir "$steam_ziel" +login anonymous \
      +app_update "$steam_anwendung" +quit; then
      palantir_log "Anwendung ${steam_anwendung} ist auf dem Stand."

      return 0
    fi

    steam_versuch=$((steam_versuch + 1))
  done

  palantir_log "SteamCMD ist dreimal gescheitert; die Anwendung ${steam_anwendung} fehlt."

  return 1
}
