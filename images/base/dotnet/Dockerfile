# Basis-Image für .NET-Spiele (`palantir-base-dotnet`).
#
# Kein Spiel – die Grundlage, auf der .NET-Spiel-Images aufsetzen
# (`images/game/vintagestory` ist das erste). Es fügt der gemeinsamen Wurzel
# `palantir-base-linux` genau zwei Dinge hinzu:
#
#   - die .NET-Laufzeit (Microsoft, per Prüfsumme gepinnt),
#   - `/opt/palantir/lib/dotnet.sh`: die Schreiborte, die .NET erwartet.
#
# Alles Übrige kommt aus der Wurzel: UID 1000, `/data`, SIGTERM,
# `palantir-console`, `palantir.sh`, `curl`.
#
# **Warum die Laufzeit und nicht das SDK.** Ein Server wird nicht übersetzt, er
# wird ausgeführt. Das SDK wöge ein Mehrfaches und brächte einen Übersetzer ins
# Laufzeit-Image, der dort nichts zu suchen hat.
#
# **Warum der Tarball und nicht das Paketarchiv von Microsoft.** Ein
# `apt`-Archiv liefert, was gerade aktuell ist; der Tarball liefert genau eine
# Fassung, und Microsoft veröffentlicht zu jeder die SHA-512. Ein Bau von heute
# und einer von morgen ergeben denselben Inhalt.
#
# **Warum .NET 10:** Vintage Story 1.22 – das erste Spiel – nennt in seiner
# `runtimeconfig.json` `Microsoft.NETCore.App 10.0.0`. Ein Spiel, das eine
# ältere Hauptfassung braucht, bekommt ein eigenes Basis-Image daneben
# (`base/dotnet8`), keinen Schalter in diesem.
#
# Neue Fassung holen:
#
#   curl -s https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json
#
# Darin `releases[0].runtime.files[]`, Eintrag `dotnet-runtime-linux-x64.tar.gz`:
# `url` und `hash` (SHA-512) gehören zusammen und werden gemeinsam getauscht.
ARG BASIS=ghcr.io/nightriderp/palantir-base-linux:3

# -----------------------------------------------------------------------------
# Stufe 1: die Laufzeit holen und die Prüfsumme prüfen.
#
# Die Stufe läuft als `root`, weil sie nach `/opt` schreibt, und wird verworfen;
# ins Laufzeit-Image kommt nur der entpackte Baum.
FROM ${BASIS} AS laufzeit
USER root

ARG DOTNET_VERSION=10.0.12
ARG DOTNET_URL=https://builds.dotnet.microsoft.com/dotnet/Runtime/10.0.12/dotnet-runtime-10.0.12-linux-x64.tar.gz
ARG DOTNET_SHA512=58388fdde4f13bd703c7a6f7defb3300b17e42ba5fe8bca50066f80f64ac7406620dcdfb4acc1eff7992750c8cc5cff8369dd12d09730c8a9e8760d6032f7f6e

RUN set -eux; \
  curl --fail --silent --show-error --location --retry 3 --output /dotnet.tar.gz "${DOTNET_URL}"; \
  echo "${DOTNET_SHA512}  /dotnet.tar.gz" | sha512sum --check --strict -; \
  mkdir -p /opt/dotnet; \
  tar --extract --file /dotnet.tar.gz --directory /opt/dotnet; \
  rm -f /dotnet.tar.gz; \
  test -x /opt/dotnet/dotnet

# -----------------------------------------------------------------------------
# Stufe 2: das Laufzeit-Image.
FROM ${BASIS}
USER root

# **Was .NET außer sich selbst braucht.**
#
# `libicu` trägt die Sprach- und Sortierregeln. Ohne es startet .NET nur mit
# `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1`, und dann sortiert und vergleicht
# ein Spiel Zeichenketten anders als überall sonst – ein Fehler, der erst bei
# Umlauten auffällt. `libssl` braucht jede Verbindung nach außen.
RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends libicu74 libssl3t64; \
  rm -rf /var/lib/apt/lists/*

COPY --from=laufzeit /opt/dotnet /opt/dotnet
COPY dotnet.sh /opt/palantir/lib/dotnet.sh

# `dotnet` muss ohne vollen Pfad aufrufbar sein: Ein Startskript ruft es am Ende
# auf, und ein Spiel-Image soll dafür nichts wissen müssen.
#
# Rechte hier statt im Kontext: Ein Arbeitsplatz unter Windows gibt Dateirechte
# nicht mit, und ein Image, das je nach Auscheck-Plattform anders aussieht, ist
# keins.
RUN set -eux; \
  chmod 0444 /opt/palantir/lib/dotnet.sh; \
  ln -s /opt/dotnet/dotnet /usr/local/bin/dotnet; \
  dotnet --list-runtimes

ENV DOTNET_ROOT=/opt/dotnet
# Keine Telemetrie aus einem Spielserver heraus, und kein Begrüßungstext im Log.
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1
ENV DOTNET_NOLOGO=1
ENV PALANTIR_DOTNET_VERSION=10.0.12

USER 1000:1000
