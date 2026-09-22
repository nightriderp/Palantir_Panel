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

# MariaDB und jq für die Plugins (Betreiber-Wunsch 22.09.2026).
#
# - **MariaDB** nur, weil WeaponPaints ausschliesslich MySQL kennt. Sie läuft
#   nur, wenn das Plugin an ist, und dann nur auf 127.0.0.1 im Container
#   (`plugins.sh`). Ein zweiter Container je Server wäre die sauberere
#   Trennung, aber eine eigene Ansteuerung im Agent für ein Skin-Plugin.
# - **jq**, weil die Plugin-Einstellungen JSON sind. Mit `sed` in JSON zu
#   schreiben hiesse, sich auf die Einrückung von CounterStrikeSharp zu
#   verlassen.
RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends mariadb-server jq; \
  rm -rf /var/lib/apt/lists/*

COPY start.sh plugins.sh plugins.list /opt/palantir/
RUN chmod 0755 /opt/palantir/start.sh

USER 1000:1000

# Plugin-Grundlage: MetaMod:Source und CounterStrikeSharp.
#
# **Die Archive liegen nicht im Image**, wie bei tModLoader: Das Startskript
# holt sie beim ersten Start in den internen Ordner und prüft sie gegen diese
# Summen; was nicht passt, wird verworfen statt ausgepackt.
#
# CounterStrikeSharp in der Ausgabe **mit Laufzeit**: Sie bringt ihr eigenes
# .NET mit. Ohne sie bräuchte es `base/dotnet` unter CS2 – ein zweites
# Grund-Image für ein Plugin.
#
# Neue Fassungen holen:
#
#   curl -sL https://mms.alliedmods.net/mmsdrop/2.0/mmsource-latest-linux
#   curl -s https://api.github.com/repos/roflmuffin/CounterStrikeSharp/releases/latest \
#     | jq -r '.tag_name, (.assets[] | select(.name | test("with-runtime-linux")) | .browser_download_url)'
#   curl -sL <url> | sha256sum
#
# Am 2026-09-22 gegen die Dateien selbst gerechnet.
ENV CS2_METAMOD_VERSION=2.0.0-git1469
ENV CS2_METAMOD_URL=https://mms.alliedmods.net/mmsdrop/2.0/mmsource-2.0.0-git1469-linux.tar.gz
ENV CS2_METAMOD_SHA256=a552e4cb1399ced15a1192880f1f6bdd3d16f930a9cb33bc9e45396a26f177ad
ENV CS2_CSS_VERSION=v1.0.374
ENV CS2_CSS_URL=https://github.com/roflmuffin/CounterStrikeSharp/releases/download/v1.0.374/counterstrikesharp-with-runtime-linux-1.0.374.zip
ENV CS2_CSS_SHA256=22a24aa482e226ad0dcdc72cec03e1927d267eb5a1566094e98809a06dcc6792

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
