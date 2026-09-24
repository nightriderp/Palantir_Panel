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
#
# **MetaMod bewusst auf git1411** (31.08.2026), den letzten Build vor dem Umbau
# auf KHook. Ab dem 08.09. lehnt MetaMod Plugins mit Schnittstelle 17 ab, und
# jedes veröffentlichte CounterStrikeSharp bis v1.0.374 hat 17 – auf der Node:
# „Plugin uses old SourceHook Metamod build … (17 < 18)" (CounterStrikeSharp
# Issue #1415). Hochziehen erst zusammen mit einem CounterStrikeSharp, das
# gegen KHook gebaut ist.
ENV CS2_METAMOD_VERSION=2.0.0-git1411 \
    CS2_METAMOD_URL=https://mms.alliedmods.net/mmsdrop/2.0/mmsource-2.0.0-git1411-linux.tar.gz \
    CS2_METAMOD_SHA256=e3d4c3d457a1c86a5079e8bd8248a4a00361c7d0a3dce7c7e0c4c45458096649 \
    CS2_CSS_VERSION=v1.0.374 \
    CS2_CSS_URL=https://github.com/roflmuffin/CounterStrikeSharp/releases/download/v1.0.374/counterstrikesharp-with-runtime-linux-1.0.374.zip \
    CS2_CSS_SHA256=22a24aa482e226ad0dcdc72cec03e1927d267eb5a1566094e98809a06dcc6792

USER 1000:1000

# Spiel-Port: UDP für das Spiel, TCP für die Abfrage – dieselbe Nummer.
EXPOSE 27015/udp
EXPOSE 27015/tcp

ENTRYPOINT ["/opt/palantir/start.sh"]
