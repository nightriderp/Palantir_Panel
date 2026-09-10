# Basis-Image: Linux (`palantir-base-linux`)

Die gemeinsame Wurzel aller Spiel-Images. Kein Spiel und keine Laufzeit — nur das, was jeder
Spielserver unter der Härtung des Agents braucht. Das Schema aller Images steht in
`images/README.md`.

| Enthalten                       | Fassung                                                          |
| ------------------------------- | ---------------------------------------------------------------- |
| Grundlage                       | `ubuntu:24.04`, per Digest gepinnt                               |
| Benutzer                        | UID 1000 — die UID des Datenordners auf der Node (Fundpunkt 117) |
| Arbeitsverzeichnis              | `/data`, dort hängt der Agent den Datenordner ein                |
| Stoppsignal                     | `SIGTERM`                                                        |
| `/opt/palantir/lib/palantir.sh` | Orte, Konsolen-Rohr, Datei mit geprüfter Prüfsumme holen         |
| `palantir-console`              | Konsolen-Anschluss für Server, die von der Standardeingabe lesen |
| Werkzeuge                       | `curl`, Wurzelzertifikate, `tzdata`                              |

## Wer darauf aufsetzt

```
palantir-base-linux
├── palantir-base-java     Java-Spiele (Minecraft und alles mit Mods)
├── palantir-base-steam    alles über SteamCMD — geplant, die größte Gruppe
├── palantir-base-dotnet   .NET-Server — geplant
└── Spiel-Images direkt    Factorio, Minecraft Bedrock, Terraria …
```

## Was ein aufsetzendes Image tut

```dockerfile
ARG BASIS=ghcr.io/nightriderp/palantir-base-linux:1
FROM ${BASIS}

USER root
COPY start.sh /opt/palantir/
RUN chmod 0755 /opt/palantir/start.sh
USER 1000:1000

ENTRYPOINT ["/opt/palantir/start.sh"]
```

Benutzer, Arbeitsverzeichnis, Stoppsignal und `palantir-console` kommen aus der Basis. Ein
`chown` oder ein Benutzerwechsel zur Laufzeit gehört nicht dazu — beides scheitert an
`CapDrop: ALL` und `no-new-privileges` mit „operation not permitted" (Fundpunkt 113).

## Die Bibliothek

Ein Startskript bindet sie ein, es führt sie nicht aus:

```sh
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
```

Danach stehen `$PALANTIR_DATENORDNER`, `$PALANTIR_INTERN` und `$PALANTIR_KONSOLE` bereit, dazu
vier Funktionen.

**`palantir_log`** schreibt eine Zeile mit dem gemeinsamen Präfix `[palantir]`.

**`palantir_intern_anlegen`** legt `/data/.palantir` an. Dort liegt alles, was Palantir selbst
ablegt — der Datei-Manager zeigt dem Betreiber sonst Betriebsinterna zwischen seinen Welten.

**`palantir_konsole_oeffnen`** legt das benannte Rohr an und öffnet es auf Deskriptor 3. Der
Aufrufer hängt den Server danach daran:

```sh
palantir_konsole_oeffnen
exec spielserver "$@" 0<&3 3>&-
```

Deskriptor 3 bleibt absichtlich zum Schreiben offen. Ein nur zum Lesen geöffnetes Rohr liefert
EOF, sobald der letzte Schreiber geht, und der Server hielte das für „Konsole beendet".

**`palantir_datei_holen <quelle> <sha256> <ziel>`** holt eine Datei und prüft ihre Prüfsumme. Ist
sie schon da und unverändert, passiert nichts.

## Serverdateien liegen im Datenordner

Entscheidung des Betreibers vom 10. September 2026. Die Dateien vieler Spielserver sind
zweistellig groß und ändern sich mit jeder Spielfassung. Im Image lägen sie in der Registry,
jede Aktualisierung wäre ein neues Image, und ein Spiel mit dreißig Gigabyte wäre nicht mehr
sinnvoll zu verteilen. Im Datenordner liegen sie einmal je Server, überleben den Neuaufbau des
Containers und lassen sich zur Laufzeit erneuern.

Der Preis, offen benannt: Der erste Start braucht Netz, und die Serverfassung hängt an der Quelle
statt am Image-Tag. Deshalb die Prüfsumme neben der Adresse. Was nicht dazu passt, wird verworfen
statt ausgeführt.

Das Paper-Image ist die Ausnahme, die bleibt: Seine Jar liegt im Image, weil sie klein ist und
weil ein Image-Tag dort für genau eine Serverfassung stehen soll.

## Tests

`linux.test.mjs` ruft `palantir.sh` und `console.sh` mit `sh` auf, ohne Docker. Geprüft werden
die Orte im Datenordner, das Rohr samt Exit-Codes und das Holen einer Datei — mit einem `curl`
im PATH, das nur eine vorbereitete Datei kopiert. Ob das Ganze im Container zusammenspielt,
zeigt erst ein echter Lauf auf der Node.
