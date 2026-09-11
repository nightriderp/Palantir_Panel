# Palworld – vierter Server aus Steam.
#
# SteamCMD holt die Serverdateien beim Start in den Datenordner (Anwendung
# 2394010, anonyme Anmeldung). Zwei Eigenheiten: `steamclient.so` gehört nach
# `~/.steam/sdk64`, sonst scheitert die Anmeldung an Steam – und die
# Einstellungen stehen in **einer** langen Zeile (`OptionSettings=(...)`), nicht
# als `schluessel=wert` je Zeile.
ARG BASIS=ghcr.io/nightriderp/palantir-base-steam:2
FROM ${BASIS}

USER root

COPY start.sh /opt/palantir/

RUN chmod 0755 /opt/palantir/start.sh

USER 1000:1000

# Der RCON-Port (25575/tcp) wird nie veröffentlicht. Ein Abfrage-Port fehlt
# bewusst: Palworld beantwortet nur seine eigene REST-Schnittstelle, und die
# verlangt das Administrator-Passwort (`query.kind: 'none'` in der
# Spieltyp-Definition).
EXPOSE 8211/udp

ENTRYPOINT ["/opt/palantir/start.sh"]
