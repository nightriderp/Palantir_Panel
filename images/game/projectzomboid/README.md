# Project Zomboid (`palantir-game-projectzomboid`)

Zweites Spiel aus Steam. Das Muster ist dasselbe wie bei Valheim — SteamCMD holt die Serverdateien
beim Start in den Datenordner. Was hier dazukommt, sind drei Eigenheiten, die ohne Vorwarnung Zeit
kosten.

| Sache         | Wert                                                       |
| ------------- | ---------------------------------------------------------- |
| Basis         | `palantir-base-steam:2` (darunter `palantir-base-linux:2`) |
| Anwendung     | 380870 (dedizierter Server), anonyme Anmeldung             |
| Ports         | 16261/udp Spiel, 16262/udp Verbindungen                    |
| Konsole       | Standardeingabe (`players`, `save`, `quit`)                |
| Serverdateien | `/data/server`, von SteamCMD verwaltet                     |
| Welt          | `/data/welt` (`-cachedir`), gehört dem Betreiber           |

## Drei Eigenheiten

**Ohne Administrator-Passwort fragt der Server danach — und wartet.** Beim ersten Start ohne
`-adminpassword` verlangt Project Zomboid die Eingabe auf der Standardeingabe. Im Container gibt
es niemanden, der antwortet; das sieht aus wie ein Hänger ohne Grund. Das Feld ist deshalb Pflicht,
und das Startskript bricht vorher mit Exit-Code 78 ab.

**Der Servername wird zum Dateinamen.** Die Einstellungen liegen als `<Name>.ini`, der Weltordner
heißt genauso. Ein Leerzeichen oder ein Schrägstrich darin führt zu Pfaden, die niemand
wiederfindet — erlaubt sind deshalb nur Buchstaben, Ziffern, `-` und `_`. Im Panel ist das Feld
nach dem Anlegen gesperrt: Eine Änderung ließe die alte Welt zurück.

**Der Server speichert bei SIGTERM nicht zuverlässig.** Gespeichert wird beim Konsolenbefehl
`quit`. Dies ist deshalb — wie Terraria — ein Image ohne `exec` am Ende: Eine Shell bleibt als
PID 1 stehen, fängt das Signal ab, schickt `quit` in das Konsolen-Rohr und wartet auf das Ende des
Servers. Die Kulanzzeit gibt `stopTimeoutSeconds` (120 s).

## Serverdateien und Welt sind getrennt

SteamCMD räumt in seinem Ordner auf. `-cachedir=/data/welt` legt alles, was dem Betreiber gehört,
daneben: Welt, Spielerdaten, Einstellungen, Logs. Eine Neuinstallation der Serverdateien lässt das
unberührt.

## Einstellungen

Das Startskript schreibt genau die Schlüssel nach `<Name>.ini`, für die es im Panel ein Feld gibt,
und lässt jeden anderen unberührt — Sandbox-Regeln, Mods und was der Betreiber sonst gesetzt hat,
gehören ihm.

| Variable                 | Vorgabe               | Schlüssel in der `.ini` |
| ------------------------ | --------------------- | ----------------------- |
| `ZOMBOID_NAME`           | `palantir`            | Dateiname, Weltordner   |
| `ZOMBOID_PUBLIC_NAME`    | `Ein Palantir-Server` | `PublicName`            |
| `MOTD`                   | –                     | `PublicDescription`     |
| `ZOMBOID_ADMIN_PASSWORD` | – (Pflicht)           | `-adminpassword`        |
| `ZOMBOID_PASSWORD`       | –                     | `Password`              |
| `MAX_PLAYERS`            | `16`                  | `MaxPlayers`            |
| `ZOMBOID_PVP`            | `true`                | `PVP`                   |
| `ZOMBOID_PUBLIC`         | `true`                | `Public`                |
| `SERVER_PORT`            | `16261`               | `DefaultPort`           |

Fest gesetzt wird `PauseEmpty=true`: Ein leerer Server soll die Uhr anhalten, sonst altert die Welt,
während niemand spielt, und die Node rechnet für nichts.

## Ohne den öffentlichen Modus keine Abfrage

Dieselbe Eigenheit wie bei Valheim: Ein Server, der sich nicht beim Steam-Verzeichnis anmeldet,
beantwortet keine A2S-Abfrage. Erreichbar bleibt er — wer Adresse und Passwort hat, spielt. Das
Panel weiß dann aber nichts über ihn: keine Spielerzahl, kein Ping, kein automatischer Stopp, und
der Start gilt als geglückt, sobald der Container läuft
(`query.requiresConfigFlag: 'public'`). Deshalb steht der Schalter auf **an**.

## Tests

`start.test.mjs` ruft `start.sh` mit `sh` auf, ohne Docker, ohne Steam und ohne Project Zomboid.
Gestellt werden eine SteamCMD-Attrappe, die ein `start-server.sh` hinterlässt, und dieses Skript
selbst, das seine Argumente aufschreibt. Geprüft werden die Pflicht zum Administrator-Passwort, die
Grenzen des Servernamens, die verwalteten Schlüssel der `.ini` und der Stopp: dass beim Signal
wirklich `quit` in der Konsole ankommt.

Der letzte Fall wird auf Windows übersprungen — dort gibt es keine POSIX-Signale. In der CI
(ubuntu-latest) läuft er.

Ob der echte Server damit startet, zeigt erst ein Lauf auf der Node.
