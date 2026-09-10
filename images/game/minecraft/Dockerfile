# Minecraft – das erste echte Spiel-Image (Lastenheft §7, Ausbaustufe 2).
#
# **Zwei Ausgaben aus einem Image** (Wunsch des Betreibers, 2026-09-10: „will
# auch Minecraft Vanilla zur Auswahl haben"): `MINECRAFT_EDITION=paper` (Vorgabe)
# und `=vanilla`. Alles außer der Jar ist bei beiden gleich – EULA,
# `server.properties`, RCON, Heap, Konsole –, und das Panel unterscheidet sie
# über zwei Spieltyp-Definitionen, nicht über zwei Images. Zwei Images hießen
# zwei Kopien desselben Startskripts.
#
# Der Prüfstand nebenan (`images/test/minecraft`) stellt das Minecraft-Protokoll
# nach; hier läuft ein echter Server. Die Regeln bleiben dieselben, und sie sind
# der Grund, warum dieses Image überhaupt existiert: Der naheliegende Weg über
# `itzg/minecraft-server` ist vor dem Hochlauf gescheitert (Fundpunkt 113,
# PR #166). Jenes Image startet als `root`, schreibt seinen Datenordner um und
# wechselt danach den Benutzer – alle drei Schritte scheitern an `CapDrop: ALL`
# und `no-new-privileges` (Pflichtenheft §2.3) mit „operation not permitted".
#
# Die Härtung bleibt, das Image fügt sich – und das meiste davon erbt es. Von
# `palantir-base-java` die JRE und die Rechnung des Heaps
# (`/opt/palantir/lib/java.sh`), von der Wurzel `palantir-base-linux` darunter
# den festen Benutzer UID 1000 (die UID des Datenordners auf dem Homeserver,
# Fundpunkt 117), `/data` als Arbeitsverzeichnis, SIGTERM als Stoppsignal,
# `palantir-console` und die Bibliothek `palantir.sh`.
#
# Hier bleibt, was nur Minecraft betrifft: die Paper-Jar, die EULA,
# `server.properties`, RCON. Kein `chown` im Startskript, kein Benutzerwechsel
# zur Laufzeit, geschrieben wird nur in den Datenordner und nach `/tmp`.
#
# **`console.sh` liegt seit Fassung 4 nicht mehr hier.** Der Anschluss ist bei
# jedem Server gleich, der Befehle von der Standardeingabe liest; er steht
# deshalb in der Wurzel und kommt von dort.
#
# **Warum ein Versions-Tag und kein Digest:** Bei einem fremden Image wandert der
# Tag und nur der Digest steht fest. `palantir-base-java:<n>` wird dagegen nie
# überschrieben (spiel-image-bauen.yml) – hinter dem Tag steht für immer
# derselbe Inhalt, und der pinnt seinerseits Temurin per Digest. Wer die Basis
# erneuert (neue Fassung dort), setzt `BASIS` hier um und erhöht `VERSION`.
#
# **Warum Temurin 25 und nicht 21:** Paper 26.2 verlangt laut
# `fill.papermc.io/v3/projects/paper/versions/26.2` Java 25 als Mindestfassung;
# genau die trägt `base/java`.
ARG BASIS=ghcr.io/nightriderp/palantir-base-java:3

# -----------------------------------------------------------------------------
# Stufe 1: Paper holen und die Prüfsumme prüfen.
#
# Die Jar wird **im Bau** geholt und nicht beim ersten Start:
#   - Ein Spiel-Image-Tag steht für genau einen Inhalt (images/README.md). Läge
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
# dieser Stufe hinzu und landet nie im fertigen Image – die Stufe läuft als
# `root`, weil `apt-get` es braucht, und wird verworfen; ins Laufzeit-Image
# kommt nur die Jar.
FROM ${BASIS} AS paper
USER root

# Fassung und Prüfsumme gehören zusammen und werden gemeinsam getauscht. Wer sie
# ändert, erhöht die Zahl in `VERSION` und zieht `dockerImage` in der
# Spieltyp-Definition nach (images/README.md).
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
# Stufe 2: das Laufzeit-Image. Benutzer, Arbeitsverzeichnis und Stoppsignal
# kommen aus der Basis; `root` nur für das Hineinkopieren.
FROM ${BASIS}
USER root

COPY start.sh /opt/palantir/
COPY --from=paper /paper.jar /opt/palantir/paper.jar

# Rechte hier statt im Kontext: Ein Arbeitsplatz unter Windows gibt das
# Ausführungsbit nicht mit, und ein Image, das je nach Auscheck-Plattform anders
# aussieht, ist keins. `palantir-console` samt Verweis kommt aus der Wurzel.
RUN set -eux; \
  chmod 0755 /opt/palantir/start.sh; \
  chmod 0444 /opt/palantir/paper.jar

USER 1000:1000

# -----------------------------------------------------------------------------
# Die zweite Ausgabe: Vanilla, der Server von Mojang.
#
# Er darf **nicht** weitergegeben werden und kann deshalb nicht im Image liegen.
# Das Startskript holt ihn bei der Ausgabe `vanilla` in den Datenordner und
# prüft die Prüfsumme; hier stehen nur Adresse und Summe.
#
# Damit hängt die Serverfassung trotzdem am Image-Tag und nicht an dem, was die
# Quelle gerade liefert: Die Adresse ist über den SHA-1 des Inhalts gebildet
# (`piston-data.mojang.com/v1/objects/<sha1>/server.jar`), und die SHA-256 hier
# prüft ein zweites Mal. Wer die Fassung wechselt, tauscht alle drei Werte und
# erhöht `VERSION`.
#
# Neue Werte holen (`26.3` ersetzen; die Java-Mindestfassung steht im selben
# Dokument unter `javaVersion` und muss zu `base/java` passen):
#
#   meta=$(curl -s https://launchermeta.mojang.com/mc/game/version_manifest_v2.json \
#     | jq -r '.versions[] | select(.id == "26.3") | .url')
#   curl -s "$meta" | jq '.downloads.server, .javaVersion'
#   curl -sL <url> | sha256sum
ENV MINECRAFT_VANILLA_VERSION=26.2
ENV MINECRAFT_VANILLA_URL=https://piston-data.mojang.com/v1/objects/823e2250d24b3ddac457a60c92a6a941943fcd6a/server.jar
ENV MINECRAFT_VANILLA_SHA256=cdacdfb25898de5e4b4b0e5ddcc2722f77067e46605709c2d886c000ebb63ec5

# Paper legt `world/`, `logs/`, `plugins/`, `cache/`, `libraries/` und
# `versions/` relativ zum Arbeitsverzeichnis an – das ist `/data` aus der Basis,
# also der Datenordner. Vanilla legt dort dasselbe an, dazu `bundler/`: Die Jar
# von Mojang ist ein Bündel, das seine Bestandteile beim ersten Start neben sich
# auspackt.

EXPOSE 25565

# Sauberes Beenden: Paper hängt am SIGTERM einen Shutdown-Hook, der die Welt
# speichert. Das Signal (STOPSIGNAL aus der Basis) muss bei der JVM ankommen –
# das Startskript ersetzt sich am Ende per `exec` durch `java`, es steht also
# keine Shell mehr dazwischen. Die Kulanzzeit setzt die Spieltyp-Definition
# (`stopTimeoutSeconds`), nicht dieses Image.
ENTRYPOINT ["/opt/palantir/start.sh"]
