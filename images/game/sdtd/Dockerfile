# 7 Days to Die.
#
# SteamCMD holt die Serverdateien beim Start in den Datenordner (Anwendung
# 294420, anonyme Anmeldung). Zwei Eigenheiten:
#
#   - Die Konfiguration ist **XML**. Verschmelzen wie bei `server.properties`
#     geht damit nicht; das Startskript schreibt die Datei bei jedem Start neu.
#   - Der Spiel-Port trägt **beide Protokolle** unter derselben Nummer, die
#     beiden Zusatzports daneben sind UDP.
ARG BASIS=ghcr.io/nightriderp/palantir-base-steam:2
FROM ${BASIS}

USER root

COPY start.sh /opt/palantir/

RUN chmod 0755 /opt/palantir/start.sh

USER 1000:1000

EXPOSE 26900/tcp 26900/udp 26901/udp 26902/udp

ENTRYPOINT ["/opt/palantir/start.sh"]
