#!/bin/sh
#
# Startskript für tModLoader (`palantir-game-tmodloader`).
#
# tModLoader ist Terraria mit Mod-Loader: dasselbe `serverconfig.txt`, dieselbe
# Konsole über die Standardeingabe, dieselben Welten – aber ein eigenes
# Programm mit eigener Versionsfolge, eigener Laufzeit (.NET 8) und einem
# Mod-Ordner daneben. Im Panel steht es deshalb als eigene Ausgabe unter der
# Terraria-Kachel (`variantGroup`).
#
# **Der mitgelieferte Starter wird nicht benutzt.** `start-tModLoaderServer.sh`
# ist für Menschen an einer Tastatur geschrieben: Er fragt „Use steam server
# (y/n)" und wartet auf eine Antwort, er braucht bash, und über
# `LaunchUtils/InstallDotNet.sh` lädt er sich bei Bedarf eine eigene
# .NET-Laufzeit in den Ordner. Alle drei Eigenschaften sind hier falsch – es
# tippt niemand mit, das Wurzeldateisystem ist schreibgeschützt, und die
# Laufzeit steht im Image (`base/dotnet8`). Gestartet wird darum die DLL
# direkt, so wie jedes andere Palantir-Image seinen Server direkt startet.
set -eu

. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/dotnet.sh"

DATENORDNER="${PALANTIR_DATA_DIR:-/data}"
INTERN="${PALANTIR_INTERN:-${DATENORDNER}/.palantir}"

# Welten neben dem Programm, nicht darin: Eine neue Version ersetzt den
# Programmordner vollständig, und wer sichern will, sichert einen Ordner.
#
# **Derselbe Ordnername wie bei Terraria** (`welten`). Ein Spielstand, der von
# dort kommt, lässt sich damit übernehmen, ohne ihn zu verschieben – die
# Weltdateien sind dasselbe Format.
WELTEN="${DATENORDNER}/welten"
MODS="${DATENORDNER}/mods"
PROGRAMM="${INTERN}/tmodloader"

VERSION="${TMODLOADER_VERSION:-unbekannt}"
DLL="${PROGRAMM}/tModLoader.dll"

log() {
  palantir_log "$@"
}

palantir_intern_anlegen
mkdir -p "$WELTEN" "$MODS"

# -----------------------------------------------------------------------------
# 1. Das Programm holen
#
# Geholt wird nur, was fehlt. Steht die DLL schon da, passiert nichts – der
# zweite Start lädt also keine 61 MiB erneut. Das Archiv wird nach dem
# Auspacken weggeräumt; es wanderte sonst in jede Sicherung.
if [ ! -f "$DLL" ]; then
  if [ -z "${TMODLOADER_URL:-}" ] || [ -z "${TMODLOADER_SHA256:-}" ]; then
    log 'Es fehlen TMODLOADER_URL oder TMODLOADER_SHA256. Beide setzt das Image.'
    exit 78
  fi

  ARCHIV="${INTERN}/tmodloader-${VERSION}.zip"

  # Exit-Code 69 ist `EX_UNAVAILABLE`: Der Server ist in Ordnung, nur die
  # Quelle war nicht zu erreichen oder hat etwas Falsches geliefert.
  if ! palantir_datei_holen "$TMODLOADER_URL" "$TMODLOADER_SHA256" "$ARCHIV"; then
    log 'tModLoader konnte nicht geholt werden. Ein erneuter Start versucht es wieder.'
    exit 69
  fi

  if ! palantir_zip_auspacken "$ARCHIV" "$PROGRAMM"; then
    rm -f "$ARCHIV"
    exit 69
  fi

  rm -f "$ARCHIV"

  if [ ! -f "$DLL" ]; then
    log "Im Archiv steckt keine tModLoader.dll."
    log 'Stimmt TMODLOADER_URL?'
    exit 69
  fi
fi

# -----------------------------------------------------------------------------
# 2. serverconfig.txt
#
# Verwaltet werden genau die Schlüssel, für die es im Panel ein Feld gibt.
# Alles andere bleibt unangetastet (`palantir_schluessel_verschmelzen`).
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

# Terraria kennt Größe und Spielart nur als Zahl; im Panel stehen Wörter.
# Übersetzt wird hier, damit die Zahlen an einer Stelle stehen – wortgleich mit
# `game/terraria`, weil es dieselben Welten sind.
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
# Der Weg nach draußen führt durch den Tunnel; ein UPnP-Versuch aus dem
# Container ist bestenfalls wirkungslos.
setze 'upnp' '0'
setze 'secure' '1'
# Wo die Mods liegen. tModLoader sucht sie sonst unter `~/.local/share` – also
# ausserhalb des Datenordners und damit ausserhalb jeder Sicherung.
setze 'modpath' "$MODS"

ZIEL="${DATENORDNER}/serverconfig.txt"
palantir_schluessel_verschmelzen "$VERWALTET" "$ZIEL"

# -----------------------------------------------------------------------------
# 3. Umgebung für ein Programm, das eigentlich ein Spiel ist
#
# tModLoader ist dasselbe Programm wie der Client, nur mit `-server`. Es lädt
# darum SDL2, FNA3D und FAudio auch dann, wenn es nichts zu zeichnen gibt.
#
# `SDL_VIDEODRIVER=dummy` und `SDL_AUDIODRIVER=dummy` geben ihm Treiber, die
# nichts tun, statt es nach einem Bildschirm suchen zu lassen, den es im
# Container nicht gibt. Der Weg ist derselbe, den `base/proton` mit Xvfb geht –
# nur braucht es hier keinen X-Server, weil SDL die Attrappe selbst mitbringt.
#
# `FNA3D_FORCE_DRIVER=null` hält FNA von einem Grafiktreiber fern. Ohne die
# Angabe sucht es Vulkan oder OpenGL und bricht ab, wenn es keines findet.
: "${SDL_VIDEODRIVER:=dummy}"
: "${SDL_AUDIODRIVER:=dummy}"
: "${FNA3D_FORCE_DRIVER:=null}"
export SDL_VIDEODRIVER SDL_AUDIODRIVER FNA3D_FORCE_DRIVER

# Die nativen Bibliotheken liegen im Programmordner, nicht auf dem
# Systempfad – der Loader findet sie sonst nicht.
NATIVE="${PROGRAMM}/Libraries/Native/Linux"

if [ -d "$NATIVE" ]; then
  LD_LIBRARY_PATH="${NATIVE}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
  export LD_LIBRARY_PATH
fi

# Schreiborte von .NET in den Datenordner (`base/dotnet8`).
dotnet_vorbereiten

# tModLoader legt Logs, Mod-Zwischenspeicher und `enabled.json` unter einem
# eigenen Ordner ab. Ohne diese Angabe landet er unter `~/.local/share`, also
# im schreibgeschützten Teil.
TML_SAVE="${INTERN}/tmodloader-daten"
mkdir -p "$TML_SAVE"

# -----------------------------------------------------------------------------
# 4. Konsole
#
# Wie Terraria liest tModLoader Befehle von der Standardeingabe (`say`, `save`,
# `playing`, `exit`). Das Rohr legt die Wurzel an; `palantir-console` schreibt
# hinein.
palantir_konsole_oeffnen

set -- "$DLL" -server -config "$ZIEL" -tmlsavedirectory "$TML_SAVE" -nosteam

if [ -n "${PALANTIR_STARTUP_PARAMETERS:-}" ]; then
  # Absichtlich ohne Anführungszeichen: die Wortzerlegung ist der Zweck.
  # shellcheck disable=SC2086
  set -- "$@" ${PALANTIR_STARTUP_PARAMETERS}
fi

log "Startet tModLoader ${VERSION}: dotnet $*"

# -----------------------------------------------------------------------------
# 5. Starten und auf das Ende warten
#
# Der Server läuft im Hintergrund, damit diese Shell das Signal bekommt und
# darauf antworten kann. `0<&3` gibt ihm die Leseseite des Rohrs als
# Standardeingabe, `3>&-` nimmt ihm die Schreibseite – die behält die Shell, um
# `exit` hineinschreiben zu können.
beenden() {
  UNTERBROCHEN=1
  log 'Stoppsignal erhalten – schicke "exit" an die Konsole, damit die Welt gespeichert wird.'
  printf 'exit\n' >&3 || true
}

# Der Fang steht **vor** dem Start: Ein Signal, das in der Lücke dazwischen
# einträfe, beendete die Shell sonst kommentarlos.
trap beenden TERM INT

cd "$PROGRAMM"
dotnet "$@" 0<&3 3>&- &
SERVER_PID=$!

# `wait` kehrt zurück, sobald ein abgefangenes Signal eintrifft – mit 128 plus
# Signalnummer, auch wenn der Server noch läuft. Dann wird noch einmal
# gewartet: Das zweite `wait` liefert den echten Exit-Code, ob der Server noch
# läuft oder inzwischen fertig ist.
#
# **Nicht über `kill -0`** (Fundpunkt 337): Endet der Server, während der Fang
# läuft, ist er beim Nachsehen schon abgeräumt – die Schleife hielt dann die
# 143 des unterbrochenen `wait` fest statt der 0 des Servers. Ein sauberer
# Stopp sah aus wie ein Absturz.
ERGEBNIS=0
ERSTER_LAUF=1
while :; do
  UNTERBROCHEN=0

  if wait "$SERVER_PID"; then
    STATUS=0
  else
    STATUS=$?
  fi

  # 127 heisst beim zweiten Mal: schon abgeholt – dann gilt der Wert davor.
  if [ "$ERSTER_LAUF" = 1 ] || [ "$STATUS" -ne 127 ]; then
    ERGEBNIS=$STATUS
  fi

  ERSTER_LAUF=0

  if [ "$UNTERBROCHEN" = 1 ] && [ "$STATUS" -gt 128 ]; then
    continue
  fi

  break
done

exit "$ERGEBNIS"
