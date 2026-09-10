#!/bin/sh
#
# Gemeinsame Bausteine aller Spiel-Images (`palantir-base-linux`).
#
# Wird vom Startskript eines Spiel-Images eingebunden, nicht ausgeführt:
#
#   . "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
#
# Die Datei definiert Variablen und Funktionen, sonst nichts. Sie ist
# POSIX-Shell, weil ein Spiel-Image außer dem Server keine zweite Laufzeit
# mitbringt (`images/README.md`), und sie verträgt `set -eu` – jedes Startskript
# läuft so, und eine Funktion, die dort still scheitert, risse den Serverstart
# mit.
#
# **Was hier hineingehört.** Was jedes Spiel braucht, unabhängig von Laufzeit
# und Hersteller: der Datenordner und sein interner Unterordner, das Rohr für
# die Konsole, das Holen einer Datei mit geprüfter Prüfsumme. Was nur eine
# Laufzeit braucht, steht eine Ebene höher (`base/java/java.sh` rechnet den
# JVM-Heap), was nur ein Spiel braucht, in dessen Startskript.

# -----------------------------------------------------------------------------
# Orte
# -----------------------------------------------------------------------------
# Der Datenordner steht im Image fest auf `/data` (WORKDIR). Die Variable
# existiert, damit sich Startskripte außerhalb eines Containers prüfen lassen –
# und für den seltenen Fall eines abweichenden `dataVolumeContainerPath` in der
# Spieltyp-Definition.
PALANTIR_DATENORDNER="${PALANTIR_DATA_DIR:-/data}"

# Alles, was Palantir selbst im Datenordner ablegt, liegt in einem eigenen
# Unterordner: Der Datei-Manager zeigt dem Betreiber sonst Betriebsinterna
# zwischen seinen Welten und Spielständen.
PALANTIR_INTERN="${PALANTIR_DATENORDNER}/.palantir"
PALANTIR_KONSOLE="${PALANTIR_INTERN}/console.in"

palantir_log() {
  printf '[palantir] %s\n' "$*"
}

# Legt den internen Unterordner an. Jedes Startskript ruft das als Erstes auf.
palantir_intern_anlegen() {
  mkdir -p "$PALANTIR_INTERN"
}

# -----------------------------------------------------------------------------
# Konsole
# -----------------------------------------------------------------------------
# Ein Spielserver, der Befehle von der Standardeingabe liest, ist über
# `EXEC_CONSOLE` nicht direkt erreichbar: Das startet im Container einen eigenen
# Prozess, und ein `docker exec` kommt an die Standardeingabe von PID 1 nicht
# heran. Ein benanntes Rohr löst das – `palantir-console` schreibt hinein, der
# Server liest daraus.
#
# **Warum Deskriptor 3 offen bleibt.** Ein nur zum Lesen geöffnetes Rohr liefert
# EOF, sobald der letzte Schreiber geht; der Server hielte das für „Konsole
# beendet" und führe herunter. `3<>` öffnet es zum Lesen **und** Schreiben, die
# Beschreibung bleibt damit dauerhaft schreibbar, auch wenn gerade niemand etwas
# schickt.
#
# Der Aufrufer übergibt das Rohr danach an den Server und schließt seine eigene
# Schreibseite:
#
#   palantir_konsole_oeffnen
#   exec spielserver "$@" 0<&3 3>&-
#
# `exec` wirkt in der aufrufenden Shell, weil eine Funktion keinen eigenen
# Prozess bekommt – der Deskriptor überlebt die Funktion also.
palantir_konsole_oeffnen() {
  rm -f "$PALANTIR_KONSOLE"
  mkfifo -m 600 "$PALANTIR_KONSOLE"
  exec 3<> "$PALANTIR_KONSOLE"
}

# -----------------------------------------------------------------------------
# Dateien holen
# -----------------------------------------------------------------------------
# `palantir_datei_holen <quelle> <sha256> <ziel>`
#
# Holt eine Datei in den Datenordner und prüft ihre Prüfsumme. Ist sie schon da
# und unverändert, passiert nichts – der zweite Start eines Servers lädt also
# nicht erneut.
#
# **Warum in den Datenordner und nicht ins Image** (Entscheidung des Betreibers,
# 2026-09-10): Serverdateien vieler Spiele sind zweistellig groß und ändern sich
# mit jeder Spielfassung. Im Image lägen sie in der Registry, jede Aktualisierung
# wäre ein neues Image, und ein Spiel mit 30 GiB Inhalt wäre nicht mehr sinnvoll
# zu verteilen. Im Datenordner liegen sie einmal je Server, überleben den
# Neuaufbau des Containers und lassen sich zur Laufzeit erneuern.
#
# **Der Preis, offen benannt:** Der erste Start braucht Netz, und die
# Serverfassung hängt an der Quelle statt am Image-Tag. Deshalb die Prüfsumme:
# Sie steht im Startskript neben der Adresse, und was nicht dazu passt, wird
# verworfen statt ausgeführt.
#
# Der Zwischenname `.laedt` sorgt dafür, dass ein abgebrochener Download nicht
# als fertige Datei liegenbleibt und beim nächsten Start für gültig gehalten
# wird.
palantir_datei_holen() {
  palantir_quelle="$1"
  palantir_summe="$2"
  palantir_ziel="$3"

  if [ -f "$palantir_ziel" ] &&
    printf '%s  %s\n' "$palantir_summe" "$palantir_ziel" | sha256sum --check --status -; then
    palantir_log "Vorhanden und unverändert: $(basename "$palantir_ziel")"

    return 0
  fi

  palantir_log "Hole $(basename "$palantir_ziel") ..."
  rm -f "${palantir_ziel}.laedt"

  if ! curl --fail --silent --show-error --location --retry 3 \
    --output "${palantir_ziel}.laedt" "$palantir_quelle"; then
    rm -f "${palantir_ziel}.laedt"
    palantir_log "Der Download ist gescheitert: ${palantir_quelle}"

    return 1
  fi

  if ! printf '%s  %s\n' "$palantir_summe" "${palantir_ziel}.laedt" |
    sha256sum --check --status -; then
    rm -f "${palantir_ziel}.laedt"
    palantir_log 'Die Prüfsumme passt nicht; die Datei wurde verworfen.'

    return 1
  fi

  mv "${palantir_ziel}.laedt" "$palantir_ziel"
  palantir_log "Geholt und geprüft: $(basename "$palantir_ziel")"
}
