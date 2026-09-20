#!/bin/sh
#
# Rauchprobe für `base/java`. Läuft nach der Standardprobe, im frisch gebauten
# Image, als 1000, ohne Netz (siehe `.github/rauchprobe-standard.sh`).
#
# Die JVM wird wirklich gestartet. Beim Bau läuft zwar schon ein `java -version`
# – aber als `root`, im Bau-Container und vor dem `USER 1000:1000`. Was hier
# geprüft wird, ist der Zustand, in dem ein Minecraft-Server sie vorfindet.

set -eu

if ! java -version 2>&1; then
  echo "FEHLER: java -version scheitert." >&2
  exit 1
fi

if [ "${JAVA_HOME:-}" != '/opt/java' ]; then
  echo "FEHLER: JAVA_HOME ist '${JAVA_HOME:-}', erwartet /opt/java." >&2
  exit 1
fi

# Der Heap kommt aus der cgroup-Grenze, nicht aus einer Umgebungsvariablen: Das
# Startskript rechnet „Kontingent minus Rücklage" und übergibt das Ergebnis.
# Dass die JVM mit einem gesetzten Heap überhaupt hochkommt, gehört hierher –
# eine JVM, die an ihren eigenen Startparametern scheitert, tut das sonst erst
# beim ersten Serverstart.
if ! java -Xmx256M -XX:+UseSerialGC -version >/dev/null 2>&1; then
  echo "FEHLER: die JVM startet nicht mit gesetztem Heap." >&2
  exit 1
fi

echo "  JVM startet, JAVA_HOME stimmt"
