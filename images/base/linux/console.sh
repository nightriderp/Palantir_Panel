#!/bin/sh
#
# Konsolen-Anschluss für Spielserver, die Befehle von der Standardeingabe lesen
# (`palantir-console`, Teil von `palantir-base-linux`).
#
# `EXEC_CONSOLE` startet im Container einen Befehl **ohne Shell und ohne
# Standardeingabe**; die Zeile aus der Panel-Konsole wird an Leerzeichen zerlegt
# und als Argumentliste übergeben (siehe `execConsole()` in
# `apps/backend/src/modules/server-orchestration/service.ts`). Der Betreiber
# tippt also:
#
#     palantir-console list
#     palantir-console say Wartungsarbeiten in 5 Minuten
#     palantir-console stop
#
# Der Befehl geht in das benannte Rohr, das das Startskript über
# `palantir_konsole_oeffnen` angelegt hat und das die Standardeingabe des
# Servers ist. Er wird damit wirklich ausgeführt, nicht nur entgegengenommen.
#
# **Die Antwort steht im Log, nicht hier.** Ein Server, der auf seiner Konsole
# antwortet, schickt nichts an den Absender zurück – wer `list` schickt, sieht
# das Ergebnis in der Live-Ausgabe des Panels eine Zeile später. Spiele mit RCON
# gehen diesen Weg gar nicht erst: Dort spricht der Agent den Server direkt an
# und bekommt die Antwort (`GameTypeDefinition.console`, Pflichtenheft §11).
# Dieser Weg bleibt für alles ohne RCON – und für den Betreiber, der von Hand
# `docker exec` macht.
#
# **Exit-Codes** (wie beim Prüfstand, `images/test/minecraft/console.mjs`):
# 0, wenn der Befehl übergeben wurde; 1, wenn die Konsole nicht erreichbar ist
# oder das Schreiben scheitert; 2, wenn gar kein Befehl übergeben wurde.

set -eu

DATENORDNER="${PALANTIR_DATA_DIR:-/data}"
KONSOLE="${DATENORDNER}/.palantir/console.in"

if [ "$#" -eq 0 ]; then
  echo 'Aufruf: palantir-console <befehl>, zum Beispiel "palantir-console list".' >&2
  exit 2
fi

if [ ! -p "$KONSOLE" ]; then
  echo 'Die Konsole ist nicht erreichbar – läuft der Server?' >&2
  exit 1
fi

# Über `timeout`, weil das Öffnen eines Rohrs zum Schreiben blockiert, solange
# niemand liest. Bleibt nach einem abgestürzten Server ein Rohr ohne Leser
# zurück, hinge dieser Aufruf sonst endlos – und mit ihm der `docker exec` des
# Agents und die Konsole im Browser.
if ! timeout 5 sh -c 'printf "%s\n" "$1" > "$2"' _ "$*" "$KONSOLE"; then
  echo 'Der Server nimmt gerade keine Befehle an; der Befehl wurde verworfen.' >&2
  exit 1
fi

printf 'An den Server übergeben: %s\n' "$*"
printf 'Die Antwort des Servers steht in der Live-Ausgabe.\n'
