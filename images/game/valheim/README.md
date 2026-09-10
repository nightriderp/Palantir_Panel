# Valheim (`palantir-game-valheim`)

Das erste Spiel aus Steam. Der Unterschied zu Minecraft ist nicht das Spiel, sondern woher die
Serverdateien kommen: Paper liegt als Jar im Image, Valheim holt SteamCMD beim Start in den
Datenordner.

| Sache         | Wert                                                   |
| ------------- | ------------------------------------------------------ |
| Basis         | `palantir-base-steam` (darunter `palantir-base-linux`) |
| Anwendung     | 896660 (dedizierter Server), anonyme Anmeldung         |
| Ports         | 2456/udp Spiel, 2457/udp Abfrage                       |
| Konsole       | keine — Valheim liest weder Standardeingabe noch RCON  |
| Serverdateien | `/data/server`, von SteamCMD verwaltet                 |
| Spielstände   | `/data/welten`, gehören dem Betreiber                  |

## Warum die Ordner getrennt sind

SteamCMD räumt in seinem Ordner auf. Lägen die Welten darin, wären sie eines Tages weg. Deshalb
`-savedir /data/welten` neben `/data/server`: Eine Neuinstallation der Serverdateien lässt die
Spielstände unberührt, und wer sie sichern will, sichert einen Ordner.

## Die Regeln von Valheim

Valheim beendet sich beim Start kommentarlos, wenn eine davon verletzt ist. Das Startskript prüft
sie vorher und meldet den Grund mit Exit-Code 78 (`EX_CONFIG`):

- Ein Passwort ist Pflicht.
- Mindestens fünf Zeichen.
- Es darf weder im Servernamen noch im Weltnamen vorkommen — es stünde sonst in der Serverliste.

Dazu eine Eigenheit, die keine Fehlermeldung erzeugt, sondern schlicht nicht startet: Der Server
braucht `SteamAppId=892970` in der Umgebung. Das ist die Nummer des **Spiels**, nicht die des
Servers.

## Ports und Abfrage

Valheim spricht UDP. Das Spiel läuft auf 2456, die Serverliste antwortet daneben auf 2457. Palantir
fragt deshalb 2457 ab (`query.containerPort` in der Spieltyp-Definition) und gibt `gamedig`
ausdrücklich vor, genau diesen Port zu nehmen — sonst rechnete die Bibliothek ihren eigenen Versatz
darauf, und hinter frp trägt jeder Container-Port eine eigene öffentliche Nummer.

Hostname-Routing gibt es hier nicht: Der Router liest den Namen aus dem Minecraft-Handshake, ein
UDP-Spiel liefert nichts dergleichen. Valheim behält seinen Port in der Adresse.

**Ohne `-public 1` antwortet der Abfrage-Port überhaupt nicht.** Ein Server im privaten Modus
meldet sich nicht beim Steam-Verzeichnis an und beantwortet keine A2S-Abfrage — erreichbar ist er
trotzdem, wer Adresse und Passwort hat, spielt. Das Panel weiß dann aber nichts über ihn: keine
Spielerzahl, kein Ping, und der automatische Stopp bei 0 Spielern greift nicht. Der Start gilt in
diesem Fall als geglückt, sobald der Container läuft (`query.requiresConfigFlag` in der
Spieltyp-Definition). Deshalb steht der Schalter „In der Serverliste zeigen" auf **an**.

Eine zweite Eigenheit derselben Art: Ein Server mit `-crossplay` in den Startparametern meldet die
Spielerzahl immer als 0 (gamedig, Fehlerbericht 539). Der Server läuft, der Ping stimmt — nur der
automatische Stopp hält ihn für leer.

## Der erste Start dauert

SteamCMD lädt gut ein Gigabyte. Die Startfrist der Spieltyp-Definition ist deshalb auf zwanzig
Minuten gesetzt; spätere Starts prüfen nur, ob etwas Neues da ist.

## Tests

`start.test.mjs` ruft `start.sh` mit `sh` auf, ohne Docker, ohne Steam und ohne Valheim. Gestellt
werden ein Datenordner, eine SteamCMD-Attrappe und ein `valheim_server.x86_64`, das seine Argumente
ausgibt. Geprüft werden die Passwortregeln, die Trennung der Ordner und die Argumentliste.

Ob der echte Server damit startet, zeigt erst ein Lauf auf der Node.
