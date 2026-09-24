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

# **Plugin-Grundlage** (Schritt 7): feste Fassungen mit Prüfsumme. Geholt wird
# erst beim Start und nur, wenn der Schalter an ist – in den Datenordner, nicht
# ins Image. Summen am 2026-09-24 gegen die Dateien selbst gerechnet; wer eine
# Fassung ändert, erhöht VERSION.
ENV CS2_METAMOD_VERSION=2.0.0-git1469 \
    CS2_METAMOD_URL=https://mms.alliedmods.net/mmsdrop/2.0/mmsource-2.0.0-git1469-linux.tar.gz \
    CS2_METAMOD_SHA256=a552e4cb1399ced15a1192880f1f6bdd3d16f930a9cb33bc9e45396a26f177ad \
    CS2_CSS_VERSION=v1.0.374 \
    CS2_CSS_URL=https://github.com/roflmuffin/CounterStrikeSharp/releases/download/v1.0.374/counterstrikesharp-with-runtime-linux-1.0.374.zip \
    CS2_CSS_SHA256=22a24aa482e226ad0dcdc72cec03e1927d267eb5a1566094e98809a06dcc6792

USER 1000:1000

# Spiel-Port: UDP für das Spiel, TCP für die Abfrage – dieselbe Nummer.
EXPOSE 27015/udp
EXPOSE 27015/tcp

ENTRYPOINT ["/opt/palantir/start.sh"]
