# Basis-Image für Java-Spiele (`palantir-base-java`).
#
# Kein Spiel – die Grundlage, auf der Java-Spiel-Images aufsetzen
# (`images/game/minecraft` ist das erste). Es bringt genau das mit, was jeder
# Java-Server unter der Härtung des Agents braucht (Pflichtenheft §2.3), und
# nichts, was nur ein bestimmtes Spiel braucht:
#
#   - eine JRE (Eclipse Temurin), per Digest gepinnt,
#   - die feste, nicht-root Identität UID 1000 – die UID, der der Datenordner
#     auf dem Homeserver gehört (Fundpunkt 117: der Agent legt ihn als 1000 an
#     und kann ihn mangels Capabilities niemandem verschenken),
#   - `/opt/palantir/lib/java.sh`: die Rechnung des Heaps aus der cgroup-Grenze,
#   - `/data` als Arbeitsverzeichnis: Alles Veränderliche liegt dort, das
#     Wurzeldateisystem darf schreibgeschützt sein,
#   - SIGTERM als Stoppsignal.
#
# Was ein Spiel-Image darauf noch tut, steht in `images/README.md`: Server
# hineinkopieren, Startskript und `palantir-console` anlegen, `USER 1000:1000`
# wiederherstellen, `ENTRYPOINT` setzen. Ein `chown` oder ein Benutzerwechsel
# zur Laufzeit gehört nicht dazu – beides scheitert an `CapDrop: ALL` und
# `no-new-privileges` mit „operation not permitted" (Fundpunkt 113, PR #166).
#
# **Warum ein eigenes Basis-Image statt `eclipse-temurin` direkt in jedem
# Spiel:** Benutzer, Bibliothek und Konventionen stünden sonst in jedem
# Dockerfile noch einmal – und drifteten auseinander. Hier stehen sie einmal;
# ein Spiel-Image zeigt auf `palantir-base-java:<Fassung>` und erbt sie.
#
# **Die Fassung `:<n>` ist unveränderlich** (game-images.yml überschreibt kein
# Versions-Tag). Deshalb genügt einem Spiel-Image das Tag, wo es bei fremden
# Images den Digest bräuchte: Hinter `palantir-base-java:1` steht für immer
# derselbe Inhalt – und der pinnt seinerseits Temurin per Digest. Die Kette ist
# damit durchgehend festgeschrieben. Wer Java oder Ubuntu erneuert, erhöht die
# Zahl in `VERSION`; ein Spiel-Image zieht nach, wenn es das will, indem es sein
# `FROM` auf die neue Fassung setzt – und dafür seinerseits `VERSION` erhöht.
#
# **Warum Temurin 25:** Paper 26.2 – das erste Spiel – verlangt laut
# `fill.papermc.io/v3/projects/paper/versions/26.2` Java 25 als Mindestfassung.
# Ein Spiel, das eine ältere Java-Hauptfassung braucht (alte Minecraft-Fassungen,
# Forge-Modpacks), bekommt ein eigenes Basis-Image daneben (`base/java21` →
# `palantir-base-java21`), keinen Schalter in diesem. `-noble` statt `25-jre`,
# weil der unmarkierte Tag zusätzlich Windows-Images im Index führt; hier soll
# unmissverständlich Ubuntu 24.04 stehen.
#
# Der Digest wird von `.github/dependabot.yml` (Ökosystem `docker`) nachgehalten.
# sha256:1e8020… ist der Multi-Arch-Index (linux/amd64, arm64v8, ppc64le,
# riscv64, s390x) hinter `eclipse-temurin:25-jre-noble`, Stand 2026-09
# (Dependabot #317; davor sha256:b4c93a… mit JRE 25.0.4+7).
FROM eclipse-temurin:25-jre-noble@sha256:1e80201efc21b839ebc9b448b1f9b16aa5f036dd2885148282fe5dae38684fe1

# Feste, nicht-root Identität. Ubuntu 24.04 vergibt UID 1000 bereits an den
# Benutzer `ubuntu`; dann bleibt es dabei, denn entscheidend ist die Zahl, nicht
# der Name. Ist 1000 frei, entsteht `palantir` mit genau dieser UID.
RUN set -eux; \
  if ! getent passwd 1000 > /dev/null; then \
  groupadd --gid 1000 palantir; \
  useradd --uid 1000 --gid 1000 --no-create-home --home-dir /data --shell /usr/sbin/nologin palantir; \
  fi; \
  mkdir -p /opt/palantir/lib

COPY java.sh /opt/palantir/lib/java.sh

# Rechte hier statt im Kontext: Ein Arbeitsplatz unter Windows gibt Dateirechte
# nicht mit, und ein Image, das je nach Auscheck-Plattform anders aussieht, ist
# keins. Nur lesbar – eingebunden wird die Datei, nicht ausgeführt.
RUN chmod 0444 /opt/palantir/lib/java.sh

USER 1000:1000

# Alles Veränderliche liegt im Datenordner. Der Agent hängt ihn hier ein
# (`dataVolumeContainerPath` in der Spieltyp-Definition); ein Spiel-Image, das
# relativ zum Arbeitsverzeichnis schreibt, landet damit von selbst dort.
WORKDIR /data

# Sauberes Beenden: Ein Java-Server hängt am SIGTERM seinen Shutdown-Hook. Das
# Signal muss bei der JVM ankommen – das Startskript eines Spiel-Images ersetzt
# sich am Ende per `exec` durch `java`, es steht also keine Shell dazwischen.
STOPSIGNAL SIGTERM
