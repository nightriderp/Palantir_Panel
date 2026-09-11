# Basis-Image für Windows-Server unter Proton 10 (`palantir-base-proton10`).
#
# **Warum es dieses Image zweimal gibt.** GE-Proton 11 kann ARK: Survival
# Ascended nicht: Der Serverprozess bleibt beim Start hängen, ohne Meldung und
# ohne Ende. Der Linux-ASA-Server-Manager pinnt deshalb ausdrücklich auf die
# 10er-Reihe, und dasselbe Setup läuft dort. `base/proton` trägt GE-Proton11-6
# und bleibt, wie es ist – Enshrouded, V Rising, Sons of the Forest und Abiotic
# Factor stehen darauf. Dieses Image ist die ältere Laufzeit daneben, genau wie
# `base/java21` neben `base/java` stünde.
#
# Kein Spiel; das Image hat keinen `ENTRYPOINT`.
#
# **Die Bibliothek wird nicht abgeschrieben.** `proton.sh` kommt aus
# `palantir-base-proton:2` – dieselbe Datei, nicht eine Kopie, die auseinander
# driftet. Ein Bau dieses Images setzt deshalb voraus, dass es dieses Tag in der
# Registry gibt; es gibt es seit dem 2026-09-11. Die Basis-Matrix läuft parallel
# (game-images.yml), also darf hier nie auf eine Fassung gezeigt werden, die im
# selben Lauf erst entsteht.
#
# Neue Fassung der 10er-Reihe holen:
#
#   curl -s https://api.github.com/repos/GloriousEggroll/proton-ge-custom/releases \
#     | grep -o 'GE-Proton10-[0-9]*' | head -1
#   curl -sL <url> | sha256sum
ARG BASIS=ghcr.io/nightriderp/palantir-base-steam:2
ARG BIBLIOTHEK=ghcr.io/nightriderp/palantir-base-proton:2

# -----------------------------------------------------------------------------
# Stufe 1: Proton holen, Prüfsumme prüfen, auspacken.
#
# Das Archiv wiegt über 500 MiB; es bleibt in dieser Stufe und wandert nie ins
# Laufzeit-Image. Dorthin geht nur der ausgepackte Baum.
FROM ${BASIS} AS proton
USER root

ARG PROTON_VERSION=GE-Proton10-34
ARG PROTON_URL=https://github.com/GloriousEggroll/proton-ge-custom/releases/download/GE-Proton10-34/GE-Proton10-34.tar.gz
# Geprüft gegen die SHA-512, die GloriousEggroll zur Veröffentlichung ablegt.
ARG PROTON_SHA256=51c580b66a833c73998fe00f0717eeac57197654040a2f2ed5189e3ee68d773d

RUN set -eux; \
  curl --fail --silent --show-error --location --retry 3 --output /proton.tar.gz "${PROTON_URL}"; \
  echo "${PROTON_SHA256}  /proton.tar.gz" | sha256sum --check --strict -; \
  mkdir -p /opt/proton; \
  tar -xzf /proton.tar.gz -C /opt/proton --strip-components=1; \
  rm -f /proton.tar.gz; \
  test -x /opt/proton/proton

# -----------------------------------------------------------------------------
# Stufe 2: die Bibliothek. Nur eine Datei; der Rest des Images wird verworfen.
FROM ${BIBLIOTHEK} AS bibliothek

# -----------------------------------------------------------------------------
# Stufe 3: das Laufzeit-Image.
FROM ${BASIS}
USER root

# Dieselbe Liste wie in `base/proton`, aus demselben Grund: Es sind die
# Bibliotheken, die Wine zur Laufzeit nachlädt, jeweils in 64 und 32 Bit, auf
# einen Server ohne Bildschirm gekürzt. Dazu `python3-minimal` (`proton` ist ein
# Python-Skript) und `xvfb` – den Bildschirm, den es nicht gibt.
#
# Der Spiegel ist ein Bau-Argument: `archive.ubuntu.com` gab die Paketlisten am
# 2026-09-11 mit zwanzig Kilobyte in der Sekunde heraus und ließ zwei Bauten in
# die Frist laufen. Die Läufer von GitHub stehen bei Azure. Am Inhalt ändert das
# nichts; die Quellenliste wird danach zurückgesetzt.
ARG APT_SPIEGEL=azure.archive.ubuntu.com

RUN set -eux; \
  for quelle in /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list; do \
  if [ -f "$quelle" ]; then \
  sed -i "s|://archive\.ubuntu\.com/|://${APT_SPIEGEL}/|" "$quelle"; \
  fi; \
  done; \
  dpkg --add-architecture i386; \
  apt-get update -o Acquire::Languages=none; \
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
  for quelle in /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list; do \
  if [ -f "$quelle" ]; then \
  sed -i "s|://${APT_SPIEGEL}/|://archive.ubuntu.com/|" "$quelle"; \
  fi; \
  done; \
  rm -rf /var/lib/apt/lists/*

COPY --from=proton /opt/proton /opt/proton
COPY --from=bibliothek /opt/palantir/lib/proton.sh /opt/palantir/lib/proton.sh

RUN set -eux; \
  chmod 0444 /opt/palantir/lib/proton.sh; \
  chmod -R a+rX /opt/proton

USER 1000:1000

# Die Fassung steht auch zur Laufzeit bereit: Ein Startskript nennt sie im Log,
# und wer ein Verhalten meldet, kann sie mitliefern. Genau daran ist zu sehen,
# ob ein Server auf der 10er- oder der 11er-Reihe läuft.
ENV PALANTIR_PROTON_VERSION=GE-Proton10-34
ENV PALANTIR_PROTON_DIR=/opt/proton
