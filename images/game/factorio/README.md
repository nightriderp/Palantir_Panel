# Factorio (`palantir-game-factorio`)

Ein Server ohne Steam. Wube gibt den Headless-Server als eigenes Archiv heraus — kein Konto, keine
Anwendungsnummer. Das Image sitzt deshalb unmittelbar auf `palantir-base-linux`, wie Terraria.

| Sache         | Wert                                                               |
| ------------- | ------------------------------------------------------------------ |
| Basis         | `palantir-base-linux:3` (erst diese Fassung bringt `xz-utils` mit) |
| Serverfassung | 2.0.77, beim ersten Start geholt, Prüfsumme im Image               |
| Port          | 34197/udp                                                          |
| Konsole       | **RCON** (Source-Protokoll), Port 27015 — nie veröffentlicht       |
| Serverdateien | `/data/.palantir/server/factorio`                                  |
| Karten        | `/data/karten`, gehören dem Betreiber                              |

## Woher die Serverdateien kommen

Wube erlaubt das Herunterladen, nicht das Weiterverteilen — der Server kann also nicht im Image
liegen. Das Startskript holt das Archiv beim ersten Start, prüft die SHA-256 aus dem Dockerfile,
packt es aus und **löscht das Archiv wieder**.

Die Adresse trägt die Fassung (`get-download/2.0.77/headless/linux64`) und nicht `stable`: Sonst
zeigte sie mit jeder Ausgabe auf etwas anderes, und die Prüfsumme im Image wäre am Tag der
nächsten Ausgabe falsch.

Vor dem Auspacken wird `server/factorio` gelöscht. Das Archiv trägt diesen Ordner als oberste
Ebene, und `tar` überschreibt nur, was es kennt — ohne das Löschen mischten sich zwei Fassungen.

## Die Konsole geht über RCON

Factorio spricht das Source-RCON-Protokoll, dasselbe wie Minecraft. Das Panel schließt seine
Konsole deshalb direkt an und bekommt die Antwort eines Befehls zurück, statt sie im Log zu
suchen. Das Passwort entsteht bei jedem Start neu (24 Zufallsbytes als Hex), liegt unter
`/data/.palantir/rcon.password` (0600) und verlässt die Node nie; der Port wird nie
veröffentlicht.

Befehle beginnen mit einem Schrägstrich: `/players`, `/save`, `/admins`, `/version`.

Daneben bleibt der Weg über die Standardeingabe (`palantir-console`) für einen Zugriff von Hand.

## Karte

`world` und `autocreate` gibt es hier nicht — Factorio erzeugt eine Karte mit einem eigenen Lauf
(`--create`) und startet danach auf derselben Datei. Das Startskript tut genau das, wenn die Datei
fehlt; ohne diesen Schritt bräche der Server mit „map file not found" ab.

Der Startwert (Seed) gilt deshalb **nur beim Erzeugen**. Wer eine neue Karte will, ändert den
Namen; die alte bleibt in `/data/karten` liegen.

## Einstellungen

`server-settings.json` wird bei jedem Start neu geschrieben — anders als bei `server.properties`
gibt es hier nichts zu verschmelzen. Wer eigene Schlüssel setzen will, hängt über
`PALANTIR_STARTUP_PARAMETERS` eine eigene Datei an.

| Variable                      | Vorgabe               | Schlüssel                      |
| ----------------------------- | --------------------- | ------------------------------ |
| `FACTORIO_NAME`               | `Ein Palantir-Server` | `name`                         |
| `MOTD`                        | –                     | `description`                  |
| `MAX_PLAYERS`                 | `0` (keine Grenze)    | `max_players`                  |
| `FACTORIO_PASSWORD`           | –                     | `game_password`                |
| `FACTORIO_MAP`                | `palantir`            | Dateiname der Karte            |
| `FACTORIO_SEED`               | –                     | `--map-gen-seed` beim Erzeugen |
| `FACTORIO_AUTOSAVE_MINUTES`   | `10`                  | `autosave_interval`            |
| `SERVER_PORT`                 | `34197`               | `--port`                       |
| `PALANTIR_STARTUP_PARAMETERS` | –                     | zusätzliche Schalter           |

Werte gehen maskiert in die Datei: Ein Anführungszeichen im Servernamen zerrisse sie sonst, und
Factorio beendete sich mit einer Meldung über Zeile und Spalte, mit der niemand etwas anfangen
kann.

## Kein Feld für die öffentliche Serverliste

Dafür verlangt Factorio ein Konto bei Wube (Benutzername und Token). Zugangsdaten Dritter gehören
nicht ins Panel (Entscheidung des Betreibers, 11. September 2026) — das Startskript liest
`FACTORIO_USERNAME`, `FACTORIO_TOKEN` und `FACTORIO_PUBLIC`, aber die Spieltyp-Definition bietet
keine Felder dafür an. `require_user_verification` steht aus demselben Grund fest auf `false`:
Ohne Konto könnte der Server niemanden prüfen, verlangte er es trotzdem, käme niemand herein.

## Fassung erhöhen

Welche die aktuelle stabile ist, sagt `https://factorio.com/api/latest-releases`.

```bash
curl -sL https://factorio.com/get-download/2.0.77/headless/linux64 | sha256sum
```

Dann `FACTORIO_VERSION`, `FACTORIO_URL` und `FACTORIO_SHA256` im Dockerfile tauschen, `VERSION`
erhöhen und `dockerImage` in `game-registry.ts` nachziehen. Bestehende Server holen die neue
Fassung beim nächsten Start selbst.

## Tests

`start.test.mjs` ruft `start.sh` mit `sh` auf, ohne Docker und ohne Factorio. Gestellt wird ein
`factorio`, das seine Argumente aufschreibt und beim `--create` eine Datei anlegt. Geprüft werden
die Karte beim ersten Start (und dass der zweite sie nicht überschreibt), die
`server-settings.json` samt Maskierung, das frische RCON-Passwort und die Argumentliste.

Ob der echte Server damit startet, zeigt erst ein Lauf auf der Node.
