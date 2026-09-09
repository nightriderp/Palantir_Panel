#!/bin/sh
#
# Startskript des Paper-Images.
#
# Es tut genau vier Dinge, und jedes davon hat einen Grund, der ohne diesen Text
# nicht zu erraten wäre:
#
#   1. Es hält den Server an, solange die EULA von Mojang nicht angenommen ist.
#   2. Es schreibt die vom Panel verwalteten Schlüssel in `server.properties`,
#      ohne die übrigen anzutasten.
#   3. Es holt den JVM-Heap aus dem RAM-Kontingent des Containers – die
#      Rechnung dazu liegt im Basis-Image (`images/base/java/java.sh`).
#   4. Es legt das Rohr an, über das `palantir-console` Befehle an die
#      Standardeingabe des Servers gibt.
#
# Danach ersetzt es sich per `exec` durch die JVM: kein Benutzerwechsel, kein
# `chown`, keine Shell zwischen Signal und Server (Pflichtenheft §2.3).
#
# **Warum POSIX-Shell und nicht Node wie beim Prüfstand:** Dieses Image bringt
# eine JVM mit, keine zweite Laufzeitumgebung. `start.test.mjs` prüft das Skript
# trotzdem ohne Docker – es ruft `sh` auf und schiebt ein `java` in den PATH, das
# nur seine Argumente aufschreibt.

set -eu

# Der Datenordner steht im Image fest auf `/data` (WORKDIR im Dockerfile). Die
# Variable existiert, damit sich das Skript außerhalb eines Containers prüfen
# lässt – und für den seltenen Fall eines abweichenden `dataVolumeContainerPath`
# in der Spieltyp-Definition.
DATENORDNER="${PALANTIR_DATA_DIR:-/data}"
PAPER_JAR="${PALANTIR_PAPER_JAR:-/opt/palantir/paper.jar}"

# Alles, was Palantir selbst im Datenordner ablegt, liegt in einem eigenen
# Unterordner: Der Datei-Manager zeigt dem Betreiber sonst Betriebsinterna
# zwischen seinen Welten und Plugins.
INTERN="${DATENORDNER}/.palantir"
KONSOLE="${INTERN}/console.in"
JAVA_TMP="${INTERN}/tmp"

log() {
  printf '[palantir] %s\n' "$*"
}

# -----------------------------------------------------------------------------
# 1. EULA von Mojang
#
# Die Zustimmung ist eine Rechtsentscheidung des Betreibers. Ein Image, das
# `eula=true` von sich aus schreibt, nimmt sie ihm ab – deshalb steht sie als
# eigenes Feld in der Spieltyp-Definition (`eula`, Vorgabe `false`) und kommt als
# Umgebungsvariable hier an. Ohne sie startet der Server nicht und das Log sagt,
# warum.
#
# Exit-Code 78 ist `EX_CONFIG` aus `sysexits.h`: „die Konfiguration stimmt
# nicht". Wer den Container von Hand ansieht (`docker ps -a`), unterscheidet den
# Fall damit von einem Absturz.
if [ "${EULA:-false}" != "true" ]; then
  log 'Der Server startet nicht: Die EULA von Mojang ist nicht angenommen.'
  log 'Ein Minecraft-Server darf nur betrieben werden, wenn der Betreiber die'
  log 'Endnutzer-Lizenzvereinbarung von Mojang annimmt: https://aka.ms/MinecraftEULA'
  log 'Diese Entscheidung gehört dem Betreiber; Palantir nimmt sie ihm nicht ab.'
  log 'Im Panel unter Einstellungen den Schalter "EULA von Mojang angenommen"'
  log 'setzen und den Server neu starten.'
  exit 78
fi

mkdir -p "$INTERN" "$JAVA_TMP"

# Paper liest die Zustimmung aus dieser Datei. Sie wird bei jedem Start neu
# geschrieben: Sie ist die Folge der Zustimmung im Panel, nicht eine zweite,
# davon unabhängige Einstellung.
{
  printf '# Von Palantir geschrieben, weil im Panel zugestimmt wurde.\n'
  printf '# https://aka.ms/MinecraftEULA\n'
  printf 'eula=true\n'
} > "${DATENORDNER}/eula.txt"

# -----------------------------------------------------------------------------
# 2. server.properties
#
# Das Panel verwaltet genau die Schlüssel, für die es ein Konfigurationsfeld
# gibt. Alles andere – `online-mode`, `spawn-protection`, `level-seed`, was der
# Betreiber sonst gesetzt hat – bleibt unangetastet: Es steht ihm frei, die Datei
# über die Dateiverwaltung zu bearbeiten, und ein Start, der solche Änderungen
# jedes Mal wegwirft, wäre eine böse Überraschung.
#
# `server-port` gehört bewusst zu den verwalteten Schlüsseln, obwohl es kein
# Formularfeld ist: Der Container-Port steht in der Spieltyp-Definition fest und
# die Portweiterleitung hängt daran. Ein von Hand geänderter Port führte zu einem
# Server, der läuft und trotzdem für niemanden erreichbar ist.
VERWALTET="${INTERN}/verwaltete.properties"
: > "$VERWALTET"

eigenschaft() {
  # Zeilenumbrüche im Wert zerrissen die Datei und machten aus dem Rest der
  # Zeile einen eigenen Schlüssel. Sie fallen weg; alles andere – auch `§` und
  # `\uXXXX` in der Serverbeschreibung – geht unverändert durch.
  printf '%s=%s\n' "$1" "$(printf '%s' "$2" | tr -d '\r\n')" >> "$VERWALTET"
}

eigenschaft 'server-port' "${SERVER_PORT:-25565}"
eigenschaft 'motd' "${MOTD:-Ein Palantir-Server}"
eigenschaft 'max-players' "${MAX_PLAYERS:-20}"
eigenschaft 'gamemode' "${GAMEMODE:-survival}"
eigenschaft 'difficulty' "${DIFFICULTY:-normal}"
eigenschaft 'view-distance' "${VIEW_DISTANCE:-10}"
eigenschaft 'white-list' "${WHITELIST:-false}"
# Ohne `enforce-whitelist` wirkt die Whitelist erst beim nächsten Verbinden und
# lässt bereits anwesende Fremde weiterspielen. Wer den Schalter im Panel
# umlegt, meint das Ganze.
eigenschaft 'enforce-whitelist' "${WHITELIST:-false}"

ZIEL="${DATENORDNER}/server.properties"
[ -f "$ZIEL" ] || : > "$ZIEL"

# Verschmelzen: Erste Datei sind die verwalteten Werte, zweite die vorhandene.
# Ein verwalteter Schlüssel behält seine Zeile und bekommt den neuen Wert, ein
# fehlender wird angehängt, alles Übrige – Kommentare, Reihenfolge, fremde
# Schlüssel – bleibt stehen.
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
      # Doppelte Schlüssel: Java nimmt den letzten. Die erste Zeile bekommt den
      # verwalteten Wert, die weiteren fallen weg - sonst überschriebe eine alte
      # Dublette die frische Einstellung.
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
' "$VERWALTET" "$ZIEL" > "${ZIEL}.neu"
mv "${ZIEL}.neu" "$ZIEL"

# -----------------------------------------------------------------------------
# 3. Heap aus dem RAM-Kontingent
#
# Die Rechnung – Kontingent minus Rücklage, die Grenze aus der cgroup – steht im
# Basis-Image (`images/base/java/java.sh`, im Container
# `/opt/palantir/lib/java.sh`), weil sie bei jedem Java-Spiel dieselbe ist.
# `PALANTIR_LIB_DIR` existiert, damit `start.test.mjs` die Bibliothek aus dem
# Repository einbinden kann, wo es `/opt/palantir` nicht gibt.
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/java.sh"

if java_heap_bestimmen; then
  log "RAM-Kontingent ${JAVA_KONTINGENT_MIB} MiB, davon ${JAVA_HEAP_MIB} MiB Heap (${JAVA_RUECKLAGE_MIB} MiB Rücklage)."
else
  log 'Die RAM-Grenze des Containers ist nicht lesbar; die JVM rechnet selbst.'
fi

# Absichtlich ohne Anführungszeichen: Die Schalter sind durch Leerzeichen
# getrennt und enthalten selbst keine.
# shellcheck disable=SC2086
set -- ${JAVA_HEAP_ARGUMENTE}

# -----------------------------------------------------------------------------
# 4. Temporäres Verzeichnis
#
# `/tmp` ist im Container ein tmpfs mit `noexec` (siehe `TMPFS_OPTIONS` in
# `apps/agent/src/runtime/hardening.ts`) und nur 64 MiB groß. Netty entpackt
# seine native Transport-Bibliothek in das temporäre Verzeichnis und lädt sie
# von dort – auf einem `noexec`-Mount scheitert genau das, und Paper fiele auf
# den langsameren NIO-Transport zurück oder bliebe mit einem
# `UnsatisfiedLinkError` stehen.
#
# Die Lösung ist der Datenordner, nicht ein ausführbares tmpfs: Die Härtung
# aufzuweichen, damit ein Spiel bequemer läuft, ist genau der Handel, den
# Pflichtenheft §2.3 ausschließt. Der Bind-Mount des Datenordners wird ohne
# `noexec` eingehängt (`bindString()` in derselben Datei), dort funktioniert es.
set -- "$@" "-Djava.io.tmpdir=${JAVA_TMP}" "-Dio.netty.native.workdir=${JAVA_TMP}"

# Empfohlene JVM-Schalter von PaperMC selbst
# (`fill.papermc.io/v3/projects/paper/versions/26.2` → `java.flags.recommended`),
# ohne `-Xms`/`-Xmx`: die stehen oben und kommen aus dem Kontingent.
set -- "$@" \
  -XX:+UseG1GC \
  -XX:+ParallelRefProcEnabled \
  -XX:MaxGCPauseMillis=200 \
  -XX:+UnlockExperimentalVMOptions \
  -XX:+DisableExplicitGC \
  -XX:+AlwaysPreTouch \
  -XX:G1NewSizePercent=30 \
  -XX:G1MaxNewSizePercent=40 \
  -XX:G1HeapRegionSize=8M \
  -XX:G1ReservePercent=20 \
  -XX:G1HeapWastePercent=5 \
  -XX:G1MixedGCCountTarget=4 \
  -XX:InitiatingHeapOccupancyPercent=15 \
  -XX:G1MixedGCLiveThresholdPercent=90 \
  -XX:G1RSetUpdatingPauseTimePercent=5 \
  -XX:SurvivorRatio=32 \
  -XX:+PerfDisableSharedMem \
  -XX:MaxTenuringThreshold=1

# Startparameter des Betreibers (`PALANTIR_STARTUP_PARAMETERS`, siehe
# `container-spec.ts`). Sie kommen als **eine** Zeichenkette an, weil das Backend
# freien Text bewusst nicht selbst in eine Argumentliste zerlegt. Hier zerfällt
# sie an Leerzeichen – Anführungszeichen werden dabei nicht ausgewertet, ein
# Argument mit Leerzeichen darin ist also nicht möglich. Für JVM-Schalter, um die
# es hier geht, reicht das.
if [ -n "${PALANTIR_STARTUP_PARAMETERS:-}" ]; then
  # Absichtlich ohne Anführungszeichen: die Wortzerlegung ist der Zweck.
  # shellcheck disable=SC2086
  set -- "$@" ${PALANTIR_STARTUP_PARAMETERS}
fi

set -- "$@" -jar "$PAPER_JAR" --nogui

# -----------------------------------------------------------------------------
# 5. Konsole
#
# Ein Minecraft-Server liest Befehle von der Standardeingabe. `EXEC_CONSOLE`
# startet im Container aber einen eigenen Prozess ohne Verbindung dorthin – ein
# `docker exec` erreicht die Standardeingabe von PID 1 nicht. Der Prüfstand löst
# das über einen Steuerport; hier genügt ein benanntes Rohr, weil der Server
# ohnehin Zeilen von stdin erwartet.
#
# `3<>` öffnet das Rohr zum Lesen **und** Schreiben. Das ist der Kern: Ein nur
# zum Lesen geöffnetes Rohr liefert EOF, sobald der letzte Schreiber geht – der
# Server hielte das für „Konsole beendet" und fährt herunter. So bleibt die
# Beschreibung dauerhaft schreibbar, auch wenn gerade niemand etwas schickt.
rm -f "$KONSOLE"
mkfifo -m 600 "$KONSOLE"
exec 3<> "$KONSOLE"

log "Startet Paper: java $*"

# `exec` und `3>&-`: Die JVM wird PID 1 (bekommt SIGTERM direkt) und behält vom
# Rohr nur die Standardeingabe.
exec java "$@" 0<&3 3>&-
