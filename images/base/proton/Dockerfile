# Basis-Image für Windows-Server unter Proton (`palantir-base-proton`).
#
# Die halbe Liste aus Anhang A des Lastenhefts hat gar keinen Linux-Server:
# Enshrouded, V Rising, Sons of the Forest, ARK: Survival Ascended. Sie laufen
# als Windows-Programm unter Proton – der Wine-Abwandlung, die Valve für Steam
# pflegt und gegen die diese Spiele auch offiziell geprüft werden.
#
# Kein Spiel; das Image hat keinen `ENTRYPOINT`. Das Schema aller Images steht
# in `images/README.md`.
#
# **Warum auf `base/steam`.** Die Serverdateien kommen bei diesen Spielen
# genauso über SteamCMD – nur eben als Windows-Fassung
# (`+@sSteamCmdForcePlatformType windows`). Eine eigene Wurzel daneben hieße,
# SteamCMD ein zweites Mal einzubauen.
#
# **Warum GE-Proton und nicht das Proton von Valve.** Valves Proton kommt über
# den Steam-Client und läuft in dessen Laufzeitumgebung; GE-Proton wird als
# vollständiges Archiv veröffentlicht, das sich auspacken und aufrufen lässt.
# Es ist dieselbe Grundlage (Wine), nur mit Korrekturen, die Valve noch nicht
# übernommen hat – und es ist das, was die Spielerschaft für Server tatsächlich
# einsetzt.
#
# **Warum Proton im Image und nicht im Datenordner.** Proton ist eine Laufzeit,
# keine Serverdatei: Es gehört zum Bauplan wie die JRE in `base/java`, nicht zu
# dem, was ein Server mit sich herumträgt. Im Datenordner läge es zudem einmal
# je Server – 1,5 GiB, die sich nie unterscheiden.
#
# Neue Fassung holen:
#
#   curl -s https://api.github.com/repos/GloriousEggroll/proton-ge-custom/releases/latest \
#     | grep -o 'GE-Proton[0-9-]*'
#   curl -sL <url> | sha256sum
ARG BASIS=ghcr.io/nightriderp/palantir-base-steam:2

# -----------------------------------------------------------------------------
# Stufe 1: Proton holen, Prüfsumme prüfen, auspacken.
#
# Das Archiv wiegt über 500 MiB; es bleibt in dieser Stufe und wandert nie ins
# Laufzeit-Image. Dorthin geht nur der ausgepackte Baum.
FROM ${BASIS} AS proton
USER root

ARG PROTON_VERSION=GE-Proton11-6
ARG PROTON_URL=https://github.com/GloriousEggroll/proton-ge-custom/releases/download/GE-Proton11-6/GE-Proton11-6-x86_64.tar.gz
ARG PROTON_SHA256=659f8d71f2f78659340120b20c1c5a1464aa138939332a1376dea22f6d2dc2e4

RUN set -eux; \
  curl --fail --silent --show-error --location --retry 3 --output /proton.tar.gz "${PROTON_URL}"; \
  echo "${PROTON_SHA256}  /proton.tar.gz" | sha256sum --check --strict -; \
  mkdir -p /opt/proton; \
  tar -xzf /proton.tar.gz -C /opt/proton --strip-components=1; \
  rm -f /proton.tar.gz; \
  test -x /opt/proton/proton

# -----------------------------------------------------------------------------
# Stufe 2: das Laufzeit-Image.
FROM ${BASIS}
USER root

# **Was Proton außer sich selbst braucht.**
#
# `python3-minimal`, weil `proton` ein Python-Skript ist – das übersieht man
# leicht und merkt es erst an „exec format error".
#
# Der Rest sind die Bibliotheken, die Wine zur Laufzeit nachlädt, jeweils in
# 64 und 32 Bit: Ein Windows-Programm ist oft 32-bittig, und selbst ein
# 64-bittiger Server startet über einen 32-Bit-Zwischenschritt. Die Liste ist
# auf einen Server ohne Bildschirm zugeschnitten; was nur für Grafik und Ton
# gebraucht wird, fehlt bewusst. Sollte ein Spiel etwas vermissen, sagt Wine es
# im Log mit dem Namen der Bibliothek – dann gehört sie hierher und die Fassung
# steigt.
#
# `xvfb` ist der Nachzügler (Fassung 2): Ein X-Server, der sein Bild in den
# Arbeitsspeicher zeichnet und wegwirft. Die Spiele auf Unity-Grundlage
# (V Rising, Sons of the Forest) verlangen unter Wine eine X11-Verbindung und
# beenden sich sonst gleich nach dem Start – auf einem Server, der weder
# Grafikkarte noch Zuschauer hat. Gestartet wird er nicht von selbst, sondern
# vom Startskript des Spiels (`proton_bildschirm_starten`); Enshrouded kommt
# ohne aus.
RUN set -eux; \
  dpkg --add-architecture i386; \
  apt-get update; \
  apt-get install -y --no-install-recommends \
  python3-minimal \
  xvfb \
  libfreetype6 libfreetype6:i386 \
  libgnutls30t64 libgnutls30t64:i386 \
  libgcrypt20 libgcrypt20:i386 \
  libxml2 libxml2:i386 \
  libx11-6 libx11-6:i386 \
  libxext6 libxext6:i386 \
  libvulkan1 libvulkan1:i386 \
  libasound2t64 libasound2t64:i386 \
  libdbus-1-3 libdbus-1-3:i386 \
  libusb-1.0-0 libusb-1.0-0:i386 \
  zlib1g zlib1g:i386; \
  rm -rf /var/lib/apt/lists/*

COPY --from=proton /opt/proton /opt/proton
COPY proton.sh /opt/palantir/lib/proton.sh

RUN set -eux; \
  chmod 0444 /opt/palantir/lib/proton.sh; \
  chmod -R a+rX /opt/proton

USER 1000:1000

# Die Fassung steht auch zur Laufzeit bereit: Ein Startskript nennt sie im Log,
# und wer ein Verhalten meldet, kann sie mitliefern.
ENV PALANTIR_PROTON_VERSION=GE-Proton11-6
ENV PALANTIR_PROTON_DIR=/opt/proton
