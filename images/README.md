# Images

Alles, was der Agent auf einer Node als Container startet, entsteht hier — nach einem Schema:

```
images/<Kategorie>/<Name>   →   ghcr.io/nightriderp/palantir-<Kategorie>-<Name>:<Fassung>
```

| Kategorie | Was darin steht                                                                                                     | Beispiel                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `base`    | Grundlage je Laufzeit: Benutzer, Bibliotheken, Konventionen der Härtung. Kein Spiel, kein `ENTRYPOINT`.             | `base/linux` → `palantir-base-linux`         |
| `game`    | Ein Spielserver, aufgesetzt auf ein Basis-Image. Bekommt mindestens eine Spieltyp-Definition in `game-registry.ts`. | `game/minecraft` → `palantir-game-minecraft` |
| `test`    | Prüfstände: kein Spiel, sondern ein Nachbau, an dem sich die Kette des Panels ohne echtes Spiel prüfen lässt.       | `test/minecraft` → `palantir-test-minecraft` |

Der Ordnername ist der Image-Name; eine gepflegte Liste gibt es nicht. Ein neues Image braucht
seinen Ordner mit `Dockerfile` und `VERSION`, sonst nichts.

## Basis-Images

Ein Basis-Image je Laufzeit. Es bringt mit, was **jeder** Server dieser Laufzeit unter der
Härtung des Agents braucht (Pflichtenheft §2.3), und nichts, was nur ein Spiel braucht.

| Image         | Laufzeit                                                                                          | Stand     |
| ------------- | ------------------------------------------------------------------------------------------------- | --------- |
| `base/linux`  | Die gemeinsame Wurzel: Benutzer, Datenordner, Konsole, `curl`, `unzip`, `xz`. Trägt alles Übrige. | vorhanden |
| `base/java`   | Eclipse Temurin JRE (Java 25) — Minecraft (Paper, Fabric, Forge), andere JVM-Server               | vorhanden |
| `base/steam`  | SteamCMD samt 32-Bit-Bibliotheken — mit Abstand die größte Gruppe                                 | vorhanden |
| `base/dotnet` | .NET-Laufzeit für Server, die keine eigene mitbringen                                             | geplant   |
| `base/proton` | Windows-Server unter Proton (samt Xvfb) — Enshrouded, V Rising, Sons of the Forest                | vorhanden |

**Die Wurzel ist `base/linux`.** Seit dem 10. September 2026 setzen die Laufzeit-Basen darauf
auf, statt jede für sich ein fremdes Image zu nehmen: Benutzer, Datenordner, Stoppsignal und
`palantir-console` stünden sonst in jeder noch einmal und drifteten auseinander. `base/java`
trug sie bis Fassung 2 selbst.

Was jedes Basis-Image festlegt:

- **UID 1000**, fest im Dockerfile. Das ist die UID, der der Datenordner auf der Node gehört
  (Fundpunkt 117: der Agent legt ihn als 1000 an und kann ihn niemandem verschenken).
- **`WORKDIR /data`** — dort hängt der Agent den Datenordner ein. Alles Veränderliche liegt
  darin; das Wurzeldateisystem ist schreibgeschützt.
- **`STOPSIGNAL SIGTERM`** — das Startskript eines Spiels ersetzt sich per `exec` durch den
  Serverprozess, das Signal kommt also direkt an.
- **Kein `ENTRYPOINT`** — den setzt das Spiel.
- Eine **Hauptfassung der Laufzeit je Basis-Image**. Braucht ein Spiel eine andere, bekommt es
  ein Basis-Image daneben (`base/java21`), keinen Schalter.

Was kein Image tut, weil es an `CapDrop: ALL` und `no-new-privileges` scheitert (Fundpunkt
113, PR #166): als `root` starten, `chown` im Startskript, Benutzerwechsel zur Laufzeit
(`su`, `gosu`), setuid-Binaries im Startpfad.

## Ein Spiel-Image anlegen

Ordner `images/game/<name>` mit:

| Datei                        | Zweck                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`                 | `ARG BASIS=ghcr.io/nightriderp/palantir-base-<laufzeit>:<n>` und `FROM ${BASIS}`; `root` nur im Bau, `USER 1000:1000` am Ende   |
| `VERSION`                    | Fortlaufende ganze Zahl, beginnt bei `1`                                                                                        |
| `start.sh` (o. ä.)           | Startskript: Einstellungen aus der Umgebung, dann `exec` in den Serverprozess                                                   |
| `console.sh` (o. ä.)         | Als `/usr/local/bin/palantir-console` verlinkt; muss **ohne Shell** aufrufbar sein (`EXEC_CONSOLE` übergibt eine Argumentliste) |
| `*.test.mjs`, `package.json` | Tests ohne Docker (`node --test`); die `package.json` bindet sie in `pnpm test` ein und wird nicht ins Image kopiert            |
| `.dockerignore`              | Hält Tests, README und VERSION aus dem Build-Kontext                                                                            |
| `README.md`                  | Was das Image enthält, welche Variablen es liest, wie man es von Hand prüft                                                     |

Dazu die Spieltyp-Definition in `apps/backend/src/modules/server-orchestration/game-registry.ts`
mit `dockerImage: 'ghcr.io/nightriderp/palantir-game-<name>:<n>'` — und ein Test daneben, der
diese Zeichenkette festhält.

Das Minecraft-Image (`game/minecraft`) ist die Vorlage: EULA als Pflichtfeld, verwaltete
Schlüssel in `server.properties`, Heap aus dem Basis-Image, Konsole über ein benanntes Rohr.

**Ein Image kann mehrere Spieltypen bedienen.** `game/minecraft` tut es: Paper und Vanilla
teilen sich alles außer der Jar, ein Schalter in der Umgebung (`MINECRAFT_EDITION`) wählt aus,
und im Panel stehen zwei Definitionen darauf. Das lohnt genau dann, wenn sich zwei Spieltypen
sonst ein abgeschriebenes Startskript teilten — nicht als Regel.

## Bau und Veröffentlichung

`.github/workflows/game-images.yml` baut bei jedem Push auf `main`, der etwas unter `images/`
ändert — **nur die geänderten Images**, `base/*` zuerst, alles andere danach. Von Hand
gestartet baut er alle. Die Schritte für ein einzelnes Image stehen in
`spiel-image-bauen.yml`.

Jedes Image bekommt zwei Tags: `:<VERSION>` und `:<Commit-SHA>`.

**Ein Versions-Tag wird nie überschrieben.** Die Spieltyp-Definition zeigt auf genau diese
Fassung, und die Anzeige „Update verfügbar" hängt daran. Wer ein Image ändert, erhöht die Zahl
in `VERSION`; der Lauf bricht ab, wenn es das Tag schon gibt. Nur für einen erneuten Anlauf
nach einem abgebrochenen Bau: Lauf von Hand mit `ueberschreiben`.

**Eigene Images per Tag, fremde per Digest.** `base/java` pinnt `eclipse-temurin` per Digest,
weil dessen Tag wandert. Ein Spiel-Image zeigt dagegen mit `FROM` auf
`palantir-base-java:<n>` — ein Tag, das nie überschrieben wird, also so fest steht wie ein
Digest. Die Kette ist damit durchgehend festgeschrieben; Dependabot hält nur die Digests der
Basis-Images nach (`.github/dependabot.yml`).

## Basis erneuern

1. In `images/base/<laufzeit>`: Änderung machen, Zahl in `VERSION` erhöhen. Der nächste Push
   auf `main` legt `:<n+1>` an; `:<n>` bleibt.
2. Spiel-Images ziehen **nicht** von selbst nach — das ist Absicht: Ein Java-Update ist beim
   Spiel eine Entscheidung, kein Nebeneffekt. Wer es will: `BASIS` im Dockerfile des Spiels
   auf `:<n+1>`, dessen `VERSION` erhöhen, `dockerImage` in `game-registry.ts` nachziehen.
