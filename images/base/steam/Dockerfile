# Basis-Image für Spiele aus Steam (`palantir-base-steam`).
#
# Kein Spiel – die Grundlage für die mit Abstand größte Gruppe aus Anhang A des
# Lastenhefts: rund dreißig Spiele holen ihre Serverdateien über SteamCMD.
# Valheim ist das erste.
#
# Es fügt der Wurzel `palantir-base-linux` genau zwei Dinge hinzu:
#
#   - SteamCMD, per Prüfsumme gepinnt,
#   - `/opt/palantir/lib/steam.sh`: Vorbereiten und Holen einer Anwendung.
#
# Alles Übrige kommt aus der Wurzel: die feste, nicht-root Identität UID 1000,
# `/data` als Arbeitsverzeichnis, SIGTERM als Stoppsignal, `palantir-console`,
# `palantir.sh` und `curl`.
#
# **Warum die 32-Bit-Bibliotheken.** SteamCMD selbst ist ein 32-Bit-Programm,
# auch wenn die Server, die es holt, 64-Bit sind. Ohne `lib32gcc-s1` und
# `lib32stdc++6` startet es mit „No such file or directory", obwohl die Datei da
# ist – der Klassiker bei einem fehlenden Interpreter. Dieselben Bibliotheken
# brauchen später die alten Source-Spiele (Counter-Strike 1.6, TF2), sie stehen
# hier also ohnehin richtig.
#
# **Die Fassung `:<n>` ist unveränderlich** (game-images.yml überschreibt kein
# Versions-Tag). Ein Spiel-Image zeigt deshalb per Tag hierher.
#
# **Dependabot hält hier nichts nach:** Das `FROM` zeigt auf ein Tag der eigenen
# Registry, und SteamCMD hängt an einer Prüfsumme. Valve veröffentlicht das
# Paket unter einer festen Adresse und tauscht den Inhalt aus – der Bau bricht
# dann mit „Prüfsumme passt nicht" ab, und das ist die Absicht. Wie die Werte
# erneuert werden, steht im README.
ARG BASIS=ghcr.io/nightriderp/palantir-base-linux:1

FROM ${BASIS}
USER root

# Ein Schritt, damit die Paketlisten nicht in einer eigenen Schicht liegen
# bleiben.
RUN set -eux; \
  dpkg --add-architecture i386; \
  apt-get update; \
  apt-get install -y --no-install-recommends lib32gcc-s1 lib32stdc++6; \
  rm -rf /var/lib/apt/lists/*

# Adresse und Prüfsumme gehören zusammen und werden gemeinsam getauscht.
ARG STEAMCMD_URL=https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz
ARG STEAMCMD_SHA256=cebf0046bfd08cf45da6bc094ae47aa39ebf4155e5ede41373b579b8f1071e7c

RUN set -eux; \
  curl --fail --silent --show-error --location --retry 3 --output /steamcmd.tar.gz "${STEAMCMD_URL}"; \
  echo "${STEAMCMD_SHA256}  /steamcmd.tar.gz" | sha256sum --check --strict -; \
  mkdir -p /opt/steamcmd; \
  tar --extract --file /steamcmd.tar.gz --directory /opt/steamcmd; \
  rm -f /steamcmd.tar.gz; \
  test -x /opt/steamcmd/steamcmd.sh

COPY steam.sh /opt/palantir/lib/steam.sh

# Rechte hier statt im Kontext: Ein Arbeitsplatz unter Windows gibt Dateirechte
# nicht mit. Die Bibliothek wird eingebunden, nicht ausgeführt – nur lesbar.
RUN chmod 0444 /opt/palantir/lib/steam.sh

USER 1000:1000
