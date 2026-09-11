#!/bin/sh
#
# Startskript des Vintage-Story-Images.
#
# Das erste Spiel ohne Steam und ohne Java: Vintage Story wird beim Hersteller
# heruntergeladen und läuft auf .NET. Der Ablauf:
#
#   1. Serverdateien holen und gegen eine SHA-256 prüfen (`palantir.sh`).
#   2. Die Schreiborte setzen, die .NET erwartet (`dotnet.sh`).
#   3. Starten – die Einstellungen des Panels gehen als `--withconfig` auf die
#      Befehlszeile, **nicht** in die `serverconfig.json`.
#   4. Beim Stoppen `/stop` in die Konsole, damit die Welt gespeichert wird.
#
# **Warum `--withconfig` und keine geschriebene Datei:** In der
# `serverconfig.json` stehen auch Dinge, die dem Betreiber gehören – Rollen,
# Rechte, Zugangsliste, alles, was er im Spiel gesetzt hat. Ein Startskript, das
# sie bei jedem Start neu schreibt, räumte das weg. `--withconfig` legt die
# Werte des Panels für diesen Lauf darüber und lässt die Datei in Ruhe.

set -eu

. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/dotnet.sh"

# Fassung und Prüfsumme gehören zusammen und werden gemeinsam getauscht; die
# Quelle ist `https://api.vintagestory.at/stable-unstable.json`, Eintrag
# `linuxserver`. Wer sie ändert, erhöht `VERSION`.
VS_FASSUNG="${PALANTIR_VS_VERSION:-1.22.7}"
VS_QUELLE="${PALANTIR_VS_URL:-https://cdn.vintagestory.at/gamefiles/stable/vs_server_linux-x64_1.22.7.tar.gz}"
VS_SHA256="${PALANTIR_VS_SHA256:-a7d4a520604590a96de812ee6c6baf4404d43d86cf1ec4fbac1b3a580b52c847}"

SERVER="${PALANTIR_DATENORDNER}/server"
# `--dataPath`: Darunter liegen Welt, Spielstände, Log und die
# `serverconfig.json`. Alles davon gehört dem Betreiber.
WELTEN="${PALANTIR_DATENORDNER}/welten"

log() {
  palantir_log "$@"
}

palantir_intern_anlegen
mkdir -p "$WELTEN"

# -----------------------------------------------------------------------------
# 1. Serverdateien
#
# **Warum nicht ins Image:** Vintage Story ist ein gekauftes Spiel. Die
# Serverdateien sind frei herunterzuladen, aber sie weiterzugeben ist etwas
# anderes – dieselbe Überlegung wie bei der Minecraft-Jar von Mojang. Sie werden
# deshalb beim ersten Start geholt und gegen eine feste Prüfsumme geprüft.
ARCHIV="${PALANTIR_INTERN}/vs_server_${VS_FASSUNG}.tar.gz"
BINAERDATEI="${SERVER}/VintagestoryServer.dll"

if [ ! -f "$BINAERDATEI" ]; then
  log "Serverdateien fehlen – hole Vintage Story ${VS_FASSUNG}."
  palantir_datei_holen "$VS_QUELLE" "$VS_SHA256" "$ARCHIV"
  # Das Archiv trägt keinen obersten Ordner: Es packt direkt in das Ziel aus.
  palantir_tar_auspacken "$ARCHIV" "$SERVER"
  # Das Archiv wird nicht aufgehoben: Es wiegt fünfzig Megabyte und wird nur
  # noch gebraucht, wenn jemand den Serverordner löscht – dann lädt es neu.
  rm -f "$ARCHIV"
fi

if [ ! -f "$BINAERDATEI" ]; then
  log "Der Server fehlt: ${BINAERDATEI}"
  log 'Den Ordner "server" im Datenordner löschen und neu starten holt ihn erneut.'
  exit 78
fi

# -----------------------------------------------------------------------------
# 2. .NET
dotnet_vorbereiten

# -----------------------------------------------------------------------------
# 3. Die Einstellungen des Panels
#
# `json_text` maskiert, was ein JSON-Text nicht verträgt. Ohne das zerbräche ein
# Anführungszeichen im Servernamen die Angabe, und der Server startete mit dem,
# was in seiner Datei steht – also ohne Passwort.
json_text() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\r//g' | tr -d '\n'
}

json_schalter() {
  case "$1" in
    true | TRUE | True | 1 | ja | yes | on) printf 'true' ;;
    *) printf 'false' ;;
  esac
}

PORT="${SERVER_PORT:-42420}"

# Der Server meldet sich beim Verzeichnis des Herstellers an. Das ist eine
# Entscheidung des Betreibers und keine Bedingung: Ein Server ohne Eintrag ist
# erreichbar, wer die Adresse hat, spielt.
OEFFENTLICH="$(json_schalter "${VS_PUBLIC:-false}")"

EINSTELLUNGEN="$(
  printf '{'
  printf '"ServerName":"%s",' "$(json_text "${VS_NAME:-Ein Palantir-Server}")"
  printf '"ServerDescription":"%s",' "$(json_text "${VS_DESCRIPTION:-}")"
  printf '"Password":"%s",' "$(json_text "${VS_PASSWORD:-}")"
  printf '"MaxClients":%s,' "${MAX_PLAYERS:-16}"
  printf '"Port":%s,' "$PORT"
  printf '"AdvertiseServer":%s,' "$OEFFENTLICH"
  # Das Panel legt die Weiterleitung selbst an; ein Server, der nebenbei am
  # Heimrouter Löcher bohrt, widerspräche dem Lastenheft.
  printf '"Upnp":false,'
  printf '"WelcomeMessage":"%s"' "$(json_text "${VS_WELCOME:-}")"
  printf '}'
)"

# -----------------------------------------------------------------------------
# 4. Konsole
#
# Vintage Story liest Befehle von der Standardeingabe – dieselben, die ein
# Administrator im Spiel tippt (`/list clients`, `/announce`, `/stop`).
palantir_konsole_oeffnen

set -- --dataPath "$WELTEN" --withconfig "$EINSTELLUNGEN"

if [ -n "${PALANTIR_STARTUP_PARAMETERS:-}" ]; then
  # Absichtlich ohne Anführungszeichen: die Wortzerlegung ist der Zweck.
  # shellcheck disable=SC2086
  set -- "$@" ${PALANTIR_STARTUP_PARAMETERS}
fi

log "Startet Vintage Story ${VS_FASSUNG} auf Port ${PORT}"

cd "$SERVER"

# -----------------------------------------------------------------------------
# 5. Starten und auf das Ende warten
#
# **Kein `exec`.** Vintage Story speichert die Welt beim Befehl `/stop`; auf ein
# nacktes SIGTERM ist kein Verlass. Die Shell bleibt deshalb als PID 1 stehen,
# fängt das Signal ab und schickt den Befehl in das Rohr – wie bei Terraria und
# Project Zomboid.
beenden() {
  log 'Stoppsignal erhalten – schicke "/stop" an die Konsole, damit die Welt gespeichert wird.'
  printf '/stop\n' >&3 || true
}

# Der Fang steht **vor** dem Start: Ein Signal, das in der Lücke dazwischen
# einträfe, beendete die Shell sonst kommentarlos.
trap beenden TERM INT

dotnet "$BINAERDATEI" "$@" 0<&3 3>&- &
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
