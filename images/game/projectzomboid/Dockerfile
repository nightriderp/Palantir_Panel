# Project Zomboid – zweites Spiel aus Steam.
#
# Es sitzt auf `palantir-base-steam:2`; die Serverdateien holt SteamCMD beim
# Start in den Datenordner (Anwendung 380870, anonyme Anmeldung). Das Muster ist
# dasselbe wie bei Valheim — was hier dazukommt, ist die `.ini` des Servers, die
# mit `palantir_schluessel_verschmelzen` gepflegt wird. Genau dafür sitzt
# `base/steam` seit Fassung 2 auf einer Wurzel, die diese Funktion mitbringt.
ARG BASIS=ghcr.io/nightriderp/palantir-base-steam:2
FROM ${BASIS}

USER root

COPY start.sh /opt/palantir/

RUN chmod 0755 /opt/palantir/start.sh

USER 1000:1000

# 16261 ist der Spiel-Port, 16262 nimmt die direkten Verbindungen der Spieler
# entgegen. Beide UDP.
EXPOSE 16261/udp 16262/udp

# **Kein `exec` am Ende** — wie bei Terraria und aus demselben Grund: Project
# Zomboid speichert bei SIGTERM nicht zuverlässig, gespeichert wird beim
# Konsolenbefehl `quit`. Das Startskript fängt das Signal ab, schickt `quit` und
# wartet; die Kulanzzeit gibt `stopTimeoutSeconds` in der Spieltyp-Definition.
ENTRYPOINT ["/opt/palantir/start.sh"]
