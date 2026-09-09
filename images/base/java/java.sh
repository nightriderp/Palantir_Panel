#!/bin/sh
#
# Gemeinsame Bausteine für Java-Spiel-Images (`palantir-base-java`).
#
# Wird vom Startskript eines Spiel-Images eingebunden, nicht ausgeführt:
#
#   . "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/java.sh"
#
# Die Datei definiert nur Funktionen. Sie ist POSIX-Shell, weil ein Java-Image
# außer der JVM keine zweite Laufzeit mitbringt (`images/README.md`), und sie
# verträgt `set -eu` – jedes Startskript läuft so.
#
# **Warum hier und nicht in jedem Spiel-Image:** Was ein Java-Server unter der
# Härtung des Agents braucht, ist bei jedem Spiel dasselbe – der Heap muss aus
# der cgroup-Grenze kommen, weil das Kontingent den Container auf keinem anderen
# Weg erreicht. Ein zweites Java-Spiel, das die Rechnung abschreibt, bekäme auch
# ihre Fehler noch einmal (Fundpunkt 178 war so einer).
#
# Geprüft ohne Docker durch `java.test.mjs` daneben. Variablen, die eine
# Funktion nach außen gibt, tragen das Präfix `JAVA_`; alles Innere das Präfix
# `java_` – POSIX-Shell kennt kein `local`, und ein Startskript soll nicht
# raten müssen, welche seiner Namen die Bibliothek überschreibt.

# -----------------------------------------------------------------------------
# RAM-Grenze des Containers in Bytes.
#
# Das Kontingent des Servers erreicht den Container nur als cgroup-Grenze
# (`HostConfig.Memory`, siehe `apps/agent/src/runtime/hardening.ts`) – es gibt
# keine Umgebungsvariable damit. Gibt die Zahl auf der Standardausgabe zurück;
# Rückgabe 1, wenn keine Grenze lesbar ist.
#
# `PALANTIR_MEMORY_LIMIT_FILE` ist ein **Ersatz**, keine zusätzliche Adresse:
# Ist die Variable gesetzt, wird nur diese Datei gelesen. Vorher stand sie am
# Anfang einer Suchliste — eine nicht lesbare Datei wurde übersprungen, und das
# Skript las danach doch die cgroup-Dateien der Maschine. Der Test, der damit
# „keine Grenze" nachstellen wollte, prüfte deshalb in Wahrheit die Grenze des
# Läufers; auf einem Läufer ohne Grenze bestand er aus dem falschen Grund
# (Fundpunkt 178).
speichergrenze_bytes() {
  if [ -n "${PALANTIR_MEMORY_LIMIT_FILE:-}" ]; then
    java_quellen="${PALANTIR_MEMORY_LIMIT_FILE}"
  else
    java_quellen="/sys/fs/cgroup/memory.max /sys/fs/cgroup/memory/memory.limit_in_bytes"
  fi

  for java_datei in $java_quellen; do
    if [ ! -r "$java_datei" ]; then
      continue
    fi

    java_wert="$(tr -d '[:space:]' < "$java_datei")"

    # cgroup v2 schreibt „max", wenn keine Grenze gesetzt ist.
    case "$java_wert" in
      '' | *[!0-9]*) continue ;;
    esac

    # cgroup v1 meldet stattdessen eine absurd große Zahl. Alles jenseits von
    # 1 TiB ist keine Grenze, sondern deren Abwesenheit.
    if [ "$java_wert" -gt 1099511627776 ]; then
      continue
    fi

    printf '%s' "$java_wert"

    return 0
  done

  return 1
}

# -----------------------------------------------------------------------------
# Heap aus dem RAM-Kontingent.
#
# Ohne eigene Rechnung nähme die JVM ihren Standard von einem Viertel der
# Grenze: Bei 4 GiB Kontingent liefe der Server mit 1 GiB Heap und ginge unter
# Last in Dauer-GC, obwohl 3 GiB ungenutzt danebenlägen.
#
# Gerechnet wird „Kontingent minus Rücklage" statt eines festen Prozentsatzes,
# weil der Bedarf neben dem Heap kaum mit ihm wächst: Metaspace, Code-Cache,
# GC-Strukturen, Thread-Stacks und die Direktpuffer von Netty brauchen ein paar
# hundert MiB, ob der Heap nun 1 oder 12 GiB groß ist. Ein Viertel des
# Kontingents, mindestens 512 und höchstens 2048 MiB, deckt das ab, ohne bei
# großen Servern GiB zu verschenken. Reißt der Rest, greift nicht der GC, sondern
# der Kernel – und der schießt den Container ab.
#
# Setzt:
#   JAVA_HEAP_ARGUMENTE                      die JVM-Schalter, durch Leerzeichen
#                                            getrennt (sie enthalten selbst keine)
#   JAVA_KONTINGENT_MIB, JAVA_HEAP_MIB,      die Zahlen dazu – leer, wenn keine
#   JAVA_RUECKLAGE_MIB                       Grenze lesbar war
#
# Rückgabe 0, wenn eine Grenze lesbar war. Sonst 1, und in JAVA_HEAP_ARGUMENTE
# steht der Rückfall: die Container-Erkennung der JVM selbst mit 70 % statt der
# voreingestellten 25 % – dieselbe Überlegung wie oben, nur gröber.
#
# Die Ergebnisse stehen in Variablen und nicht auf der Standardausgabe: Eine
# Funktion in `$(...)` läuft in einer Unter-Shell, und das Startskript will
# neben den Schaltern auch die Zahlen für sein Log, ohne sie ein zweites Mal zu
# rechnen. Aufruf deshalb direkt, nicht in Anführungszeichen:
#
#   if java_heap_bestimmen; then log "... ${JAVA_HEAP_MIB} MiB Heap"; fi
#   set -- $JAVA_HEAP_ARGUMENTE
java_heap_bestimmen() {
  JAVA_KONTINGENT_MIB=''
  JAVA_HEAP_MIB=''
  JAVA_RUECKLAGE_MIB=''

  if ! java_grenze="$(speichergrenze_bytes)"; then
    JAVA_HEAP_ARGUMENTE='-XX:MaxRAMPercentage=70'

    return 1
  fi

  JAVA_KONTINGENT_MIB=$((java_grenze / 1048576))
  JAVA_RUECKLAGE_MIB=$((JAVA_KONTINGENT_MIB / 4))

  if [ "$JAVA_RUECKLAGE_MIB" -lt 512 ]; then
    JAVA_RUECKLAGE_MIB=512
  fi

  if [ "$JAVA_RUECKLAGE_MIB" -gt 2048 ]; then
    JAVA_RUECKLAGE_MIB=2048
  fi

  JAVA_HEAP_MIB=$((JAVA_KONTINGENT_MIB - JAVA_RUECKLAGE_MIB))

  # Unter 512 MiB Heap startet kein Java-Spielserver sinnvoll. Ein so kleines
  # Kontingent ist eine Fehlkonfiguration; der Server läuft dann eben knapp und
  # der Kernel entscheidet, statt dass hier eine unmögliche Zahl gesetzt wird.
  if [ "$JAVA_HEAP_MIB" -lt 512 ]; then
    JAVA_HEAP_MIB=512
  fi

  JAVA_HEAP_ARGUMENTE="-Xms${JAVA_HEAP_MIB}M -Xmx${JAVA_HEAP_MIB}M"

  return 0
}
