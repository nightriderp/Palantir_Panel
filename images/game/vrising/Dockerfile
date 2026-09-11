# V Rising – Windows-Server unter Proton.
#
# Stunlock gibt den dedizierten Server nur als Windows-Programm heraus
# (Anwendung 1829350, anonyme Anmeldung). Er läuft auf Unity und verlangt unter
# Wine eine X11-Verbindung – deshalb `base/proton:2`, das Xvfb mitbringt.
#
# Beide Spiel-Ports sind UDP: 9876 für das Spiel, 9877 für die Steam-Abfrage.
# RCON (TCP 25575) wird **nicht** veröffentlicht; es erreicht allein der Agent
# aus dem Spielenetz.
ARG BASIS=ghcr.io/nightriderp/palantir-base-proton:2
FROM ${BASIS}

USER root

COPY start.sh /opt/palantir/

RUN chmod 0755 /opt/palantir/start.sh

USER 1000:1000

EXPOSE 9876/udp 9877/udp

ENTRYPOINT ["/opt/palantir/start.sh"]
