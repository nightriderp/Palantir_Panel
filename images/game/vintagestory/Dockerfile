# Vintage Story – das erste Spiel ohne Steam und ohne Java.
#
# Der Server wird beim Hersteller heruntergeladen (`api.vintagestory.at`) und
# läuft auf .NET 10 – deshalb `base/dotnet:1`. Die Serverdateien kommen beim
# ersten Start in den Datenordner und werden gegen eine SHA-256 geprüft; ins
# Image gehören sie nicht: Vintage Story ist ein gekauftes Spiel, und was frei
# herunterzuladen ist, ist damit noch nicht frei weiterzugeben (dieselbe
# Überlegung wie bei der Minecraft-Jar von Mojang).
#
# Ein Port, TCP 42420. Anders als bei den Steam-Spielen gibt es keinen zweiten
# für die Abfrage: Vintage Story beantwortet keine, sein Verzeichnis führt der
# Hersteller.
ARG BASIS=ghcr.io/nightriderp/palantir-base-dotnet:1
FROM ${BASIS}

USER root

COPY start.sh /opt/palantir/

RUN chmod 0755 /opt/palantir/start.sh

USER 1000:1000

EXPOSE 42420/tcp

ENTRYPOINT ["/opt/palantir/start.sh"]
