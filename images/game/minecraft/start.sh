#!/bin/sh
#
# Startskript des Minecraft-Images – für beide Ausgaben, Paper und Vanilla
# (`MINECRAFT_EDITION`).
#
# Es tut genau fünf Dinge, und jedes davon hat einen Grund, der ohne diesen Text
# nicht zu erraten wäre:
#
#   1. Es hält den Server an, solange die EULA von Mojang nicht angenommen ist.
#   2. Es schreibt die vom Panel verwalteten Schlüssel in `server.properties`,
#      ohne die übrigen anzutasten.
#   3. Es holt den JVM-Heap aus dem RAM-Kontingent des Containers – die
#      Rechnung dazu liegt im Basis-Image (`images/base/java/java.sh`).
#   4. Es bestimmt die Server-Jar: Paper liegt im Image, den Server von Mojang
#      holt es beim ersten Start in den Datenordner – der darf nicht
#      weitergegeben werden, kann also nicht im Image liegen.
#   5. Es legt das Rohr an, über das `palantir-console` Befehle an die
#      Standardeingabe des Servers gibt – und ein frisches RCON-Passwort, über
#      das das Panel die Konsole seit P2-9 vorrangig anspricht.
#
# **Warum eine Datei für beide Ausgaben.** Alles außer der Jar ist gleich: EULA,
# `server.properties`, RCON, Heap, temporäres Verzeichnis, Konsole. Zwei Images
# hießen zwei Kopien davon, die auseinanderdriften; das Panel unterscheidet die
# beiden ohnehin über die Spieltyp-Definition und nicht über das Image.
#
# Danach ersetzt es sich per `exec` durch die JVM: kein Benutzerwechsel, kein
# `chown`, keine Shell zwischen Signal und Server (Pflichtenheft §2.3).
#
# **Warum POSIX-Shell und nicht Node wie beim Prüfstand:** Dieses Image bringt
# eine JVM mit, keine zweite Laufzeitumgebung. `start.test.mjs` prüft das Skript
# trotzdem ohne Docker – es ruft `sh` auf und schiebt ein `java` in den PATH, das
# nur seine Argumente aufschreibt.

set -eu

# Die gemeinsamen Bausteine der Wurzel (`images/base/linux/palantir.sh`): der
# Datenordner und sein interner Unterordner, das Konsolen-Rohr, das Holen einer
# Datei mit geprüfter Prüfsumme. `PALANTIR_LIB_DIR` existiert, damit
# `start.test.mjs` die Bibliotheken aus dem Repository einbinden kann, wo es
# `/opt/palantir` nicht gibt.
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"

DATENORDNER="$PALANTIR_DATENORDNER"
PAPER_JAR="${PALANTIR_PAPER_JAR:-/opt/palantir/paper.jar}"
# `paper` oder `vanilla`. Beide Ausgaben laufen aus diesem einen Image: Sie
# teilen sich EULA, `server.properties`, RCON, Heap und Konsole – der Unterschied
# ist die Jar und woher sie kommt (Abschnitt 3).
AUSGABE="${MINECRAFT_EDITION:-paper}"
INTERN="$PALANTIR_INTERN"
KONSOLE="$PALANTIR_KONSOLE"
JAVA_TMP="${INTERN}/tmp"

# Kurzname für die Zeilen unten; geschrieben wird über die gemeinsame Funktion,
# damit jedes Spiel-Image dasselbe Präfix trägt.
log() {
  palantir_log "$@"
}

case "$AUSGABE" in
  paper | vanilla | fabric | neoforge) ;;
  *)
    log "Unbekannte Ausgabe: ${AUSGABE}."
    log 'Erlaubt sind paper, vanilla, fabric und neoforge.'
    exit 78
    ;;
esac

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

palantir_intern_anlegen
mkdir -p "$JAVA_TMP"

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

# RCON (P2-9): Das Panel gibt Befehle über RCON, weil so die Antwort zurückkommt,
# statt nur im Log zu stehen. Das Passwort entsteht bei jedem Start neu und liegt
# nur im Datenordner (0600) – der Agent liest es von dort, es verlässt die Node
# nie. Der Port wird nie veröffentlicht; erreichbar ist er nur im Spielenetz.
# `broadcast-rcon-to-ops` bleibt aus: Sonst sähe jeder Op im Spiel jeden Befehl
# aus dem Panel.
RCON_PASSWORT_DATEI="${INTERN}/rcon.password"
RCON_PASSWORT="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
ALTE_UMASK="$(umask)"
umask 077
printf '%s\n' "$RCON_PASSWORT" > "$RCON_PASSWORT_DATEI"
umask "$ALTE_UMASK"
eigenschaft 'enable-rcon' 'true'
eigenschaft 'rcon.port' "${RCON_PORT:-25575}"
eigenschaft 'rcon.password' "$RCON_PASSWORT"
eigenschaft 'broadcast-rcon-to-ops' 'false'

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
#
# Vanilla bekommt sie ebenfalls. Es sind Einstellungen des G1-Sammlers, keine
# Paper-Erweiterungen – jede HotSpot-JVM versteht sie, und der Grund dafür (eine
# Pause statt eines Rucks im Spiel) ist bei Mojangs Server derselbe.
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

# -----------------------------------------------------------------------------
# 5. Die Server-Jar
#
# **Paper** liegt im Image (`/opt/palantir/paper.jar`). Es darf weitergegeben
# werden (GPLv3), also ist das der bessere Ort: Ein Image-Tag steht damit für
# genau eine Serverfassung, und der Start braucht kein Netz.
#
# **Der Server von Mojang darf das nicht.** Für die Ausgabe `vanilla` kann die
# Jar deshalb nicht im Image liegen – sie wird beim ersten Start in den
# Datenordner geholt und dort auf ihre Prüfsumme geprüft
# (`palantir_datei_holen` aus der Wurzel). Beim zweiten Start ist sie da und es
# passiert nichts. Adresse, Fassung und Prüfsumme stehen im Dockerfile und
# gehören damit zum Image-Tag; was nicht zur Summe passt, wird verworfen statt
# ausgeführt.
#
# Sie liegt im internen Unterordner, nicht neben den Welten: Sie gehört
# Palantir, nicht dem Betreiber, und hat in der Dateiverwaltung nichts zu
# suchen.
#
# **Die beiden Mod-Ausgaben** kommen ebenfalls aus dem Netz, aber anders. Fabric
# ist eine kleine Starter-Jar, die den Rest beim ersten Lauf selbst nachzieht.
# NeoForge kommt als Installationsprogramm: Es legt einen Baum aus Bibliotheken
# an und schreibt eine Argumentdatei, die beim Start eingebunden wird – es gibt
# dort gar keine einzelne Server-Jar mehr.
if [ "$AUSGABE" = 'fabric' ] || [ "$AUSGABE" = 'neoforge' ]; then
  # Mods kommen über die Dateiverwaltung. Der Ordner entsteht hier, damit der
  # Betreiber ihn vorfindet, statt ihn erst anlegen zu müssen – ein Mod im
  # falschen Ordner ist der häufigste Grund, warum „der Server die Mods nicht
  # lädt".
  mkdir -p "${DATENORDNER}/mods"
fi

if [ "$AUSGABE" = 'paper' ]; then
  SERVER_JAR="$PAPER_JAR"
elif [ "$AUSGABE" = 'fabric' ]; then
  if [ -z "${MINECRAFT_FABRIC_URL:-}" ] || [ -z "${MINECRAFT_FABRIC_SHA256:-}" ]; then
    log 'Der Ausgabe "fabric" fehlen MINECRAFT_FABRIC_URL oder MINECRAFT_FABRIC_SHA256.'
    exit 78
  fi

  FABRIC_ORDNER="${INTERN}/fabric"
  mkdir -p "$FABRIC_ORDNER"
  SERVER_JAR="${FABRIC_ORDNER}/fabric-server-${MINECRAFT_FABRIC_VERSION:-unbekannt}.jar"

  if ! palantir_datei_holen "$MINECRAFT_FABRIC_URL" "$MINECRAFT_FABRIC_SHA256" "$SERVER_JAR"; then
    log 'Die Starter-Jar von Fabric konnte nicht geholt werden.'
    exit 69
  fi
elif [ "$AUSGABE" = 'neoforge' ]; then
  if [ -z "${MINECRAFT_NEOFORGE_URL:-}" ] || [ -z "${MINECRAFT_NEOFORGE_SHA256:-}" ]; then
    log 'Der Ausgabe "neoforge" fehlen MINECRAFT_NEOFORGE_URL oder MINECRAFT_NEOFORGE_SHA256.'
    exit 78
  fi

  NEOFORGE_FASSUNG="${MINECRAFT_NEOFORGE_VERSION:-unbekannt}"
  NEOFORGE_ORDNER="${INTERN}/neoforge"
  # Die Argumentdatei ist zugleich das Zeichen, dass die Installation
  # durchgelaufen ist: Sie entsteht als Letztes.
  NEOFORGE_ARGUMENTE="${NEOFORGE_ORDNER}/libraries/net/neoforged/neoforge/${NEOFORGE_FASSUNG}/unix_args.txt"

  if [ ! -f "$NEOFORGE_ARGUMENTE" ]; then
    NEOFORGE_INSTALLER="${INTERN}/neoforge-installer-${NEOFORGE_FASSUNG}.jar"

    if ! palantir_datei_holen \
      "$MINECRAFT_NEOFORGE_URL" "$MINECRAFT_NEOFORGE_SHA256" "$NEOFORGE_INSTALLER"; then
      log 'Das Installationsprogramm von NeoForge konnte nicht geholt werden.'
      exit 69
    fi

    mkdir -p "$NEOFORGE_ORDNER"
    log "Richtet NeoForge ${NEOFORGE_FASSUNG} ein – das dauert beim ersten Start einige Minuten ..."

    # Das Installationsprogramm holt den Server von Mojang und die Bibliotheken
    # und legt sie in den genannten Ordner. Es braucht Netz und läuft genau
    # einmal; ein späterer Start findet die Argumentdatei vor.
    if ! java -jar "$NEOFORGE_INSTALLER" --installServer "$NEOFORGE_ORDNER"; then
      log 'Die Einrichtung von NeoForge ist gescheitert.'
      log "Den Ordner .palantir/neoforge im Datenordner löschen und neu starten fängt von vorn an."
      rm -f "$NEOFORGE_INSTALLER"
      exit 69
    fi

    rm -f "$NEOFORGE_INSTALLER"

    if [ ! -f "$NEOFORGE_ARGUMENTE" ]; then
      log "Nach der Einrichtung fehlt ${NEOFORGE_ARGUMENTE}."
      log 'Passt MINECRAFT_NEOFORGE_VERSION zu MINECRAFT_NEOFORGE_URL?'
      exit 69
    fi
  fi
else
  if [ -z "${MINECRAFT_VANILLA_URL:-}" ] || [ -z "${MINECRAFT_VANILLA_SHA256:-}" ]; then
    log 'Der Ausgabe "vanilla" fehlen MINECRAFT_VANILLA_URL oder MINECRAFT_VANILLA_SHA256.'
    log 'Beide setzt das Image (Dockerfile); ohne sie ist nicht bestimmbar, welcher'
    log 'Server geholt werden soll.'
    exit 78
  fi

  VANILLA_ORDNER="${INTERN}/vanilla"
  mkdir -p "$VANILLA_ORDNER"
  SERVER_JAR="${VANILLA_ORDNER}/minecraft_server-${MINECRAFT_VANILLA_VERSION:-unbekannt}.jar"

  # Exit-Code 69 ist `EX_UNAVAILABLE`: Der Server ist in Ordnung, nur die Quelle
  # war nicht zu erreichen oder hat etwas Falsches geliefert. Unterscheidbar von
  # 78 (Konfiguration) und von einem Absturz.
  if ! palantir_datei_holen \
    "$MINECRAFT_VANILLA_URL" "$MINECRAFT_VANILLA_SHA256" "$SERVER_JAR"; then
    log 'Der Server von Mojang konnte nicht geholt werden. Der Start bricht ab;'
    log 'ein erneuter Start versucht es wieder.'
    exit 69
  fi
fi

# NeoForge hat keine einzelne Server-Jar: Der Start bindet die Argumentdatei
# ein, die das Installationsprogramm geschrieben hat (`@datei`), und `nogui`
# steht dahinter **ohne** Bindestriche – anders als bei allen anderen Ausgaben.
if [ "$AUSGABE" = 'neoforge' ]; then
  set -- "$@" "@${NEOFORGE_ARGUMENTE}" nogui
else
  set -- "$@" -jar "$SERVER_JAR" --nogui
fi

# -----------------------------------------------------------------------------
# 6. Konsole
#
# Ein Minecraft-Server liest Befehle von der Standardeingabe. `EXEC_CONSOLE`
# startet im Container aber einen eigenen Prozess ohne Verbindung dorthin – ein
# `docker exec` erreicht die Standardeingabe von PID 1 nicht. Der Prüfstand löst
# das über einen Steuerport; hier genügt ein benanntes Rohr, weil der Server
# ohnehin Zeilen von stdin erwartet.
#
# Das Anlegen selbst steht in der Wurzel (`palantir_konsole_oeffnen`): Es ist
# bei jedem Server gleich, der Befehle von der Standardeingabe liest. Die
# Funktion legt das Rohr an und öffnet es auf Deskriptor 3 – bewusst zum Lesen
# **und** Schreiben, sonst liefert es EOF, sobald der letzte Schreiber geht, und
# der Server hielte das für „Konsole beendet".
palantir_konsole_oeffnen

log "Startet Minecraft (${AUSGABE}): java $*"

# `exec` und `3>&-`: Die JVM wird PID 1 (bekommt SIGTERM direkt) und behält vom
# Rohr nur die Standardeingabe.
exec java "$@" 0<&3 3>&-
