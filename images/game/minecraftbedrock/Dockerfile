# Minecraft: Bedrock Edition – der Server für Handy, Konsole und Windows-Edition.
#
# Er sitzt unmittelbar auf `palantir-base-linux`: Mojang liefert ein natives
# Linux-Programm, das nur die C-Bibliothek und `libgcc` braucht – keine JVM, kein
# SteamCMD, kein .NET. Genau für diesen Fall ist die Wurzel gedacht
# (`images/README.md`).
#
# **Nicht zu verwechseln mit dem Java-Image** (`images/game/minecraft`). Bedrock
# ist ein anderes Programm mit eigenem Protokoll: Es spricht UDP statt TCP, die
# Spielstände liegen in einem anderen Format, und Plugins der Java-Welt laufen
# darauf nicht. Zwei Server, zwei Images.
#
# **Die Serverdateien liegen nicht im Image.** Mojang gibt sie nicht zur
# Weitergabe frei; das Startskript holt das Archiv beim ersten Start in den
# Datenordner und prüft es gegen die SHA-256 unten. Adresse, Fassung und
# Prüfsumme stehen hier und gehören damit zum Image-Tag – wer die Fassung
# wechselt, tauscht alle drei und erhöht `VERSION`.
#
# Neue Werte holen (Mojang nennt die aktuelle Fassung selbst; ohne den
# Kennungs-Kopf antwortet die Auslieferung mit 403):
#
#   curl -sL 'https://net-secondary.web.minecraft-services.net/api/v1.0/download/links' \
#     | grep -o 'https://[^"]*bin-linux/bedrock-server-[0-9.]*\.zip'
#   curl -sL -H 'User-Agent: Mozilla/5.0' <Adresse> | sha256sum
#
# `BASIS` zeigt auf `:3`: Diese Fassung bringt `unzip` und `xz-utils` mit.
ARG BASIS=ghcr.io/nightriderp/palantir-base-linux:3
FROM ${BASIS}

USER root

COPY start.sh /opt/palantir/

# Rechte hier statt im Kontext: Ein Arbeitsplatz unter Windows gibt das
# Ausführungsbit nicht mit, und ein Image, das je nach Auscheck-Plattform anders
# aussieht, ist keins.
RUN chmod 0755 /opt/palantir/start.sh

USER 1000:1000

ENV BEDROCK_VERSION=1.26.51.1
ENV BEDROCK_URL=https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-1.26.51.1.zip
ENV BEDROCK_SHA256=ad91d3b824e51ea50b5bb601c295cbd8f543a29b14315c2ad89ff27311e2d860

# Bedrock spricht UDP – ein Verbindungsversuch auf TCP sagt hier nichts, und
# der Health-Check des Panels fragt deshalb über GameDig (`minecraftbedrock`).
EXPOSE 19132/udp

ENTRYPOINT ["/opt/palantir/start.sh"]
