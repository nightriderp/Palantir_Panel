# Satisfactory – ein Server, der sich selbst verwaltet.
#
# SteamCMD holt die Serverdateien beim Start in den Datenordner (Anwendung
# 1690800, anonyme Anmeldung). Es gibt **keine Konfigurationsdatei**, die von
# außen gesetzt würde: Servername, Passwörter und Spielstand vergibt der erste
# Spieler im Spiel, wenn er den Server übernimmt.
#
# **Der Port trägt beide Protokolle.** Seit Update 1.0 läuft alles über eine
# Nummer – Spiel, Abfrage und die HTTPS-Schnittstelle des Server-Managers. Der
# Client leitet die zweite Adresse nicht ab, er benutzt dieselbe; deshalb steht
# in der Spieltyp-Definition `protocol: 'both'` (siehe `GameTypePortDeclaration`).
ARG BASIS=ghcr.io/nightriderp/palantir-base-steam:2
FROM ${BASIS}

USER root

COPY start.sh /opt/palantir/

RUN chmod 0755 /opt/palantir/start.sh

USER 1000:1000

EXPOSE 7777/tcp 7777/udp

ENTRYPOINT ["/opt/palantir/start.sh"]
