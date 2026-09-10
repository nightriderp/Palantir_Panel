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
# die Konsole, das Holen und Auspacken einer Datei mit geprüfter Prüfsumme, das
# Verschmelzen einer `schlüssel=wert`-Konfiguration. Was nur eine Laufzeit
# braucht, steht eine Ebene höher (`base/java/java.sh` rechnet den JVM-Heap),
# was nur ein Spiel braucht, in dessen Startskript.
#
# **Das Verschmelzen stand bis Fassung 1 im Startskript von Minecraft.** Es ist
# dort in gleicher Form geblieben, weil jenes Image auf `base/java:3` und damit
# auf `base/linux:1` sitzt; wenn es das nächste Mal eine neue Fassung bekommt,
# gehört die Kopie dort heraus.

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

# `palantir_zip_auspacken <archiv> <zielordner>`
#
# Packt ein Zip aus. Eine eigene Funktion, weil zwei Kleinigkeiten sonst in
# jedem Startskript stünden: `-q`, damit nicht jede der hundert Dateien im Log
# landet, und das Anlegen des Zielordners.
#
# Das Ausführungsbit überlebt den Weg durch ein Zip nicht zuverlässig – wer eine
# Binärdatei auspackt, setzt es danach selbst (`chmod 0755`).
palantir_zip_auspacken() {
  palantir_archiv="$1"
  palantir_ziel="$2"

  mkdir -p "$palantir_ziel"

  if ! unzip -q -o "$palantir_archiv" -d "$palantir_ziel"; then
    palantir_log "Das Archiv liess sich nicht auspacken: $(basename "$palantir_archiv")"

    return 1
  fi
}

# -----------------------------------------------------------------------------
# Einstellungen verschmelzen
# -----------------------------------------------------------------------------
# `palantir_schluessel_verschmelzen <verwaltete> <zieldatei>`
#
# Für jede Konfigurationsdatei aus `schlüssel=wert`-Zeilen – Terrarias
# `serverconfig.txt`, Minecrafts `server.properties`, die INI-Dateien vieler
# Steam-Spiele.
#
# **Das Panel verwaltet genau die Schlüssel, für die es ein Feld gibt.** Alles
# andere gehört dem Betreiber: Er darf die Datei über die Dateiverwaltung
# bearbeiten, und ein Start, der solche Änderungen jedes Mal wegwirft, wäre eine
# böse Überraschung. Ein verwalteter Schlüssel behält deshalb seine Zeile und
# bekommt den neuen Wert, ein fehlender wird angehängt, alles Übrige –
# Kommentare, Reihenfolge, fremde Schlüssel – bleibt stehen.
#
# Doppelte Schlüssel: Die erste Zeile bekommt den verwalteten Wert, die weiteren
# fallen weg. Sonst überschriebe eine alte Dublette weiter unten die frische
# Einstellung – die meisten Leser nehmen den letzten Treffer.
palantir_schluessel_verschmelzen() {
  palantir_verwaltet="$1"
  palantir_ziel="$2"

  [ -f "$palantir_ziel" ] || : > "$palantir_ziel"

  awk '
    NR == FNR {
      trenner = index($0, "=")
      if (trenner > 0) {
        schluessel = substr($0, 1, trenner - 1)
        if (!(schluessel in wert)) reihenfolge[++anzahl] = schluessel
        wert[schluessel] = substr($0, trenner + 1)
      }
      next
    }
    {
      trenner = index($0, "=")
      if ($0 ~ /^[ \t]*[#!]/ || trenner == 0) { print; next }
      schluessel = substr($0, 1, trenner - 1)
      if (schluessel in wert) {
        if (!(schluessel in geschrieben)) {
          print schluessel "=" wert[schluessel]
          geschrieben[schluessel] = 1
        }
        next
      }
      print
    }
    END {
      for (i = 1; i <= anzahl; i++)
        if (!(reihenfolge[i] in geschrieben))
          print reihenfolge[i] "=" wert[reihenfolge[i]]
    }
  ' "$palantir_verwaltet" "$palantir_ziel" > "${palantir_ziel}.neu"

  mv "${palantir_ziel}.neu" "$palantir_ziel"
}

# `palantir_eigenschaft <datei> <schlüssel> <wert>`
#
# Hängt eine Zeile an die Liste der verwalteten Schlüssel an.
#
# Zeilenumbrüche im Wert zerrissen die Datei und machten aus dem Rest der Zeile
# einen eigenen Schlüssel – sie fallen weg. Alles andere geht unverändert durch,
# auch `§` und `\uXXXX` in einer Serverbeschreibung.
palantir_eigenschaft() {
  printf '%s=%s\n' "$2" "$(printf '%s' "$3" | tr -d '\r\n')" >> "$1"
}
