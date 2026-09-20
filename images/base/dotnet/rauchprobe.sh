#!/bin/sh
#
# Rauchprobe für `base/dotnet`. Läuft nach der Standardprobe, im frisch gebauten
# Image, als 1000, ohne Netz (siehe `.github/rauchprobe-standard.sh`).
#
# .NET braucht `libicu` und `libssl`; ohne sie startet die Laufzeit nicht,
# sondern bricht mit „Couldn't find a valid ICU package" ab. Beim Bau läuft
# `dotnet --list-runtimes` als `root` – hier läuft es als 1000 und gegen ein
# schreibgeschütztes Wurzeldateisystem.

set -eu

if ! ausgabe="$(dotnet --list-runtimes 2>&1)"; then
  echo "FEHLER: dotnet --list-runtimes scheitert:" >&2
  echo "${ausgabe}" >&2
  exit 1
fi

erwartet="${PALANTIR_DOTNET_VERSION:-}"

if [ -z "${erwartet}" ]; then
  echo "FEHLER: PALANTIR_DOTNET_VERSION ist nicht gesetzt – das Image soll seine Fassung selbst nennen." >&2
  exit 1
fi

# Die Fassung im Image muss die sein, die das Dockerfile geholt hat. Weicht sie
# ab, zeigt `dotnet` auf eine andere Laufzeit als die geprüfte Prüfsumme.
if ! printf '%s\n' "${ausgabe}" | grep -q "Microsoft.NETCore.App ${erwartet}"; then
  echo "FEHLER: Microsoft.NETCore.App ${erwartet} steht nicht in der Liste:" >&2
  echo "${ausgabe}" >&2
  exit 1
fi

if [ "${DOTNET_ROOT:-}" != '/opt/dotnet' ]; then
  echo "FEHLER: DOTNET_ROOT ist '${DOTNET_ROOT:-}', erwartet /opt/dotnet." >&2
  exit 1
fi

echo "  .NET ${erwartet} läuft"
