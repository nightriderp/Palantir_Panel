# Assetto Corsa Competizione – Windows-Server unter Proton.
#
# **Ohne SteamCMD.** Kunos gibt den dedizierten Server nur an ein Steam-Konto
# heraus, das ACC besitzt (Anwendung 1430110, ein Werkzeug am Elternspiel
# 805550); anonym geht er nicht. Fremde Zugangsdaten gehören nicht in dieses
# Panel – der Betreiber legt die Serverdateien stattdessen selbst über den
# Datei-Manager nach `/data/server`. Sie liegen in jeder ACC-Installation und
# wiegen keine hundert Megabyte.
#
# Zwei Ports: UDP für die Fahrzeugpositionen, TCP für den Verbindungsaufbau.
# Beide tragen im Container dieselbe Nummer wie draußen
# (`usesPublicPortNumber`), weil ACC sie dem Lobby-Dienst selbst meldet.
ARG BASIS=ghcr.io/nightriderp/palantir-base-proton:2
FROM ${BASIS}

USER root

COPY start.sh /opt/palantir/

RUN chmod 0755 /opt/palantir/start.sh

USER 1000:1000

ENTRYPOINT ["/opt/palantir/start.sh"]
