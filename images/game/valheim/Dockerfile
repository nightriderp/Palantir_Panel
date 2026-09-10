# Valheim – das erste Spiel aus Steam (Lastenheft Anhang A, Phase 3).
#
# Der Unterschied zu Minecraft ist nicht das Spiel, sondern woher die
# Serverdateien kommen: Paper liegt als Jar im Image, Valheim holt SteamCMD beim
# Start in den Datenordner. Alles, was dabei bei jedem Steam-Spiel gleich ist,
# steht im Basis-Image (`palantir-base-steam`); hier bleibt, was nur Valheim
# betrifft – die Anwendungsnummer, das Passwort, die Trennung von Serverdateien
# und Welten.
#
# Das Image selbst ist deshalb winzig: ein Startskript, sonst nichts. Es erbt
# von `palantir-base-steam` SteamCMD und `steam.sh`, und von der Wurzel
# `palantir-base-linux` darunter den festen Benutzer UID 1000, `/data` als
# Arbeitsverzeichnis, SIGTERM als Stoppsignal, `palantir-console` und
# `palantir.sh`.
#
# **Warum ein Versions-Tag und kein Digest:** `palantir-base-steam:<n>` wird nie
# überschrieben – hinter dem Tag steht für immer derselbe Inhalt. Wer die Basis
# erneuert, setzt `BASIS` hier um und erhöht `VERSION`.
#
# **Was die Fassung dieses Images NICHT festlegt:** die Fassung des Spiels. Die
# kommt von Valve und wird bei jedem Start geholt. Das ist der Preis dafür, dass
# dreißig Gigabyte Spieldaten nicht in einer Registry liegen (siehe
# `images/base/linux/palantir.sh`).
ARG BASIS=ghcr.io/nightriderp/palantir-base-steam:1

FROM ${BASIS}
USER root

COPY start.sh /opt/palantir/

# Rechte hier statt im Kontext: Ein Arbeitsplatz unter Windows gibt das
# Ausführungsbit nicht mit, und ein Image, das je nach Auscheck-Plattform anders
# aussieht, ist keins. `palantir-console` samt Verweis kommt aus der Wurzel.
RUN chmod 0755 /opt/palantir/start.sh

USER 1000:1000

# Valheim spricht UDP, nicht TCP: 2456 für das Spiel, 2457 für die Abfrage der
# Serverliste. Beide stehen in der Spieltyp-Definition; `EXPOSE` ist nur
# Beschreibung, der Agent veröffentlicht die Ports.
EXPOSE 2456/udp 2457/udp

# Sauberes Beenden: Valheim speichert beim SIGTERM die Welt. Das Signal
# (STOPSIGNAL aus der Wurzel) muss beim Server ankommen – das Startskript
# ersetzt sich am Ende per `exec` durch ihn. Die Kulanzzeit setzt die
# Spieltyp-Definition (`stopTimeoutSeconds`), nicht dieses Image.
ENTRYPOINT ["/opt/palantir/start.sh"]
