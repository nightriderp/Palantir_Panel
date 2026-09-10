#!/bin/sh
#
# Startskript des Terraria-Images.
#
# Vier Dinge, und drei davon haben einen Grund, der ohne diesen Text nicht zu
# erraten wäre:
#
#   1. Es holt die Serverdateien beim ersten Start in den Datenordner und packt
#      sie aus – Re-Logic gibt sie nicht zur Weitergabe frei, sie können also
#      nicht im Image liegen.
#   2. Es schreibt die vom Panel verwalteten Schlüssel in `serverconfig.txt`,
#      ohne die übrigen anzutasten.
#   3. Es legt die Welten neben die Serverdateien, nicht hinein.
#   4. Es fängt SIGTERM ab und schickt `exit` in die Konsole, statt sich vom
#      Signal beenden zu lassen.
#
# **Zu 4., der Abweichung von der Regel.** Jedes andere Spiel-Image ersetzt sich
# am Ende per `exec` durch den Serverprozess, damit kein Prozess zwischen Signal
# und Server steht (Pflichtenheft §2.3). Terraria speichert beim SIGTERM aber
# nicht: Der Prozess endet, und die Welt steht auf dem Stand des letzten
# selbsttätigen Speicherns – bis zu zehn Minuten Spielzeit weg, bei jedem Stopp
# und jedem Neustart. Gespeichert wird beim Konsolenbefehl `exit`.
#
# Deshalb bleibt hier eine Shell als PID 1 stehen, fängt das Signal ab, schickt
# `exit` in dasselbe Rohr, das auch `palantir-console` benutzt, und wartet auf
# das Ende des Servers. Die Kulanzzeit dafür kommt aus `stopTimeoutSeconds` der
# Spieltyp-Definition; läuft sie ab, kommt SIGKILL vom Docker-Daemon – dann ist
# es derselbe Verlust wie ohne diesen Umweg, aber eben erst dann.

set -eu

. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"

DATENORDNER="$PALANTIR_DATENORDNER"
INTERN="$PALANTIR_INTERN"

# Welten neben den Serverdateien, nicht darin: Eine neue Spielfassung ersetzt
# den Serverordner vollständig, und wer sichern will, sichert einen Ordner.
WELTEN="${DATENORDNER}/welten"
SERVER="${INTERN}/server"

BAU="${TERRARIA_BUILD:-1458}"
BINAERDATEI="${SERVER}/${BAU}/Linux/TerrariaServer.bin.x86_64"

log() {
  palantir_log "$@"
}

palantir_intern_anlegen
mkdir -p "$WELTEN"

# Terraria legt sonst `~/.local/share/Terraria` an – im Container gäbe es kein
# beschreibbares Zuhause, und in den Spielständen des Betreibers hat es nichts
# zu suchen.
HOME="$INTERN"
export HOME

# -----------------------------------------------------------------------------
# 1. Serverdateien
#
# Geholt wird nur, was fehlt. Steht die Binärdatei des angeforderten Baus schon
# da, passiert nichts – der zweite Start eines Servers lädt also nicht erneut.
# Das Archiv wird nach dem Auspacken weggeräumt: 46 MiB je Server, die nie
# wieder gebraucht werden und sonst in jede Sicherung wanderten.
if [ ! -x "$BINAERDATEI" ]; then
  if [ -z "${TERRARIA_URL:-}" ] || [ -z "${TERRARIA_SHA256:-}" ]; then
    log 'Es fehlen TERRARIA_URL oder TERRARIA_SHA256. Beide setzt das Image.'
    exit 78
  fi

  ARCHIV="${INTERN}/terraria-server-${BAU}.zip"

  # Exit-Code 69 ist `EX_UNAVAILABLE`: Der Server ist in Ordnung, nur die Quelle
  # war nicht zu erreichen oder hat etwas Falsches geliefert.
  if ! palantir_datei_holen "$TERRARIA_URL" "$TERRARIA_SHA256" "$ARCHIV"; then
    log 'Die Serverdateien konnten nicht geholt werden. Ein erneuter Start versucht es wieder.'
    exit 69
  fi

  if ! palantir_zip_auspacken "$ARCHIV" "$SERVER"; then
    rm -f "$ARCHIV"
    exit 69
  fi

  rm -f "$ARCHIV"

  if [ ! -f "$BINAERDATEI" ]; then
    log "Im Archiv steckt kein ${BAU}/Linux/TerrariaServer.bin.x86_64."
    log 'Stimmt TERRARIA_BUILD zu TERRARIA_URL?'
    exit 69
  fi

  # Das Ausführungsbit überlebt den Weg durch ein Zip nicht zuverlässig.
  chmod 0755 "$BINAERDATEI"
fi

# -----------------------------------------------------------------------------
# 2. serverconfig.txt
#
# Verwaltet werden genau die Schlüssel, für die es im Panel ein Feld gibt.
# Alles andere – `npcstream`, `priority`, was der Betreiber sonst gesetzt hat –
# bleibt unangetastet (`palantir_schluessel_verschmelzen` in der Wurzel).
VERWALTET="${INTERN}/verwaltete.txt"
: > "$VERWALTET"

setze() {
  palantir_eigenschaft "$VERWALTET" "$1" "$2"
}

WELTNAME="${TERRARIA_WORLD:-Palantir}"

setze 'port' "${SERVER_PORT:-7777}"
setze 'maxplayers' "${MAX_PLAYERS:-8}"
setze 'motd' "${MOTD:-Ein Palantir-Server}"
setze 'password' "${TERRARIA_PASSWORD:-}"
setze 'worldname' "$WELTNAME"
setze 'worldpath' "$WELTEN"
# Ohne `world` legte der Server bei jedem Start eine neue Welt an; mit `world`
# und `autocreate` zusammen erzeugt er sie einmal und öffnet danach dieselbe.
setze 'world' "${WELTEN}/${WELTNAME}.wld"
# Terraria kennt die Größe und die Spielart nur als Zahl. Im Panel stehen
# Wörter – ein Auswahlfeld mit „1, 2, 3" wäre für den Betreiber nicht zu
# entziffern. Übersetzt wird hier, damit die Zahlen an einer Stelle stehen.
case "${TERRARIA_SIZE:-mittel}" in
  klein) GROESSE=1 ;;
  mittel) GROESSE=2 ;;
  groß | gross) GROESSE=3 ;;
  1 | 2 | 3) GROESSE="$TERRARIA_SIZE" ;;
  *)
    log "Unbekannte Weltgröße: ${TERRARIA_SIZE}. Erlaubt sind klein, mittel, groß."
    exit 78
    ;;
esac

case "${TERRARIA_DIFFICULTY:-klassisch}" in
  klassisch) SPIELART=0 ;;
  experte) SPIELART=1 ;;
  meister) SPIELART=2 ;;
  reise) SPIELART=3 ;;
  0 | 1 | 2 | 3) SPIELART="$TERRARIA_DIFFICULTY" ;;
  *)
    log "Unbekannte Spielart: ${TERRARIA_DIFFICULTY}. Erlaubt sind klassisch, experte, meister, reise."
    exit 78
    ;;
esac

setze 'autocreate' "$GROESSE"
setze 'difficulty' "$SPIELART"
setze 'seed' "${TERRARIA_SEED:-}"
# Terraria versucht sonst, sich am Heimrouter eine Portweiterleitung
# einzurichten. Der Weg nach draußen führt hier durch den Tunnel; ein
# UPnP-Versuch aus dem Container ist bestenfalls wirkungslos.
setze 'upnp' '0'
# Schutz gegen bekannte Angriffe im Protokoll. Kostet nichts.
setze 'secure' '1'

ZIEL="${DATENORDNER}/serverconfig.txt"
palantir_schluessel_verschmelzen "$VERWALTET" "$ZIEL"

# -----------------------------------------------------------------------------
# 3. Konsole
#
# Terraria liest Befehle von der Standardeingabe (`say`, `save`, `playing`,
# `exit`). Das Rohr legt die Wurzel an; `palantir-console` schreibt hinein.
palantir_konsole_oeffnen

set -- -config "$ZIEL"

if [ -n "${PALANTIR_STARTUP_PARAMETERS:-}" ]; then
  # Absichtlich ohne Anführungszeichen: die Wortzerlegung ist der Zweck.
  # shellcheck disable=SC2086
  set -- "$@" ${PALANTIR_STARTUP_PARAMETERS}
fi

log "Startet Terraria (Bau ${BAU}): TerrariaServer $*"

# -----------------------------------------------------------------------------
# 4. Starten und auf das Ende warten
#
# Der Server läuft im Hintergrund, damit diese Shell das Signal bekommt und
# darauf antworten kann. `0<&3` gibt ihm die Leseseite des Rohrs als
# Standardeingabe, `3>&-` nimmt ihm die Schreibseite – die behält die Shell, um
# `exit` hineinschreiben zu können.
beenden() {
  log 'Stoppsignal erhalten – schicke "exit" an die Konsole, damit die Welt gespeichert wird.'
  printf 'exit\n' >&3 || true
}

# Der Fang steht **vor** dem Start: Ein Signal, das in der Lücke dazwischen
# einträfe, beendete die Shell sonst kommentarlos.
trap beenden TERM INT

"$BINAERDATEI" "$@" 0<&3 3>&- &
SERVER_PID=$!

# `wait` kehrt zurück, sobald ein abgefangenes Signal eintrifft – auch wenn der
# Server noch läuft. Deshalb die Schleife: Sie wartet weiter, bis der Prozess
# wirklich weg ist, und hält den Exit-Code des Servers fest.
ERGEBNIS=0
while kill -0 "$SERVER_PID" 2> /dev/null; do
  if wait "$SERVER_PID"; then
    ERGEBNIS=0
  else
    ERGEBNIS=$?
  fi
done

exit "$ERGEBNIS"
