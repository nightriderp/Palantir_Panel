# Basis-Image: Linux (`palantir-base-linux`)

Die gemeinsame Wurzel aller Spiel-Images. Kein Spiel und keine Laufzeit — nur das, was jeder
Spielserver unter der Härtung des Agents braucht. Das Schema aller Images steht in
`images/README.md`.

| Enthalten                       | Fassung                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------- |
| Grundlage                       | `ubuntu:24.04`, per Digest gepinnt                                           |
| Benutzer                        | UID 1000 — die UID des Datenordners auf der Node (Fundpunkt 117)             |
| Arbeitsverzeichnis              | `/data`, dort hängt der Agent den Datenordner ein                            |
| Stoppsignal                     | `SIGTERM`                                                                    |
| `/opt/palantir/lib/palantir.sh` | Orte, Konsolen-Rohr, Dateien holen und auspacken, Einstellungen verschmelzen |
| `palantir-console`              | Konsolen-Anschluss für Server, die von der Standardeingabe lesen             |
| Werkzeuge                       | `curl`, `unzip`, Wurzelzertifikate, `tzdata`                                 |

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
sieben Funktionen.

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

**`palantir_zip_auspacken <archiv> <zielordner>`** packt ein Zip aus (seit Fassung 2). Ein Zip
lässt sich mit Bordmitteln einer POSIX-Shell nicht öffnen — `tar` kann es nicht —, deshalb liegt
`unzip` seit dieser Fassung im Image. Das Ausführungsbit überlebt den Weg durch ein Zip nicht
zuverlässig; wer eine Binärdatei auspackt, setzt es danach selbst.

**`palantir_eigenschaft <datei> <schlüssel> <wert>`** und
**`palantir_schlüssel_verschmelzen <verwaltete> <zieldatei>`** pflegen eine Konfiguration aus
`schlüssel=wert`-Zeilen (seit Fassung 2) — Terrarias `serverconfig.txt`, Minecrafts
`server.properties`, die INI-Dateien vieler Steam-Spiele.

Das Panel verwaltet genau die Schlüssel, für die es ein Feld gibt. Alles andere gehört dem
Betreiber: Er darf die Datei über die Dateiverwaltung bearbeiten, und ein Start, der solche
Änderungen jedes Mal wegwirft, wäre eine böse Überraschung. Ein verwalteter Schlüssel behält
deshalb seine Zeile und bekommt den neuen Wert, ein fehlender wird angehängt, alles Übrige bleibt
stehen. Ein doppelt vorhandener Schlüssel wird auf eine Zeile zusammengezogen — die meisten Leser
nehmen den letzten Treffer, eine alte Dublette weiter unten überschriebe sonst die frische
Einstellung.

Die Funktion stand bis Fassung 1 im Startskript von Minecraft. Sie ist dort in gleicher Form
geblieben, weil jenes Image auf `base/java:3` und damit auf `base/linux:1` sitzt; bei seiner
nächsten Fassung gehört die Kopie heraus.

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
die Orte im Datenordner, das Rohr samt Exit-Codes, das Holen einer Datei — mit einem `curl`
im PATH, das nur eine vorbereitete Datei kopiert —, das Auspacken eines selbst gebauten Archivs
und das Verschmelzen einer Konfiguration. Ob das Ganze im Container zusammenspielt,
zeigt erst ein echter Lauf auf der Node.
