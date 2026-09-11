# Sons of the Forest – Windows-Server unter Proton.
#
# Endnight gibt den dedizierten Server nur als Windows-Programm heraus
# (Anwendung 2465200, anonyme Anmeldung). Er läuft auf Unity und verlangt unter
# Wine eine X11-Verbindung – deshalb `base/proton:2`, das Xvfb mitbringt.
#
# Drei Ports, alle UDP: 8766 Spiel, 27016 Abfrage, 9700 Abgleich der Weltdaten
# beim Beitreten. Ohne den dritten hängt der Spieler im Ladebildschirm, ohne
# dass der Server etwas meldet.
ARG BASIS=ghcr.io/nightriderp/palantir-base-proton:4
FROM ${BASIS}

USER root

COPY start.sh /opt/palantir/

RUN chmod 0755 /opt/palantir/start.sh

USER 1000:1000

EXPOSE 8766/udp 27016/udp 9700/udp

ENTRYPOINT ["/opt/palantir/start.sh"]
