# Basis-Image für Spielserver auf .NET 8 (`palantir-base-dotnet8`).
#
# **Warum neben `base/dotnet` und nicht darin.** images/README.md legt fest: eine
# Hauptfassung der Laufzeit je Basis-Image, und wer eine andere braucht, bekommt
# ein Basis-Image daneben — keinen Schalter. Genau dieser Fall ist eingetreten:
# `base/dotnet` trägt .NET 10, tModLoader verlangt in seiner
# `tModLoader.runtimeconfig.json` ausdrücklich
#
#     "framework": { "name": "Microsoft.NETCore.App", "version": "8.0.0" }
#
# Ein .NET-8-Programm läuft auf einer .NET-10-Laufzeit nur mit
# `--roll-forward Major`. tModLoader selbst tut das nicht: Sein Startskript holt
# punktgenau die Fassung aus der `runtimeconfig.json`. Etwas auszuliefern, das
# der Hersteller so nicht vorsieht — bei einem Spiel mit reichlich nativer
# Anbindung (FNA, SDL2, FAudio) —, wäre eine Wette ohne Not.
#
# **Was hier gleich ist wie bei `base/dotnet`:** die Wurzel, die beiden Pakete,
# die .NET außer sich selbst braucht, und `dotnet.sh`. Die Datei ist bewusst
# eine Kopie und kein geteilter Pfad: Die beiden Basen haben verschiedene
# Fassungen und verschiedene Lebensläufe, und ein gemeinsames Stück Shell
# zwänge die eine bei jeder Änderung der anderen zu einer neuen Fassung.
#
# **Warum ein Digest für Ubuntu, aber ein Tag für die Wurzel:** `base/linux:<n>`
# wird nie überschrieben (spiel-image-bauen.yml) — hinter dem Tag steht für
# immer derselbe Inhalt. Die Wurzel pinnt Ubuntu ihrerseits per Digest.
ARG BASIS=ghcr.io/nightriderp/palantir-base-linux:3

# -----------------------------------------------------------------------------
# Stufe 1: Die Laufzeit holen und die Prüfsumme prüfen.
#
# Fassung und Summe sind am 2026-09-21 gegen
# `dotnetcli.blob.core.windows.net/dotnet/release-metadata/8.0/releases.json`
# geholt und die Datei selbst gerechnet — nicht aus einer Anleitung abgeschrieben.
#
# Neue Fassung holen:
#
#   curl -s https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/8.0/releases.json \
#     | jq -r '."latest-release"'
#   curl -sL <url> | sha512sum
FROM ${BASIS} AS laufzeit
USER root

ARG DOTNET_VERSION=8.0.31
ARG DOTNET_URL=https://builds.dotnet.microsoft.com/dotnet/Runtime/8.0.31/dotnet-runtime-8.0.31-linux-x64.tar.gz
ARG DOTNET_SHA512=f336bdec58d54bf50d74a1b38efa82f7290d976bd2ed98b845ebcbac42cf0d8cef504684fc088d4b05f98737b996bf3302e52bd9c23005deae7c60780b2652fb

RUN set -eux; \
  curl --fail --silent --show-error --location --retry 3 --output /dotnet.tar.gz "${DOTNET_URL}"; \
  echo "${DOTNET_SHA512}  /dotnet.tar.gz" | sha512sum --check --strict -; \
  mkdir -p /opt/dotnet; \
  tar --extract --file /dotnet.tar.gz --directory /opt/dotnet; \
  rm -f /dotnet.tar.gz; \
  test -x /opt/dotnet/dotnet

# -----------------------------------------------------------------------------
# Stufe 2: Das Laufzeit-Image.
#
# `curl` und `tar` aus Stufe 1 bleiben dort; hierher kommt nur die entpackte
# Laufzeit.
FROM ${BASIS}
USER root

# `libicu` für die Kulturdaten, ohne die .NET mit „Couldn't find a valid ICU
# package" abbricht, und `libssl` für alles Verschlüsselte.
RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends libicu74 libssl3t64; \
  rm -rf /var/lib/apt/lists/*

COPY --from=laufzeit /opt/dotnet /opt/dotnet
COPY dotnet.sh /opt/palantir/lib/dotnet.sh

RUN set -eux; \
  chmod 0444 /opt/palantir/lib/dotnet.sh; \
  ln -s /opt/dotnet/dotnet /usr/local/bin/dotnet; \
  dotnet --list-runtimes

ENV DOTNET_ROOT=/opt/dotnet
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1
ENV DOTNET_NOLOGO=1
ENV PALANTIR_DOTNET_VERSION=8.0.31

USER 1000:1000
