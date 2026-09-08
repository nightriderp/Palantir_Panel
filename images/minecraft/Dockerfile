# Minecraft (Paper) – das erste echte Spiel-Image (Lastenheft §7, Ausbaustufe 2).
#
# Der Prüfstand nebenan (`images/test-minecraft`) stellt das Minecraft-Protokoll
# nach; hier läuft ein echter Server. Die Regeln bleiben dieselben, und sie sind
# der Grund, warum dieses Image überhaupt existiert: Der naheliegende Weg über
# `itzg/minecraft-server` ist vor dem Hochlauf gescheitert (Fundpunkt 113,
# PR #166). Jenes Image startet als `root`, schreibt seinen Datenordner um und
# wechselt danach den Benutzer – alle drei Schritte scheitern an `CapDrop: ALL`
# und `no-new-privileges` (Pflichtenheft §2.3) mit „operation not permitted".
# Die Härtung bleibt, das Image fügt sich:
#
#   - fester Benutzer im Dockerfile, UID 1000 – genau die, der der Datenordner
#     auf dem Homeserver gehört (Fundpunkt 117: der Agent legt ihn als 1000 an
#     und kann ihn mangels Capabilities niemandem verschenken),
#   - kein `chown` im Startskript,
#   - kein Benutzerwechsel zur Laufzeit,
#   - keine setuid-Binaries im Startpfad,
#   - geschrieben wird nur in den Datenordner und in `/tmp`.
#
# **Basis-Image per Digest gepinnt**, aus demselben Grund wie beim Prüfstand: Der
# Tag `25-jre-noble` wandert bei jedem Java- und Ubuntu-Patch. Ohne Digest
# genügte ein `workflow_dispatch` ohne jede Code-Änderung, um hinter dem
# unveränderlichen Spiel-Tag `:1` eine andere Java-Fassung auszuliefern – und ein
# Spiel-Tag steht laut game-images.yml für genau einen Inhalt. Der Tag bleibt zur
# Lesbarkeit davor stehen, gezogen wird der Digest. Nachgehalten von
# `.github/dependabot.yml` (Ökosystem `docker`).
#
# **Warum Temurin 25 und nicht 21:** Paper 26.2 verlangt laut
# `fill.papermc.io/v3/projects/paper/versions/26.2` Java 25 als Mindestfassung.
# `-noble` statt `25-jre`, weil der unmarkierte Tag zusätzlich Windows-Images im
# Index führt; hier soll unmissverständlich Ubuntu 24.04 stehen.
#
# sha256:b4c93a… ist der Multi-Arch-Index (linux/amd64, arm64v8, ppc64le,
# riscv64, s390x) hinter `eclipse-temurin:25-jre-noble` mit JRE 25.0.4+7.

# -----------------------------------------------------------------------------
# Stufe 1: Paper holen und die Prüfsumme prüfen.
#
# Die Jar wird **im Bau** geholt und nicht beim ersten Start:
#   - Ein Spiel-Image-Tag steht für genau einen Inhalt (game-images.yml). Läge
#     die Jar erst zur Laufzeit im Datenordner, hinge die Serverfassung an der
#     Quelle im Netz statt am Tag – zwei Server aus demselben `:1` liefen dann
#     unter Umständen auf verschiedenem Paper.
#   - Das Wurzeldateisystem ist schreibgeschützt; ein Laufzeit-Download landete
#     in jedem einzelnen Server-Datenordner und wanderte von dort in jede
#     Sicherung – 65 MiB pro Server, die sich nie ändern.
#   - Der Start braucht dann kein Netz für Paper selbst und scheitert nicht an
#     einer Störung bei papermc.io.
#
# Paper darf weitergegeben werden (GPLv3, Quelle: github.com/PaperMC/Paper). Der
# Server von Mojang darf es **nicht** – deshalb enthält die Paper-Jar ihn nicht,
# sondern lädt ihn beim ersten Start selbst nach. Das ist der eine Download, der
# sich nicht ins Image verlegen lässt; er hängt an der EULA-Zustimmung, die das
# Startskript einfordert.
#
# Die Prüfsumme ist die aus der Paper-API und steht direkt neben der URL: Die
# Quelle adressiert die Datei ohnehin über ihren SHA-256, der Vergleich hier
# prüft zusätzlich, dass unterwegs nichts ausgetauscht wurde. `curl` kommt nur in
# dieser Stufe hinzu und landet nie im fertigen Image.
FROM eclipse-temurin:25-jre-noble@sha256:b4c93a50fc67612798db73d68ca3b0ee4ebdd51736e59cca370e689b9797037e AS paper

# Fassung und Prüfsumme gehören zusammen und werden gemeinsam getauscht. Wer sie
# ändert, erhöht die Zahl in `VERSION` und zieht `dockerImage` in der
# Spieltyp-Definition nach (game-images.yml, Kopfkommentar).
ARG PAPER_VERSION=26.2
ARG PAPER_BUILD=121
ARG PAPER_SHA256=0de30efb024bc8b83c9c7d507d11802897ad8056b6110ec09fe1a91d126ccb54

RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends ca-certificates curl; \
  curl --fail --silent --show-error --location --retry 3 \
  --output /paper.jar \
  "https://fill-data.papermc.io/v1/objects/${PAPER_SHA256}/paper-${PAPER_VERSION}-${PAPER_BUILD}.jar"; \
  echo "${PAPER_SHA256}  /paper.jar" | sha256sum --check --strict -

# -----------------------------------------------------------------------------
# Stufe 2: das Laufzeit-Image.
FROM eclipse-temurin:25-jre-noble@sha256:b4c93a50fc67612798db73d68ca3b0ee4ebdd51736e59cca370e689b9797037e

# Feste, nicht-root Identität. Ubuntu 24.04 vergibt UID 1000 bereits an den
# Benutzer `ubuntu`; dann bleibt es dabei, denn entscheidend ist die Zahl, nicht
# der Name – der Datenordner auf dem Homeserver gehört UID 1000 (Fundpunkt 117).
# Ist 1000 frei, entsteht `palantir` mit genau dieser UID.
RUN set -eux; \
  if ! getent passwd 1000 > /dev/null; then \
  groupadd --gid 1000 palantir; \
  useradd --uid 1000 --gid 1000 --no-create-home --home-dir /data --shell /usr/sbin/nologin palantir; \
  fi

COPY start.sh console.sh /opt/palantir/
COPY --from=paper /paper.jar /opt/palantir/paper.jar

# Rechte hier statt im Kontext: Ein Arbeitsplatz unter Windows gibt das
# Ausführungsbit nicht mit, und ein Image, das je nach Auscheck-Plattform anders
# aussieht, ist keins.
#
# `palantir-console` muss ohne Shell aufrufbar sein: `EXEC_CONSOLE` übergibt eine
# Argumentliste, kein Kommando für `sh -c` – und die Zeile aus der Panel-Konsole
# wird an Leerzeichen zerlegt, argv[0] ist also genau dieser Name.
RUN set -eux; \
  chmod 0755 /opt/palantir/start.sh /opt/palantir/console.sh; \
  chmod 0444 /opt/palantir/paper.jar; \
  ln -s /opt/palantir/console.sh /usr/local/bin/palantir-console

USER 1000:1000

# Alles Veränderliche liegt im Datenordner; das Wurzeldateisystem darf
# schreibgeschützt sein. Paper legt `world/`, `logs/`, `plugins/`, `cache/`,
# `libraries/` und `versions/` relativ zum Arbeitsverzeichnis an – deshalb ist
# das Arbeitsverzeichnis der Datenordner und nicht `/opt`.
WORKDIR /data

EXPOSE 25565

# Sauberes Beenden: Paper hängt am SIGTERM einen Shutdown-Hook, der die Welt
# speichert. Das Signal muss deshalb bei der JVM ankommen – das Startskript
# ersetzt sich am Ende per `exec` durch `java`, es steht also keine Shell mehr
# dazwischen. Die Kulanzzeit setzt die Spieltyp-Definition
# (`stopTimeoutSeconds`), nicht dieses Image.
STOPSIGNAL SIGTERM
ENTRYPOINT ["/opt/palantir/start.sh"]
