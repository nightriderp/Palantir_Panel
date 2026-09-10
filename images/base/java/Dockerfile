# Basis-Image für Java-Spiele (`palantir-base-java`).
#
# Kein Spiel – die Grundlage, auf der Java-Spiel-Images aufsetzen
# (`images/game/minecraft` ist das erste). Es fügt der gemeinsamen Wurzel
# `palantir-base-linux` genau zwei Dinge hinzu, und sonst nichts:
#
#   - eine JRE (Eclipse Temurin), per Prüfsumme gepinnt,
#   - `/opt/palantir/lib/java.sh`: die Rechnung des Heaps aus der cgroup-Grenze.
#
# Alles Übrige kommt aus der Wurzel: die feste, nicht-root Identität UID 1000,
# `/data` als Arbeitsverzeichnis, SIGTERM als Stoppsignal, `palantir-console`,
# `palantir.sh` und `curl`. Bis Fassung 2 trug dieses Image sie selbst und saß
# dafür auf `eclipse-temurin`; seit Fassung 3 stehen sie an einer Stelle
# (`images/base/linux`, Entscheidung des Betreibers am 2026-09-10).
#
# Was ein Spiel-Image darauf noch tut, steht in `images/README.md`: Server
# holen oder hineinkopieren, Startskript anlegen, `USER 1000:1000`
# wiederherstellen, `ENTRYPOINT` setzen. Ein `chown` oder ein Benutzerwechsel
# zur Laufzeit gehört nicht dazu – beides scheitert an `CapDrop: ALL` und
# `no-new-privileges` mit „operation not permitted" (Fundpunkt 113, PR #166).
#
# **Die Fassung `:<n>` ist unveränderlich** (game-images.yml überschreibt kein
# Versions-Tag). Deshalb genügt einem Spiel-Image das Tag, wo es bei fremden
# Images den Digest bräuchte: Hinter `palantir-base-java:3` steht für immer
# derselbe Inhalt. Wer Java oder die Wurzel erneuert, erhöht die Zahl in
# `VERSION`; ein Spiel-Image zieht nach, wenn es das will, indem es sein `FROM`
# auf die neue Fassung setzt – und dafür seinerseits `VERSION` erhöht.
#
# **Warum Temurin 25:** Paper 26.2 – das erste Spiel – verlangt laut
# `fill.papermc.io/v3/projects/paper/versions/26.2` Java 25 als Mindestfassung.
# Ein Spiel, das eine ältere Java-Hauptfassung braucht (alte Minecraft-Fassungen,
# Forge-Modpacks), bekommt ein eigenes Basis-Image daneben (`base/java21` →
# `palantir-base-java21`), keinen Schalter in diesem.
ARG BASIS=ghcr.io/nightriderp/palantir-base-linux:1

# -----------------------------------------------------------------------------
# Stufe 1: die JRE holen und die Prüfsumme prüfen.
#
# **Warum der Tarball und nicht mehr das Image `eclipse-temurin`:** Das Image
# bringt seine eigene Grundlage mit, und genau die soll aus der Wurzel kommen.
# Der Tarball ist derselbe Inhalt ohne diese Grundlage – Adoptium veröffentlicht
# ihn zu jeder Fassung samt SHA-256.
#
# Fassung und Prüfsumme gehören zusammen und werden gemeinsam getauscht; die
# Quelle ist `api.adoptium.net/v3/assets/latest/25/hotspot`. Wer sie ändert,
# erhöht die Zahl in `VERSION`.
#
# Die Stufe läuft als `root`, weil sie nach `/opt` schreibt, und wird verworfen;
# ins Laufzeit-Image kommt nur der entpackte Baum.
FROM ${BASIS} AS jre
USER root

ARG JRE_VERSION=25.0.4.1_1
ARG JRE_URL=https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.4.1%2B1/OpenJDK25U-jre_x64_linux_hotspot_25.0.4.1_1.tar.gz
ARG JRE_SHA256=1731a34baadec5479258ea0202e4d5d865d2efeee60cb0c7d7eb056fe96ca219

RUN set -eux; \
  curl --fail --silent --show-error --location --retry 3 --output /jre.tar.gz "${JRE_URL}"; \
  echo "${JRE_SHA256}  /jre.tar.gz" | sha256sum --check --strict -; \
  mkdir -p /opt/java; \
  tar --extract --file /jre.tar.gz --directory /opt/java --strip-components=1; \
  rm -f /jre.tar.gz; \
  /opt/java/bin/java -version

# -----------------------------------------------------------------------------
# Stufe 2: das Laufzeit-Image. Benutzer, Arbeitsverzeichnis, Stoppsignal und
# Konsole kommen aus der Wurzel; `root` nur für das Hineinkopieren.
FROM ${BASIS}
USER root

COPY --from=jre /opt/java /opt/java
COPY java.sh /opt/palantir/lib/java.sh

# `java` muss ohne vollen Pfad aufrufbar sein: Ein Startskript ruft es am Ende
# per `exec java` auf, und ein Spiel-Image soll dafür nichts wissen müssen.
#
# Rechte hier statt im Kontext: Ein Arbeitsplatz unter Windows gibt Dateirechte
# nicht mit, und ein Image, das je nach Auscheck-Plattform anders aussieht, ist
# keins. Die Bibliothek wird eingebunden, nicht ausgeführt – nur lesbar.
RUN set -eux; \
  chmod 0444 /opt/palantir/lib/java.sh; \
  ln -s /opt/java/bin/java /usr/local/bin/java; \
  java -version

ENV JAVA_HOME=/opt/java

USER 1000:1000
