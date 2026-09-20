#!/bin/sh
#
# Startskript des Minecraft-Bedrock-Images.
#
# Vier Dinge, und drei davon haben einen Grund, der ohne diesen Text nicht zu
# erraten wäre:
#
#   1. Es holt die Serverdateien beim ersten Start – Mojang gibt sie nicht zur
#      Weitergabe frei, sie können also nicht im Image liegen.
#   2. Es legt die Serverdateien **intern** ab und verweist von dort auf die
#      Spielstände im Datenordner.
#   3. Es schreibt die vom Panel verwalteten Schlüssel in `server.properties`,
#      ohne die übrigen anzutasten.
#   4. Es ersetzt sich am Ende durch den Serverprozess (`exec`).
#
# **Zu 2., der Aufteilung.** Bedrock kennt keinen Schalter für den Ort der
# Welten: Der Server sucht sie unter `worlds/` neben seinem Programm. Läge das
# Programm im Datenordner, wanderten bei jeder Fassung achtzig Megabyte
# Ressourcenpakete in jede Sicherung, und ein Fassungswechsel schriebe mitten
# in die Spielstände. Das Programm liegt deshalb unter `.palantir/server`, und
# `worlds`, `allowlist.json` und `permissions.json` sind Verweise auf den
# Datenordner. Gesichert wird damit genau das, was der Betreiber verloren
# geben würde.
#
# **Zu 4., warum hier `exec` richtig ist.** Bedrock speichert beim Stoppsignal
# selbst (anders als Terraria, siehe dort): Der Server schreibt die Welt und
# beendet sich. Es braucht also keine Shell, die dazwischensteht – und ohne sie
# geht das Signal ohne Umweg an den Server (Pflichtenheft §2.3).

set -eu

. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"

DATENORDNER="$PALANTIR_DATENORDNER"
INTERN="$PALANTIR_INTERN"

FASSUNG="${BEDROCK_VERSION:-unbekannt}"
SERVER="${INTERN}/server/${FASSUNG}"
PROGRAMM="${SERVER}/bedrock_server"

log() {
  palantir_log "$@"
}

palantir_intern_anlegen

# -----------------------------------------------------------------------------
# 1. Serverdateien
#
# Geholt wird nur, was fehlt. Steht das Programm der angeforderten Fassung
# schon da, passiert nichts – der zweite Start lädt also nicht erneut. Das
# Archiv wird nach dem Auspacken weggeräumt: neunzig Megabyte je Server, die
# nie wieder gebraucht werden.
if [ ! -x "$PROGRAMM" ]; then
  if [ -z "${BEDROCK_URL:-}" ] || [ -z "${BEDROCK_SHA256:-}" ]; then
    log 'Es fehlen BEDROCK_URL oder BEDROCK_SHA256. Beide setzt das Image.'
    exit 78
  fi

  ARCHIV="${INTERN}/bedrock-server-${FASSUNG}.zip"

  # Exit-Code 69 ist `EX_UNAVAILABLE`: Der Server ist in Ordnung, nur die
  # Quelle war nicht zu erreichen oder hat etwas Falsches geliefert.
  if ! palantir_datei_holen "$BEDROCK_URL" "$BEDROCK_SHA256" "$ARCHIV"; then
    log 'Die Serverdateien konnten nicht geholt werden. Ein erneuter Start versucht es wieder.'
    exit 69
  fi

  if ! palantir_zip_auspacken "$ARCHIV" "$SERVER"; then
    rm -f "$ARCHIV"
    exit 69
  fi

  rm -f "$ARCHIV"

  if [ ! -f "$PROGRAMM" ]; then
    log "Im Archiv steckt kein bedrock_server."
    log 'Stimmt BEDROCK_URL zur angegebenen Fassung?'
    exit 69
  fi

  # Das Ausführungsbit überlebt den Weg durch ein Zip nicht zuverlässig.
  chmod 0755 "$PROGRAMM"
fi

# -----------------------------------------------------------------------------
# 2. Spielstände und Listen in den Datenordner verweisen
#
# Die Verweise werden bei jedem Start neu gesetzt: Ein Fassungswechsel legt
# einen neuen Serverordner an, und der hätte sonst wieder seine eigenen leeren
# Ordner. Bestehende Ziele bleiben unangetastet.
mkdir -p "${DATENORDNER}/worlds"

verweise() {
  quelle="${DATENORDNER}/$1"
  ziel="${SERVER}/$1"

  # Eine Datei, die der Server erwartet, aber noch niemand angelegt hat: mit
  # dem Inhalt aus dem Archiv beginnen, damit das Format stimmt.
  if [ ! -e "$quelle" ] && [ -f "$ziel" ] && [ ! -L "$ziel" ]; then
    cp "$ziel" "$quelle"
  fi

  rm -rf "$ziel"
  ln -s "$quelle" "$ziel"
}

verweise 'worlds'
verweise 'allowlist.json'
verweise 'permissions.json'

# -----------------------------------------------------------------------------
# 3. server.properties
#
# Verwaltet werden genau die Schlüssel, für die es im Panel ein Feld gibt.
# Alles andere – `view-distance`, `tick-distance`, was der Betreiber sonst
# gesetzt hat – bleibt unangetastet (`palantir_schluessel_verschmelzen`).
VERWALTET="${INTERN}/verwaltete.txt"
: > "$VERWALTET"

setze() {
  palantir_eigenschaft "$VERWALTET" "$1" "$2"
}

setze 'server-name' "${MOTD:-Ein Palantir-Server}"
setze 'server-port' "${SERVER_PORT:-19132}"
# Der zweite Port gehört zu IPv6. Er steht fest neben dem ersten, weil der
# Server sonst den Vorgabewert nimmt – und der kollidierte mit dem Nachbarn
# auf derselben Node.
setze 'server-portv6' "$((${SERVER_PORT:-19132} + 1))"
setze 'max-players' "${MAX_PLAYERS:-10}"
setze 'gamemode' "${BEDROCK_GAMEMODE:-survival}"
setze 'difficulty' "${BEDROCK_DIFFICULTY:-easy}"
setze 'allow-cheats' "${BEDROCK_ALLOW_CHEATS:-false}"
setze 'level-name' "${BEDROCK_LEVEL_NAME:-Palantir}"
setze 'level-seed' "${BEDROCK_SEED:-}"
# Ohne Konto-Prüfung käme jeder mit jedem Namen herein – auch mit dem eines
# Spielers, der hier schon Rechte hat.
setze 'online-mode' 'true'

ZIEL="${SERVER}/server.properties"
palantir_schluessel_verschmelzen "$VERWALTET" "$ZIEL"

# -----------------------------------------------------------------------------
# 4. Konsole
#
# Bedrock liest Befehle von der Standardeingabe (`list`, `say`, `stop`). Das
# Rohr legt die Wurzel an; `palantir-console` schreibt hinein.
palantir_konsole_oeffnen

# Der Server sucht seine Ressourcenpakete relativ zum Arbeitsverzeichnis.
cd "$SERVER"

# Bedrock bringt seine Bibliotheken im eigenen Ordner mit.
LD_LIBRARY_PATH="${SERVER}:${LD_LIBRARY_PATH:-}"
export LD_LIBRARY_PATH

set --

if [ -n "${PALANTIR_STARTUP_PARAMETERS:-}" ]; then
  # Absichtlich ohne Anführungszeichen: die Wortzerlegung ist der Zweck.
  # shellcheck disable=SC2086
  set -- ${PALANTIR_STARTUP_PARAMETERS}
fi

log "Startet Minecraft Bedrock (Fassung ${FASSUNG}) auf Port ${SERVER_PORT:-19132}/udp"

exec "$PROGRAMM" "$@"
