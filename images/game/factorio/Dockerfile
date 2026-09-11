# Factorio – ein Server ohne Steam und ohne Laufzeit-Basis.
#
# Wube gibt den Headless-Server als eigenes Archiv heraus, unabhängig von Steam
# und ohne Konto. Er bringt alles mit, was er braucht; das Image sitzt deshalb
# unmittelbar auf `palantir-base-linux` — wie Terraria, nur mit `.tar.xz` statt
# Zip. Genau dafür trägt die Wurzel seit Fassung 3 `xz-utils`.
#
# **Die Serverdateien liegen nicht im Image.** Wube erlaubt das Herunterladen,
# nicht das Weiterverteilen; das Startskript holt das Archiv beim ersten Start
# in den Datenordner und prüft es gegen die SHA-256 unten.
#
# Neue Fassung holen (die Adresse trägt die Fassung, der Inhalt steht damit
# fest — anders als bei `…/stable/headless/linux64`, das mit jeder Ausgabe auf
# etwas anderes zeigt):
#
#   curl -sL https://factorio.com/get-download/2.0.77/headless/linux64 | sha256sum
#
# Welche die aktuelle stabile ist, sagt `https://factorio.com/api/latest-releases`.
ARG BASIS=ghcr.io/nightriderp/palantir-base-linux:3
FROM ${BASIS}

USER root

COPY start.sh /opt/palantir/

RUN chmod 0755 /opt/palantir/start.sh

USER 1000:1000

ENV FACTORIO_VERSION=2.0.77
ENV FACTORIO_URL=https://factorio.com/get-download/2.0.77/headless/linux64
ENV FACTORIO_SHA256=c4efc11529f74d37c96933e291e0db73fd9f5aa4738913d9301b24680b3e947f

# Das Spiel spricht UDP. Der RCON-Port (27015/tcp) steht bewusst **nicht** hier:
# Er wird nie veröffentlicht, erreichbar ist er nur im Spielenetz vom Agent aus
# — wie bei Minecraft (`console` in der Spieltyp-Definition).
EXPOSE 34197/udp

# Factorio speichert bei SIGTERM: Der Server fängt das Signal ab, schreibt den
# Spielstand und beendet sich. Deshalb hier `exec` wie überall sonst — kein
# Umweg über die Konsole nötig (anders als bei Terraria).
ENTRYPOINT ["/opt/palantir/start.sh"]
