# Rust – dritter Server aus Steam.
#
# Das Muster ist dasselbe wie bei Valheim und Project Zomboid: SteamCMD holt die
# Serverdateien beim Start in den Datenordner (Anwendung 258550, anonyme
# Anmeldung). Was hier dazukommt, ist `steamclient.so` – RustDedicated sucht sie
# neben seinen eigenen Bibliotheken, und ohne sie bricht der Start mit einem
# Ladefehler ab, der nichts über die Ursache sagt.
#
# **Alle Einstellungen stehen in der Argumentliste**; eine Konfigurationsdatei
# gibt es nicht zu pflegen.
ARG BASIS=ghcr.io/nightriderp/palantir-base-steam:2
FROM ${BASIS}

USER root

COPY start.sh /opt/palantir/

RUN chmod 0755 /opt/palantir/start.sh

USER 1000:1000

# Der Abfrage-Port ist derselbe wie der Spiel-Port (`+server.queryport`); der
# RCON-Port (28016/tcp) wird nie veröffentlicht.
EXPOSE 28015/udp

# Rust speichert beim Stoppsignal selbst – deshalb `exec` wie überall sonst.
ENTRYPOINT ["/opt/palantir/start.sh"]
