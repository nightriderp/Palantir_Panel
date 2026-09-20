#!/bin/sh
#
# Rauchprobe für `base/steam`. Läuft nach der Standardprobe, im frisch gebauten
# Image, als 1000, ohne Netz (siehe `.github/rauchprobe-standard.sh`).
#
# **Ohne Netz lässt sich SteamCMD nicht starten** – sein erster Aufruf holt sich
# selbst nach. Geprüft wird deshalb das, was ohne Verbindung feststeht und
# erfahrungsgemäss schiefgeht: dass die 32-Bit-Binärdatei ihre Bibliotheken
# findet. `lib32gcc-s1` und `lib32stdc++6` sind der Grund, warum es dieses
# Basis-Image gibt; fehlt eines davon, endet SteamCMD auf der Node mit einem
# Loader-Fehler, den niemand einem Spiel zuordnet.

set -eu

if [ ! -x /opt/steamcmd/steamcmd.sh ]; then
  echo "FEHLER: /opt/steamcmd/steamcmd.sh fehlt oder ist nicht ausführbar." >&2
  exit 1
fi

binaerdatei='/opt/steamcmd/linux32/steamcmd'

if [ ! -x "${binaerdatei}" ]; then
  echo "FEHLER: ${binaerdatei} fehlt oder ist nicht ausführbar." >&2
  exit 1
fi

# `ldd` meldet fehlende Abhängigkeiten als „not found" und endet trotzdem mit 0.
fehlend="$(ldd "${binaerdatei}" 2>/dev/null | grep 'not found' || true)"

if [ -n "${fehlend}" ]; then
  echo "FEHLER: SteamCMD findet Bibliotheken nicht:" >&2
  echo "${fehlend}" >&2
  exit 1
fi

# Das Anmelde-Werkzeug für Spiele, deren Serverdateien ein Konto verlangen
# (ACC). Es wird von Hand auf der Node aufgerufen, also von einem Menschen –
# ein fehlendes Ausführungsrecht fällt dort besonders spät auf.
if [ ! -x /usr/local/bin/palantir-steam-anmelden ]; then
  echo "FEHLER: /usr/local/bin/palantir-steam-anmelden fehlt oder ist nicht ausführbar." >&2
  exit 1
fi

if ! sh -n /opt/palantir/lib/steam.sh; then
  echo "FEHLER: /opt/palantir/lib/steam.sh ist syntaktisch kaputt." >&2
  exit 1
fi

echo "  SteamCMD ist da, seine 32-Bit-Bibliotheken lösen auf"
