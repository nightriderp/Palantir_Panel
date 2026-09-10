# Basis-Image: Java (`palantir-base-java`)

Die Grundlage für Java-Spiel-Images (`images/game/minecraft` ist das erste). Kein Spiel — das
Image hat keinen `ENTRYPOINT` und startet für sich allein nichts. Das Schema aller Images
steht in `images/README.md`.

| Enthalten                   | Fassung                                                    |
| --------------------------- | ---------------------------------------------------------- |
| Grundlage                   | `palantir-base-linux` — Benutzer, `/data`, Konsole, `curl` |
| Java                        | Eclipse Temurin 25 JRE als Tarball, per SHA-256 gepinnt    |
| `/opt/palantir/lib/java.sh` | Heap aus der cgroup-Grenze (siehe unten)                   |

Seit Fassung 3 sitzt dieses Image auf der gemeinsamen Wurzel `palantir-base-linux`, nicht mehr
auf `eclipse-temurin`. Benutzer, Arbeitsverzeichnis, Stoppsignal, `palantir-console` und
`palantir.sh` kommen von dort; hier bleiben JRE und Heap-Rechnung. Die JRE ist deshalb der
Tarball von Adoptium statt eines fremden Images — derselbe Inhalt ohne dessen eigene Grundlage.

## Was ein Spiel-Image davon erbt

Alles, was die Härtung des Agents (Pflichtenheft §2.3) von jedem Java-Server verlangt und was
sonst in jedem Dockerfile noch einmal stünde. Ein Spiel-Image setzt darauf auf:

```dockerfile
ARG BASIS=ghcr.io/nightriderp/palantir-base-java:3
FROM ${BASIS}

USER root
COPY start.sh /opt/palantir/
RUN chmod 0755 /opt/palantir/start.sh
USER 1000:1000

EXPOSE 25565
ENTRYPOINT ["/opt/palantir/start.sh"]
```

`root` nur im Bau, `USER 1000:1000` vor dem Ende — zur Laufzeit gibt es keinen Benutzerwechsel
und kein `chown`, beides scheitert an `CapDrop: ALL` und `no-new-privileges`.

## `java.sh`

Wird vom Startskript eingebunden, nicht ausgeführt:

```sh
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/java.sh"

if java_heap_bestimmen; then
  log "RAM-Kontingent ${JAVA_KONTINGENT_MIB} MiB, davon ${JAVA_HEAP_MIB} MiB Heap."
fi
set -- $JAVA_HEAP_ARGUMENTE
```

| Funktion               | Tut                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `speichergrenze_bytes` | Liest die cgroup-Grenze (v2 `memory.max`, v1 `memory.limit_in_bytes`); Rückgabe 1 ohne Grenze                                                                       |
| `java_heap_bestimmen`  | Setzt `JAVA_HEAP_ARGUMENTE` (`-Xms`/`-Xmx` oder den Rückfall `-XX:MaxRAMPercentage=70`) und die Zahlen `JAVA_KONTINGENT_MIB`, `JAVA_HEAP_MIB`, `JAVA_RUECKLAGE_MIB` |

Das RAM-Kontingent des Servers erreicht den Container **nur als cgroup-Grenze**
(`HostConfig.Memory`), es gibt keine Umgebungsvariable damit. Die Rechnung:

> Heap = Kontingent − Rücklage, Rücklage = ein Viertel des Kontingents, mindestens 512 und
> höchstens 2048 MiB. Unter 512 MiB Heap wird nicht gegangen.

| Kontingent | Heap      | Rücklage |
| ---------- | --------- | -------- |
| 1024 MiB   | 512 MiB   | 512 MiB  |
| 2048 MiB   | 1536 MiB  | 512 MiB  |
| 4096 MiB   | 3072 MiB  | 1024 MiB |
| 8192 MiB   | 6144 MiB  | 2048 MiB |
| 16384 MiB  | 14336 MiB | 2048 MiB |

Ein fester Prozentsatz wäre schlechter: Metaspace, Code-Cache, GC-Strukturen, Thread-Stacks
und die Direktpuffer von Netty brauchen ein paar hundert MiB, ob der Heap nun 1 oder 12 GiB
groß ist. Reißt dieser Rest, greift nicht der GC, sondern der Kernel.

`PALANTIR_MEMORY_LIMIT_FILE` ersetzt die cgroup-Dateien durch eine beliebige Datei — für die
Tests, damit das Ergebnis nicht an der Maschine hängt (Fundpunkt 178). `PALANTIR_LIB_DIR`
zeigt auf einen anderen Ort der Bibliothek — für die Tests der Spiel-Images, die sie aus dem
Repository einbinden, wo es `/opt/palantir` nicht gibt.

**Nicht in der Bibliothek:** das temporäre Verzeichnis. `/tmp` ist im Container ein
`noexec`-tmpfs; ein Server, der dort native Bibliotheken entpackt (Netty), braucht
`-Djava.io.tmpdir` in den Datenordner. Welche Schalter das sind, hängt vom Spiel ab — das
Minecraft-Image zeigt es.

## Tests

`java.test.mjs` bindet die Bibliothek mit `sh` ein und prüft die Rechnung samt Grenzfällen —
**kein Docker, keine JVM nötig**. Unter `set -eu`, wie jedes Startskript sie einbindet.

```bash
pnpm --filter @palantir/base-java-image test
```

Ohne POSIX-Shell im PATH überspringt sich die Datei mit einem Hinweis.

## Fassung erhöhen

Das Tag `palantir-base-java:<n>` wird nie überschrieben; deshalb reicht einem Spiel-Image das
Tag, wo es bei fremden Images den Digest bräuchte. Wer die JRE, die Wurzel oder `java.sh`
ändert:

1. Zahl in `VERSION` erhöhen — der Bau legt `:<n+1>` an, `:<n>` bleibt, wie es ist.
2. Die Spiel-Images ziehen **nicht** von selbst nach. Wer den neuen Stand in einem Spiel will,
   setzt dort `BASIS` auf die neue Fassung, erhöht dessen `VERSION` und zieht `dockerImage`
   in `game-registry.ts` nach.

Eine Java-Hauptfassung je Basis-Image: Ein Spiel, das eine ältere braucht (alte
Minecraft-Fassungen, Forge-Modpacks), bekommt `base/java21` daneben — keinen Schalter hier.

## Die JRE nachziehen

Dependabot kann das nicht mehr: Seit Fassung 3 steht hier kein fremdes Image, sondern ein
Tarball mit Prüfsumme. Die aktuellen Werte liefert die Adoptium-Schnittstelle:

```bash
curl -s "https://api.adoptium.net/v3/assets/latest/25/hotspot?architecture=x64&image_type=jre&os=linux&vendor=eclipse"
```

Aus der Antwort gehören `binary.package.link` nach `JRE_URL` und `binary.package.checksum` nach
`JRE_SHA256` im Dockerfile, dazu die Fassung nach `JRE_VERSION`. Danach `VERSION` erhöhen.
