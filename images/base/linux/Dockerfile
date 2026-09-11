# Basis-Image aller Spiel-Images (`palantir-base-linux`).
#
# Kein Spiel und keine Laufzeit – die gemeinsame Wurzel. Darauf setzen sowohl
# die Laufzeit-Basen (`base/java`, später `base/steam`, `base/dotnet`) als auch
# Spiel-Images auf, die nichts weiter brauchen als ein Linux (Factorio,
# Minecraft Bedrock, Terraria).
#
# Es bringt genau das mit, was jeder Spielserver unter der Härtung des Agents
# braucht (Pflichtenheft §2.3), und nichts, was nur ein bestimmtes Spiel braucht:
#
#   - die feste, nicht-root Identität UID 1000 – die UID, der der Datenordner
#     auf dem Homeserver gehört (Fundpunkt 117: der Agent legt ihn als 1000 an
#     und kann ihn mangels Capabilities niemandem verschenken),
#   - `/data` als Arbeitsverzeichnis: Alles Veränderliche liegt dort, das
#     Wurzeldateisystem darf schreibgeschützt sein,
#   - SIGTERM als Stoppsignal,
#   - `/opt/palantir/lib/palantir.sh`: Datenordner, Konsolen-Rohr, Holen einer
#     Datei mit geprüfter Prüfsumme,
#   - `palantir-console`: der Konsolen-Anschluss für Server, die Befehle von der
#     Standardeingabe lesen,
#   - `curl` und die Wurzelzertifikate,
#   - `unzip` (seit Fassung 2) und `xz-utils` (seit Fassung 3).
#
# **Warum `unzip`** (seit Fassung 2): Wenn die Serverdateien im Datenordner
# landen und nicht im Image, kommen sie als Archiv – und ein Zip lässt sich mit
# Bordmitteln einer POSIX-Shell nicht auspacken (`tar` kann es nicht). Terraria
# ist der erste Fall, Minecraft Bedrock und die Mod-Loader der Java-Welt sind
# die nächsten. Das Paket wiegt rund 400 KB.
#
# **Warum `xz-utils`** (seit Fassung 3): Dieselbe Frage für die andere Hälfte
# der Archive. `tar` liegt im Abbild, aber ohne `xz` kann es `.tar.xz` nicht
# lesen – und genau so gibt Factorio seinen Server heraus. Ob das Paket in
# `ubuntu:24.04` ohnehin steckt, ist keine Zusage, auf die sich ein Image
# stützen sollte: Was gebraucht wird, wird genannt.
#
# **Warum `curl` im Laufzeit-Image** (Entscheidung des Betreibers, 2026-09-10):
# Serverdateien kommen in den Datenordner, nicht ins Image. Der erste Start holt
# sie also, und dafür braucht der Container ein Werkzeug. Die Begründung steht
# ausführlich in `palantir.sh` bei `palantir_datei_holen`. Der Preis ist ein
# Programm mehr im Container; der Egress-Filter der Node begrenzt ohnehin, wohin
# es überhaupt sprechen darf (`deploy/gamenode/egress-firewall.sh`).
#
# **Warum diese Wurzel überhaupt:** Benutzer, Datenordner, Stoppsignal und
# Konsole stünden sonst in jeder Laufzeit-Basis noch einmal – und drifteten
# auseinander. `base/java` hat sie bis Fassung 2 selbst getragen; seit Fassung 3
# erbt es sie von hier.
#
# **Die Fassung `:<n>` ist unveränderlich** (game-images.yml überschreibt kein
# Versions-Tag). Ein aufsetzendes Image zeigt deshalb per Tag hierher, wo es bei
# einem fremden Image den Digest bräuchte. Wer Ubuntu erneuert, erhöht die Zahl
# in `VERSION`; die darauf aufsetzenden Images ziehen nach, wenn sie wollen.
#
# Der Digest wird von `.github/dependabot.yml` (Ökosystem `docker`) nachgehalten.
# sha256:224a18… ist der Multi-Arch-Index hinter `ubuntu:24.04`, Stand 2026-09.
# 24.04 und nicht 26.04: Dieselbe Grundlage wie das bisherige `eclipse-temurin`
# in `base/java`, der Umzug ändert damit die Laufzeitumgebung nicht mit.
#
# **Und nur LTS.** Bei Ubuntu ist die Nebenfassung keine kleinere Anhebung: Die
# Fassungen vom April gerader Jahre werden fünf Jahre gepflegt, alle anderen
# neun Monate. Ein Vorschlag auf 24.10 kam (Dependabot, PR #341) und war
# abzulehnen — jene Fassung war zu dem Zeitpunkt schon abgekündigt. Auf dieser
# Wurzel sitzt jedes Spiel-Image; sie gehört auf LTS. `.github/dependabot.yml`
# übergeht Haupt- **und** Nebenfassungen und zieht nur noch den Digest nach.
FROM ubuntu:24.04@sha256:224a1869083a311ef3f13648a154ba79832fbef6364d31493642ca03082da254

# Ein Schritt, damit die Paketlisten nicht in einer eigenen Schicht liegen
# bleiben. `tzdata`, weil Server ihre Logzeilen sonst in UTC schreiben und der
# Betreiber im Panel Zeiten sieht, die zu nichts passen.
RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends ca-certificates curl tzdata unzip xz-utils; \
  rm -rf /var/lib/apt/lists/*; \
  if ! getent passwd 1000 > /dev/null; then \
  groupadd --gid 1000 palantir; \
  useradd --uid 1000 --gid 1000 --no-create-home --home-dir /data --shell /usr/sbin/nologin palantir; \
  fi; \
  mkdir -p /opt/palantir/lib

COPY palantir.sh /opt/palantir/lib/palantir.sh
COPY console.sh /opt/palantir/console.sh

# Rechte hier statt im Kontext: Ein Arbeitsplatz unter Windows gibt Dateirechte
# nicht mit, und ein Image, das je nach Auscheck-Plattform anders aussieht, ist
# keins. Die Bibliothek wird eingebunden, nicht ausgeführt – nur lesbar.
#
# `palantir-console` muss ohne Shell aufrufbar sein: `EXEC_CONSOLE` übergibt eine
# Argumentliste, kein Kommando für `sh -c` – und die Zeile aus der Panel-Konsole
# wird an Leerzeichen zerlegt, argv[0] ist also genau dieser Name.
RUN set -eux; \
  chmod 0444 /opt/palantir/lib/palantir.sh; \
  chmod 0755 /opt/palantir/console.sh; \
  ln -s /opt/palantir/console.sh /usr/local/bin/palantir-console

USER 1000:1000

# Alles Veränderliche liegt im Datenordner. Der Agent hängt ihn hier ein
# (`dataVolumeContainerPath` in der Spieltyp-Definition); ein Spiel-Image, das
# relativ zum Arbeitsverzeichnis schreibt, landet damit von selbst dort.
WORKDIR /data

# Sauberes Beenden: Fast jeder Spielserver speichert beim SIGTERM. Das Signal
# muss beim Server ankommen – das Startskript eines Spiel-Images ersetzt sich am
# Ende per `exec` durch ihn, es steht also keine Shell dazwischen.
STOPSIGNAL SIGTERM
