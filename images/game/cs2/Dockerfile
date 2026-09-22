# Spiel-Image: Counter-Strike 2 (`palantir-game-cs2`).
#
# **Die Serverdateien liegen nicht im Image.** CS2 bringt gut 30 GB mit und
# aktualisiert sich oft; SteamCMD holt sie beim ersten Start in den Datenordner
# und gleicht sie bei jedem weiteren ab (`steam_app_holen`). Anwendung 730 —
# dieselbe Nummer wie das Spiel —, anonym, ohne Konto.
#
# **Warum `base/steam`:** SteamCMD samt der 32-Bit-Bibliotheken steht dort. CS2
# selbst ist 64-Bit, aber SteamCMD ist es nicht.
ARG BASIS=ghcr.io/nightriderp/palantir-base-steam:6

FROM ${BASIS}
USER root

COPY start.sh /opt/palantir/
RUN chmod 0755 /opt/palantir/start.sh

USER 1000:1000

# Spiel-Port. Er traegt **beide Protokolle**: UDP fuer das Spiel selbst, TCP
# fuer die Abfrage. Die Spieltyp-Definition fuehrt ihn deshalb als `both`.
EXPOSE 27015/udp
EXPOSE 27015/tcp

# GOTV. Eigener Port, nur UDP; wird erst benutzt, wenn `tv_enable` an ist.
EXPOSE 27020/udp

# **Kein `exec` vor dem Server, sondern `exec` auf ihn** — das Startskript
# ersetzt sich am Ende durch `cs2`, damit SIGTERM direkt ankommt. CS2 speichert
# beim Beenden nichts, was verloren gehen koennte: Spielstaende gibt es nicht,
# und laufende Aufzeichnungen schliesst der Server selbst.
ENTRYPOINT ["/opt/palantir/start.sh"]
