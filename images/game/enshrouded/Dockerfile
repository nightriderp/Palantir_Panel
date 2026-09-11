# Enshrouded – das erste Spiel unter Proton.
#
# Es gibt nur einen Windows-Server. SteamCMD holt dessen Dateien in den
# Datenordner (Anwendung 2278520, anonyme Anmeldung, **Windows**-Fassung), und
# Proton führt sie aus.
#
# Die Ports sind beide UDP: 15636 für das Spiel, 15637 für die Abfrage. Anders
# als bei Satisfactory braucht keiner von beiden ein zweites Protokoll.
ARG BASIS=ghcr.io/nightriderp/palantir-base-proton:1
FROM ${BASIS}

USER root

COPY start.sh /opt/palantir/

RUN chmod 0755 /opt/palantir/start.sh

USER 1000:1000

EXPOSE 15636/udp 15637/udp

ENTRYPOINT ["/opt/palantir/start.sh"]
