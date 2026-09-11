# Palworld (`palantir-game-palworld`)

Vierter Server aus Steam.

| Sache         | Wert                                                    |
| ------------- | ------------------------------------------------------- |
| Basis         | `palantir-base-steam:2`                                 |
| Anwendung     | 2394010 (dedizierter Server), anonyme Anmeldung         |
| Port          | 8211/udp                                                |
| Konsole       | RCON, Source-Protokoll, Port 25575 (nie veröffentlicht) |
| Abfrage       | **keine** — siehe unten                                 |
| Serverdateien | `/data/server`, von SteamCMD verwaltet                  |

## Das Panel kann diesen Server nicht abfragen

Palworld beantwortet nur seine eigene REST-Schnittstelle, und die verlangt Benutzer und
Administrator-Passwort; `gamedig` nennt sie selbst „experimental". Ein reiner Verbindungsversuch
bewiese nichts, weil der Spiel-Port UDP ist.

Die Spieltyp-Definition sagt das deshalb ausdrücklich (`query.kind: 'none'`): Der Start gilt als
geglückt, sobald der Container läuft. Es gibt keine Spielerzahl, keinen Ping, und der automatische
Stopp bei 0 Spielern bleibt wirkungslos. Die falsche Aussage wäre die schlechtere.

## Das Administrator-Passwort ist das RCON-Passwort

Palworld kennt dafür kein zweites Feld: Wer RCON spricht, ist Administrator. Das Startskript
erzeugt es bei jedem Start neu (24 Zufallsbytes als Hex), schreibt es in die Einstellungen **und**
nach `/data/.palantir/rcon.password` (0600), von wo der Agent es liest. Im Panel gibt es deshalb
kein Feld dafür — und niemand kann versehentlich `admin` eintragen.

## Die Einstellungen stehen in einer einzigen Zeile

`PalWorldSettings.ini` trägt sie als `OptionSettings=(Schluessel=Wert,...)` — kein
`schluessel=wert` je Zeile, also auch nichts zum Verschmelzen. Die Datei wird bei jedem Start neu
geschrieben; was nicht darin steht, füllt Palworld mit seinen Vorgaben.

Ein Anführungszeichen, ein Komma oder eine Klammer im Servernamen zerrisse diese Zeile, und
Palworld startete wortlos mit Vorgaben — ohne Passwort, ohne RCON, mit falschem Namen. Solche
Zeichen fallen deshalb weg; das steht auch als Hinweis am Feld im Panel.

| Variable                 | Vorgabe               | Schlüssel             |
| ------------------------ | --------------------- | --------------------- |
| `PALWORLD_NAME`          | `Ein Palantir-Server` | `ServerName`          |
| `MOTD`                   | –                     | `ServerDescription`   |
| `PALWORLD_PASSWORD`      | –                     | `ServerPassword`      |
| `MAX_PLAYERS`            | `32`                  | `ServerPlayerMaxNum`  |
| `PALWORLD_PVP`           | `false`               | `bIsPvP`              |
| `PALWORLD_DEATH_PENALTY` | `All`                 | `DeathPenalty`        |
| `SERVER_PORT`            | `8211`                | `PublicPort`, `-port` |

## `steamclient.so` gehört nach `~/.steam/sdk64`

Anders als bei Rust sucht Palworld sie dort. Fehlt sie, scheitert die Anmeldung an Steam und
niemand kommt herein. `HOME` zeigt deshalb in den internen Unterordner des Datenordners, und das
Startskript legt die Datei dorthin.

## Tests

`start.test.mjs` prüft vor allem die eine lange Zeile: dass die Felder darin ankommen, dass
Anführungszeichen und Kommas herausfallen, dass das Administrator-Passwort dem frischen
RCON-Passwort entspricht — und dass `steamclient.so` an der Stelle landet, an der Palworld sie
sucht.

Ob der echte Server damit startet, zeigt erst ein Lauf auf der Node.
