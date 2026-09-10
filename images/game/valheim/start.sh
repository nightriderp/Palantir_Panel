#!/bin/sh
#
# Startskript des Valheim-Images.
#
# Vier Dinge, jedes mit einem Grund, der ohne diesen Text nicht zu erraten wäre:
#
#   1. Es holt die Serverdateien über SteamCMD in den Datenordner.
#   2. Es prüft das Passwort, bevor der Server es tut – Valheim beendet sich
#      sonst kommentarlos.
#   3. Es trennt Serverdateien und Spielstände: Die einen holt SteamCMD, die
#      anderen gehören dem Betreiber.
#   4. Es legt das Rohr für `palantir-console` an, obwohl Valheim keine Befehle
#      von der Standardeingabe liest – so verhält sich das Image wie alle
#      anderen, und die Konsole meldet ehrlich, dass nichts ankommt.
#
# Danach ersetzt es sich per `exec` durch den Server: kein Benutzerwechsel,
# keine Shell zwischen Signal und Server (Pflichtenheft §2.3).

set -eu

# Die gemeinsamen Bausteine: Orte im Datenordner, Konsolen-Rohr, Log.
# `PALANTIR_LIB_DIR` existiert, damit `start.test.mjs` die Bibliotheken aus dem
# Repository einbinden kann, wo es `/opt/palantir` nicht gibt.
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/steam.sh"

# Anwendungsnummer des dedizierten Servers bei Valve. Die des Spiels selbst
# (892970) steht weiter unten und ist etwas anderes.
VALHEIM_ANWENDUNG=896660

# **Serverdateien und Spielstände liegen getrennt.** SteamCMD räumt in seinem
# Ordner auf; alles, was dem Betreiber gehört, hat dort nichts zu suchen. Die
# Welten stehen deshalb daneben und überleben jede Neuinstallation.
SERVER="${PALANTIR_DATENORDNER}/server"
WELTEN="${PALANTIR_DATENORDNER}/welten"

palantir_intern_anlegen
mkdir -p "$WELTEN"

# -----------------------------------------------------------------------------
# 1. Serverdateien
# -----------------------------------------------------------------------------
steam_app_holen "$VALHEIM_ANWENDUNG" "$SERVER"

BINAERDATEI="${SERVER}/valheim_server.x86_64"

if [ ! -x "$BINAERDATEI" ]; then
  palantir_log "Der Server fehlt oder ist nicht ausführbar: ${BINAERDATEI}"
  palantir_log 'Den Ordner "server" im Datenordner löschen und neu starten holt ihn erneut.'
  exit 78
fi

# -----------------------------------------------------------------------------
# 2. Passwort
# -----------------------------------------------------------------------------
# Valheim stellt drei Bedingungen und beendet sich sonst mit einer Zeile, die
# im Log leicht untergeht. Besser hier, mit einem Exit-Code, den man ansieht:
# 78 ist `EX_CONFIG` aus `sysexits.h`, „die Konfiguration stimmt nicht".
NAME="${VALHEIM_NAME:-Ein Palantir-Server}"
WELT="${VALHEIM_WORLD:-Dedicated}"
PASSWORT="${VALHEIM_PASSWORD:-}"
OEFFENTLICH="${VALHEIM_PUBLIC:-false}"
PORT="${VALHEIM_PORT:-2456}"

if [ -z "$PASSWORT" ]; then
  palantir_log 'Der Server startet nicht: Valheim verlangt ein Passwort.'
  palantir_log 'Im Panel unter Einstellungen eines setzen, mindestens fünf Zeichen.'
  exit 78
fi

if [ "${#PASSWORT}" -lt 5 ]; then
  palantir_log 'Der Server startet nicht: Das Passwort braucht mindestens fünf Zeichen.'
  exit 78
fi

# Valheim lehnt ein Passwort ab, das im Servernamen oder im Weltnamen steckt –
# es stünde sonst in der Serverliste.
case "$NAME" in
*"$PASSWORT"*)
  palantir_log 'Der Server startet nicht: Das Passwort steht im Servernamen.'
  exit 78
  ;;
esac

case "$WELT" in
*"$PASSWORT"*)
  palantir_log 'Der Server startet nicht: Das Passwort steht im Weltnamen.'
  exit 78
  ;;
esac

# -----------------------------------------------------------------------------
# 3. Umgebung des Servers
# -----------------------------------------------------------------------------
# `SteamAppId` ist die Nummer des **Spiels**, nicht die des Servers. Ohne sie
# startet der Server nicht; das ist eine Eigenheit von Valheim.
SteamAppId=892970
export SteamAppId

# Der Server bringt seine eigenen Bibliotheken mit und findet sie nur über
# diesen Pfad.
LD_LIBRARY_PATH="${SERVER}/linux64${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
export LD_LIBRARY_PATH

# -----------------------------------------------------------------------------
# 4. Konsole
# -----------------------------------------------------------------------------
# Valheim liest keine Befehle von der Standardeingabe und kennt kein RCON. Das
# Rohr entsteht trotzdem: Der Anschluss verhält sich dann wie bei jedem anderen
# Spiel, und `palantir-console` meldet ehrlich „übergeben", statt an einem
# fehlenden Rohr mit „nicht erreichbar" zu scheitern.
palantir_konsole_oeffnen

set -- -nographics -batchmode \
  -name "$NAME" \
  -port "$PORT" \
  -world "$WELT" \
  -password "$PASSWORT" \
  -savedir "$WELTEN"

if [ "$OEFFENTLICH" = 'true' ]; then
  set -- "$@" -public 1
else
  set -- "$@" -public 0
fi

# Startparameter des Betreibers (`PALANTIR_STARTUP_PARAMETERS`, siehe
# `container-spec.ts`). Sie kommen als **eine** Zeichenkette an, weil das
# Backend freien Text bewusst nicht selbst zerlegt. Hier zerfällt sie an
# Leerzeichen; Anführungszeichen werden dabei nicht ausgewertet.
if [ -n "${PALANTIR_STARTUP_PARAMETERS:-}" ]; then
  # Absichtlich ohne Anführungszeichen: die Wortzerlegung ist der Zweck.
  # shellcheck disable=SC2086
  set -- "$@" ${PALANTIR_STARTUP_PARAMETERS}
fi

palantir_log "Startet Valheim: Welt ${WELT} auf Port ${PORT}, oeffentlich: ${OEFFENTLICH}"

# `exec` und `3>&-`: Der Server wird PID 1 (bekommt SIGTERM direkt und speichert
# die Welt) und behält vom Rohr nur die Standardeingabe.
exec "$BINAERDATEI" "$@" 0<&3 3>&-
