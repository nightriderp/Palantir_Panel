# Assetto Corsa Competizione – Windows-Server unter Proton.
#
# **Mit SteamCMD, aber nicht anonym.** Kunos gibt den dedizierten Server nur an
# ein Steam-Konto heraus, das ACC besitzt (Anwendung 1430110, ein Werkzeug am
# Elternspiel 805550). Ein Passwort steht deshalb trotzdem nirgends im Panel:
# Der Betreiber meldet sich einmal von Hand auf der Node an, der Token wird
# schreibgeschützt eingehängt, und der Server holt und aktualisiert sich danach
# selbst. Wer das nicht will, legt die Serverdateien weiterhin von Hand über den
# Datei-Manager nach `/data/server` – beide Wege bleiben.
#
# Zwei Ports: UDP für die Fahrzeugpositionen, TCP für den Verbindungsaufbau.
# Beide tragen im Container dieselbe Nummer wie draußen
# (`usesPublicPortNumber`), weil ACC sie dem Lobby-Dienst selbst meldet.
ARG BASIS=ghcr.io/nightriderp/palantir-base-proton:3
FROM ${BASIS}

USER root

COPY start.sh /opt/palantir/

RUN chmod 0755 /opt/palantir/start.sh

USER 1000:1000

ENTRYPOINT ["/opt/palantir/start.sh"]
