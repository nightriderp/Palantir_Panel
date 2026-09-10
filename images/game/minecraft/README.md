# Minecraft

Das erste echte Spiel-Image (Lastenheft §7, Ausbaustufe 2). Der Prüfstand nebenan
(`images/test/minecraft`) stellt das Minecraft-Protokoll nach — hier läuft ein Server. Das
Schema aller Images steht in `images/README.md`.

| Enthalten             | Fassung                                                                          |
| --------------------- | -------------------------------------------------------------------------------- |
| Paper                 | 26.2, Build 121 (Kanal `STABLE`), im Image, Prüfsumme im Bau                     |
| Vanilla               | 26.2, beim ersten Start geholt, Prüfsumme im Image                               |
| Basis                 | `palantir-base-java:3` (`images/base/java`): Temurin 25 JRE, UID 1000, `java.sh` |
| Spieltyp-Definitionen | `minecraft-paper` und `minecraft-vanilla` in `apps/backend/.../game-registry.ts` |

## Zwei Ausgaben, ein Image

`MINECRAFT_EDITION` entscheidet: `paper` (Vorgabe) oder `vanilla`. Alles andere ist gleich —
EULA, `server.properties`, RCON, Heap, Konsole, Hostname-Routing. Ein zweites Image wäre eine
zweite Abschrift desselben Startskripts gewesen; das Panel unterscheidet die beiden ohnehin
über zwei Spieltyp-Definitionen, nicht über zwei Images.

| Ausgabe   | Jar                                              | Wofür                                                       |
| --------- | ------------------------------------------------ | ----------------------------------------------------------- |
| `paper`   | `/opt/palantir/paper.jar`, im Image              | Schneller, Plugins, der Normalfall                          |
| `vanilla` | `/data/.palantir/vanilla/minecraft_server-*.jar` | So, wie Mojang das Spiel meint: Redstone, Mobs, Datenpakete |

## Warum ein eigenes Image

`itzg/minecraft-server` ist vor dem Hochlauf gescheitert (Fundpunkt 113, PR #166): Es startet
als `root`, schreibt seinen Datenordner um und wechselt danach den Benutzer. Alle drei
Schritte scheitern an `CapDrop: ALL` und `no-new-privileges` (Pflichtenheft §2.3). Die Härtung
bleibt; dieses Image fügt sich:

| Regel                     | Umsetzung                                                        |
| ------------------------- | ---------------------------------------------------------------- |
| Fester Benutzer, UID 1000 | Aus dem Basis-Image; `root` nur im Bau, `USER 1000:1000` am Ende |
| Kein `chown` im Start     | `start.sh` fasst keine Rechte an                                 |
| Kein Benutzerwechsel      | `exec java` als derselbe Benutzer, kein `su`, kein `gosu`        |
| Keine setuid-Binaries     | Startpfad ist `/opt/palantir` + die JRE                          |
| Schreibt nur in `/data`   | Welt, Logs, Plugins, JVM-Temp — alles im Datenordner             |

## EULA von Mojang

**Der Server startet nicht, solange nicht zugestimmt wurde.** Die Zustimmung ist eine
Rechtsentscheidung des Betreibers; ein Image, das `eula=true` von sich aus schreibt, nimmt sie
ihm ab. Sie steht deshalb als Konfigurationsfeld `eula` (Vorgabe `false`) im Panel und kommt
als `EULA=true` im Container an. Ohne sie endet der Start mit Exit-Code 78 (`EX_CONFIG`) und
einer Erklärung im Log; `eula.txt` wird dann auch nicht geschrieben.

<https://aka.ms/MinecraftEULA>

## Woher der Server-Code kommt

Die **Paper-Jar liegt im Image** und wird beim Bau mit ihrer SHA-256-Prüfsumme geholt. Gründe:

- Ein Spiel-Image-Tag steht für genau einen Inhalt (`game-images.yml`). Läge die Jar erst zur
  Laufzeit im Datenordner, hinge die Serverfassung an der Quelle im Netz statt am Tag.
- Das Wurzeldateisystem ist schreibgeschützt; ein Laufzeit-Download landete in jedem
  Server-Datenordner und damit in jeder Sicherung — 65 MiB pro Server, die sich nie ändern.
- Der Start braucht kein Netz für Paper selbst.

Paper darf weitergegeben werden (GPLv3, <https://github.com/PaperMC/Paper>). **Der Server von
Mojang darf es nicht** — die Paper-Jar enthält ihn deshalb nicht, sondern lädt ihn beim
_ersten_ Start selbst nach und patcht ihn. Das ist der eine Download, der sich nicht in den Bau
verlegen lässt; er braucht Internet auf der Node (die Egress-Regeln erlauben es) und ist der
Grund für die großzügige Startzeit-Grenze.

Aus demselben Grund liegt **die Vanilla-Jar nicht im Image**. `start.sh` holt sie beim ersten
Start nach `/data/.palantir/vanilla/` und prüft sie gegen die SHA-256 aus dem Dockerfile; beim
zweiten Start ist sie da und es passiert nichts. Die Adresse ist über den SHA-1 des Inhalts
gebildet (`piston-data.mojang.com/v1/objects/<sha1>/server.jar`), die Serverfassung hängt also
trotzdem am Image-Tag. Was nicht zur Prüfsumme passt, wird verworfen und der Start endet mit
Exit-Code 69 (`EX_UNAVAILABLE`) — unterscheidbar von 78 (Einstellung falsch) und von einem
Absturz.

Sie liegt im internen Unterordner und nicht neben den Welten: Sie gehört Palantir, nicht dem
Betreiber, und hat in der Dateiverwaltung nichts zu suchen.

## Einstellungen

Alles über Umgebungsvariablen, gesetzt vom Panel über `envMapping` der Spiel-Definition. Das
Startskript schreibt genau diese Schlüssel nach `server.properties` und lässt jeden anderen
unberührt — `online-mode`, `level-seed`, `spawn-protection` und der Rest gehören dem Betreiber
und lassen sich über die Dateiverwaltung setzen.

| Variable                      | Vorgabe               | Schlüssel in `server.properties`  |
| ----------------------------- | --------------------- | --------------------------------- |
| `EULA`                        | –                     | `eula.txt` (nur bei `true`)       |
| `MOTD`                        | `Ein Palantir-Server` | `motd`                            |
| `MAX_PLAYERS`                 | `20`                  | `max-players`                     |
| `GAMEMODE`                    | `survival`            | `gamemode`                        |
| `DIFFICULTY`                  | `normal`              | `difficulty`                      |
| `VIEW_DISTANCE`               | `10`                  | `view-distance`                   |
| `WHITELIST`                   | `false`               | `white-list`, `enforce-whitelist` |
| `SERVER_PORT`                 | `25565`               | `server-port`                     |
| `MINECRAFT_EDITION`           | `paper`               | keiner — wählt die Jar            |
| `PALANTIR_STARTUP_PARAMETERS` | –                     | zusätzliche JVM-Schalter          |

`PALANTIR_STARTUP_PARAMETERS` zerfällt an Leerzeichen; Anführungszeichen werden nicht
ausgewertet (das Backend reicht freien Text bewusst als eine Zeichenkette durch, siehe
`container-spec.ts`). Für JVM-Schalter reicht das.

## Arbeitsspeicher

Das RAM-Kontingent des Servers erreicht den Container **nur als cgroup-Grenze**
(`HostConfig.Memory`), es gibt keine Umgebungsvariable damit. Die Rechnung — Heap =
Kontingent − Rücklage — liegt in `java.sh` des Basis-Images (`images/base/java/README.md`,
dort auch die Tabelle); `start.sh` bindet die Bibliothek ein und gibt das Ergebnis als erste
Schalter an die JVM. Ist die Grenze nicht lesbar, bleibt es bei `-XX:MaxRAMPercentage=70`.

## `/tmp` ist `noexec`

Der Agent hängt das tmpfs mit `rw,noexec,nosuid,nodev,size=64m` ein (`TMPFS_OPTIONS` in
`apps/agent/src/runtime/hardening.ts`). Netty entpackt seine native Transport-Bibliothek ins
temporäre Verzeichnis und lädt sie von dort — auf einem `noexec`-Mount scheitert genau das.
Gelöst über `-Djava.io.tmpdir` und `-Dio.netty.native.workdir` in den Datenordner
(`/data/.palantir/tmp`), dessen Bind-Mount ohne `noexec` eingehängt wird. Das tmpfs
ausführbar zu machen wäre die falsche Richtung.

## Konsole

Das Panel spricht die Konsole **über RCON** an (seit Fassung 2, P2-9). `start.sh` schaltet
`enable-rcon` ein, erzeugt bei jedem Start ein neues Passwort (24 Zufallsbytes als Hex) und legt
es unter `/data/.palantir/rcon.password` ab (0600). Der Agent liest es von dort und spricht den
Container an seiner Adresse im Spielenetz auf Port 25575 an – die Antwort eines Befehls kommt so
zurück und steht in der Live-Konsole, statt nur im Log zu stehen.

Was das bedeutet:

- Der RCON-Port wird **nie veröffentlicht**. Erreichbar ist er nur im Spielenetz, und dort nur
  von der festen Adresse des Agents (`deploy/gamenode/egress-firewall.sh`).
- Das Passwort verlässt die Node nicht. Es steht auch in `server.properties` (`rcon.password`),
  weil Paper es dort liest – wer den Datei-Manager hat, sieht es; wer den hat, darf ohnehin
  Befehle geben.
- `broadcast-rcon-to-ops=false`, sonst sähe jeder Op im Spiel jeden Befehl aus dem Panel.

Daneben bleibt der Weg über die Standardeingabe:

```
palantir-console list
palantir-console say Wartungsarbeiten in 5 Minuten
palantir-console whitelist add Spielername
palantir-console stop
```

`start.sh` legt ein benanntes Rohr an (`/data/.palantir/console.in`) und hängt die
Standardeingabe des Servers daran; `palantir-console` schreibt hinein. Das nutzt, wer `docker
exec` von Hand macht – die Antwort steht dann im Live-Log, nicht in der Ausgabe des Befehls.

Exit-Codes wie beim Prüfstand: `0` übergeben, `1` Konsole nicht erreichbar, `2` kein Befehl.

## Tests

`start.test.mjs` ruft `start.sh` mit `sh` auf und schiebt ein `java` in den PATH, das nur seine
Argumente ausgibt — **kein Docker, kein Minecraft, keine JVM nötig**. Geprüft werden die
Entscheidungen des Skripts: EULA-Sperre, verwaltete Schlüssel in `server.properties`
(inklusive fremder Schlüssel, Kommentaren und Dubletten), die Übernahme des Heaps aus dem
Basis-Image (die Rechnung selbst prüft `images/base/java/java.test.mjs`), das temporäre
Verzeichnis und die Wahl der Jar. Für Vanilla steht statt `curl` eine Attrappe im PATH, die
eine kleine Datei ausliefert — ein Test, der 60 MiB von Mojang lädt, prüfte die Leitung.

`palantir-console` steht seit Fassung 4 in der Wurzel (`images/base/linux`) und wird dort
geprüft.

```bash
# im Verbund, so wie die CI es tut
pnpm test

# nur dieses Image
pnpm --filter @palantir/minecraft-image test
```

Ohne POSIX-Shell im PATH überspringt sich die Datei mit einem Hinweis, statt zu scheitern.

**Nicht geprüft und nur im echten Lauf sichtbar:** ob Paper oder Vanilla mit diesen Schaltern
startet, ob die Jar zur JVM passt, ob der Nachladevorgang von Mojang innerhalb der
Startzeit-Grenze bleibt und ob `gamedig` den Server erkennt.

## Von Hand prüfen

```bash
docker run --rm -p 25565:25565 \
  --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges:true \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  -m 4g -e EULA=true -v "$PWD/probe:/data" \
  ghcr.io/nightriderp/palantir-game-minecraft:5
```

Dieselbe Zeile mit `-e MINECRAFT_EDITION=vanilla` startet den Server von Mojang; der erste Lauf
holt dann rund 60 MiB und braucht Netz.

Der Ordner `probe` muss vorher existieren und UID 1000 gehören — auf der Node legt ihn der
Agent an (Fundpunkt 117). Ohne `-e EULA=true` endet der Lauf mit 78 und einer Erklärung.

## Fassung erhöhen

Ein Spiel-Image-Tag wird nie überschrieben. Wer Paper oder ein Skript ändert:

1. **Paper:** neue Prüfsumme aus
   `https://fill.papermc.io/v3/projects/paper/versions/<Fassung>/builds/latest` in den
   `ARG`-Block des Dockerfiles.
   **Vanilla:** Fassung, Adresse und SHA-256 in den `ENV`-Block; die Befehle dafür stehen als
   Kommentar daneben. Die dort genannte `javaVersion` muss zu `base/java` passen.
2. Zahl in `VERSION` erhöhen,
3. `dockerImage` in `game-registry.ts` auf das neue Tag ziehen (der Test dort hält das fest).
   Beide Definitionen teilen sich die Zeile — `minecraft-vanilla` übernimmt sie von
   `minecraft-paper`.

Die JRE kommt aus dem Basis-Image. Eine neue Fassung dort erreicht dieses Image erst, wenn
`BASIS` im Dockerfile umgestellt wird — dann Schritte 2 und 3.
