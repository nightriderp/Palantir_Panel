# Abiotic Factor – Windows-Server unter Proton.
#
# Deep Field Games gibt den dedizierten Server nur als Windows-Programm heraus
# (Anwendung 2857200, anonyme Anmeldung). Er läuft auf der Unreal Engine und
# braucht unter Wine einen Bildschirm – deshalb `base/proton:2` mit Xvfb.
#
# Zwei Ports, beide UDP: 7777 für das Spiel, 27015 für die Abfrage.
ARG BASIS=ghcr.io/nightriderp/palantir-base-proton:2
FROM ${BASIS}

USER root

COPY start.sh /opt/palantir/

RUN chmod 0755 /opt/palantir/start.sh

USER 1000:1000

EXPOSE 7777/udp 27015/udp

ENTRYPOINT ["/opt/palantir/start.sh"]
