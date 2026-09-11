# ARK: Survival Ascended – Windows-Server unter Proton 10.
#
# Studio Wildcard gibt den dedizierten Server nur als Windows-Programm heraus
# (Anwendung 2430930, anonyme Anmeldung). Die Laufzeit ist **`base/proton10`**
# und nicht `base/proton`: GE-Proton 11 bleibt beim Start dieses Servers hängen,
# ohne Meldung und ohne Ende. Warum es Proton zweimal gibt, steht in
# `images/base/proton10/README.md`.
#
# Zwei Ports, beide UDP: 7777 für das Spiel, 27015 für die Abfrage. RCON
# (TCP 27020) wird **nicht** veröffentlicht; es erreicht allein der Agent aus
# dem Spielenetz.
ARG BASIS=ghcr.io/nightriderp/palantir-base-proton10:2
FROM ${BASIS}

USER root

COPY start.sh /opt/palantir/

RUN chmod 0755 /opt/palantir/start.sh

USER 1000:1000

EXPOSE 7777/udp 27015/udp

ENTRYPOINT ["/opt/palantir/start.sh"]
