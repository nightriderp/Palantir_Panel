# Spiel-Image: Counter-Strike 2 (`palantir-game-cs2`).
#
# **Schritt 1 von vorne: nur Basic** (Betreiber-Wunsch 23.09.2026). Linux,
# SteamCMD, CS2 – keine Einstellungen, keine Plugins. Was dazukommt, kommt in
# kleinen Schritten und jeweils erst, wenn der vorige auf der Node läuft.
#
# **Die Serverdateien liegen nicht im Image.** Gut 30 GB; SteamCMD holt sie beim
# ersten Start in den Datenordner (Anwendung 730, anonym).
ARG BASIS=ghcr.io/nightriderp/palantir-base-steam:6

FROM ${BASIS}
USER root

COPY start.sh /opt/palantir/
RUN chmod 0755 /opt/palantir/start.sh

USER 1000:1000

# Spiel-Port: UDP für das Spiel, TCP für die Abfrage – dieselbe Nummer.
EXPOSE 27015/udp
EXPOSE 27015/tcp

ENTRYPOINT ["/opt/palantir/start.sh"]
