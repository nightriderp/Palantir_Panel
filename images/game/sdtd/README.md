# 7 Days to Die (`palantir-game-sdtd`)

| Sache         | Wert                                                |
| ------------- | --------------------------------------------------- |
| Basis         | `palantir-base-steam:2`                             |
| Anwendung     | 294420 (dedizierter Server), anonyme Anmeldung      |
| Ports         | 26900 **TCP und UDP**, dazu 26901/udp und 26902/udp |
| Abfrage       | 26901 — nicht der Spiel-Port                        |
| Konsole       | keine (das Spiel kennt nur Telnet)                  |
| Serverdateien | `/data/server`, von SteamCMD verwaltet              |
| Welt          | `/data/welt`, gehört dem Betreiber                  |

## Zwei Eigenheiten bei den Ports

**Der Spiel-Port trägt beide Protokolle unter derselben Nummer.** Mit zwei getrennten Einträgen
bekäme er aus dem Pool zwei verschiedene, und das Beitreten bräche. Die Definition sagt deshalb
`protocol: 'both'` — genau dafür wurde das Port-Modell erweitert.

**Die Abfrage läuft auf 26901, nicht auf 26900.** `gamedig` rechnet für dieses Spiel einen Versatz
von +1 auf den Spiel-Port; hinter frp trägt aber jeder Container-Port eine eigene öffentliche
Nummer, der Versatz zeigte also ins Leere (Fundpunkt 246). `query.containerPort` nennt den
Abfrage-Port deshalb ausdrücklich.

## Die Konfiguration ist XML

Anders als bei Minecraft (`server.properties`) oder Project Zomboid (`.ini`) lässt sich hier nichts
verschmelzen: Das Startskript schreibt `serverconfig.xml` bei jedem Start **vollständig neu**. Wer
eigene Eigenschaften braucht, hängt über `PALANTIR_STARTUP_PARAMETERS` eine eigene Datei an
(`-configfile=…`) — die letzte gewinnt.

Werte gehen maskiert hinein (`&`, `<`, `>`, `"`): Ein Anführungszeichen im Servernamen zerrisse die
Datei sonst, und der Server startete mit einer Meldung über Zeile und Spalte, mit der niemand etwas
anfangen kann.

| Variable          | Vorgabe               | Eigenschaft                   |
| ----------------- | --------------------- | ----------------------------- |
| `SDTD_NAME`       | `Ein Palantir-Server` | `ServerName`                  |
| `MOTD`            | –                     | `ServerDescription`           |
| `SDTD_PASSWORD`   | –                     | `ServerPassword`              |
| `MAX_PLAYERS`     | `8`                   | `ServerMaxPlayerCount`        |
| `SDTD_PUBLIC`     | `true`                | `ServerVisibility` (2 oder 0) |
| `SDTD_WORLD`      | `Navezgane`           | `GameWorld`                   |
| `SDTD_SEED`       | `palantir`            | `WorldGenSeed`                |
| `SDTD_WORLD_SIZE` | `6144`                | `WorldGenSize`                |
| `SDTD_GAME_NAME`  | `Palantir`            | `GameName`                    |
| `SDTD_DIFFICULTY` | `2`                   | `GameDifficulty`              |
| `SDTD_DAY_LENGTH` | `60`                  | `DayNightLength`              |
| `SERVER_PORT`     | `26900`               | `ServerPort`                  |

Fest gesetzt werden drei Dinge: `UserDataFolder` und `SaveGameFolder` zeigen nach `/data/welt` —
SteamCMD räumt in seinem Ordner auf, was dem Betreiber gehört, hat dort nichts zu suchen. Und
`TelnetEnabled` sowie `WebDashboardEnabled` bleiben **aus**: Das wären zwei weitere Wege in den
Server hinein, die niemand abgesichert hat und die das Panel ohnehin nicht spricht.

## Keine Konsole

Die Verwaltung dieses Servers läuft über Telnet, und das ist nicht das Source-RCON, das der Agent
spricht. Das Panel zeigt deshalb nur die Ausgabe, mit ausgegrautem Eingabefeld.

## Welt und Spielstand

`GameWorld`, `WorldGenSeed`, `WorldGenSize` und `GameName` gehen in die Erzeugung ein und sind im
Panel nach dem Anlegen gesperrt: Eine Änderung ließe die alte Welt zurück. Wer eine neue will,
legt einen neuen Server an — oder räumt `/data/welt` weg.

## Tests

`start.test.mjs` prüft ohne Docker, ohne Steam und ohne das Spiel: die Felder in der XML-Datei, die
Maskierung von `"` `&` `<` `>`, die Trennung von Serverdateien und Welt, dass Telnet und
Web-Dashboard aus bleiben, die Übersetzung der Sichtbarkeit in die Zahl, die das Spiel kennt — und
die Argumentliste.

Ob der echte Server damit startet, zeigt erst ein Lauf auf der Node.
