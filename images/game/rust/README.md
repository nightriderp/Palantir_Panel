# Rust (`palantir-game-rust`)

Dritter Server aus Steam. Das Muster ist dasselbe wie bei Valheim und Project Zomboid — SteamCMD
holt die Serverdateien beim Start in den Datenordner.

| Sache         | Wert                                                    |
| ------------- | ------------------------------------------------------- |
| Basis         | `palantir-base-steam:2`                                 |
| Anwendung     | 258550 (dedizierter Server), anonyme Anmeldung          |
| Port          | 28015/udp — Spiel **und** Abfrage                       |
| Konsole       | RCON, Source-Protokoll, Port 28016 (nie veröffentlicht) |
| Serverdateien | `/data/server`, von SteamCMD verwaltet                  |
| Welt          | `/data/server/server/palantir` (Rusts eigene Ablage)    |

## Drei Dinge, die ohne diesen Text niemand errät

**RCON spricht ab Werk WebSocket.** Rust kann beides; der Agent spricht nur das Source-Protokoll,
dasselbe wie bei Minecraft. Das Startskript setzt deshalb `+rcon.web 0`. Ohne diese Zeile bliebe
die Konsole im Panel stumm, ohne dass irgendwo ein Fehler stünde.

**`steamclient.so` gehört neben die Bibliotheken des Servers.** SteamCMD legt sie in seinen eigenen
Ordner; RustDedicated sucht sie unter `RustDedicated_Data/Plugins/x86_64`. Fehlt sie, bricht der
Start mit einem Ladefehler ab, der nichts über die Ursache sagt — die häufigste Stolperstelle bei
Steam-Servern überhaupt. Das Startskript kopiert sie.

**Der Abfrage-Port ist derselbe wie der Spiel-Port** (`+server.queryport`). Sonst bräuchte der
Server eine zweite öffentliche Nummer, und hinter frp bekäme er eine ganz andere als die, die er
selbst meldet.

## Einstellungen

Alle stehen in der Argumentliste; eine Konfigurationsdatei gibt es nicht zu pflegen. Was darüber
hinaus gebraucht wird, hängt `PALANTIR_STARTUP_PARAMETERS` an — Rust nimmt jede weitere
`+schluessel wert`-Angabe entgegen.

| Variable             | Vorgabe               | Schalter                    |
| -------------------- | --------------------- | --------------------------- |
| `RUST_NAME`          | `Ein Palantir-Server` | `+server.hostname`          |
| `MOTD`               | –                     | `+server.description`       |
| `MAX_PLAYERS`        | `50`                  | `+server.maxplayers`        |
| `RUST_WORLD_SIZE`    | `3000`                | `+server.worldsize`         |
| `RUST_SEED`          | –                     | `+server.seed`              |
| `RUST_LEVEL`         | `Procedural Map`      | `+server.level`             |
| `RUST_SAVE_INTERVAL` | `300`                 | `+server.saveinterval`      |
| `SERVER_PORT`        | `28015`               | `+server.port`, `queryport` |

Ohne `RUST_SEED` wird der Schalter **weggelassen**: `+server.seed 0` hieße „jedes Mal eine andere
Welt", und die Karte entstünde bei jedem Neustart neu. Weltgröße und Startwert sind im Panel nach
dem Anlegen gesperrt — beides geht in die Erzeugung der Karte ein.

## Der erste Start dauert

Über zehn Gigabyte Serverdateien, danach die Erzeugung der Karte. Die Startfrist steht deshalb auf
dreißig Minuten. Die Vorgaben für Arbeitsspeicher (8 GiB) und Kerne (4) sind die untere Grenze für
eine Karte von 3000.

## Tests

`start.test.mjs` ruft `start.sh` mit `sh` auf, ohne Docker, ohne Steam und ohne Rust. Gestellt
werden eine SteamCMD-Attrappe, die ein `RustDedicated` hinterlässt, und dieses selbst, das seine
Argumente aufschreibt. Geprüft werden das Source-RCON statt WebSocket, das frische Passwort je
Start, `steamclient.so` an der richtigen Stelle und die Argumentliste — samt des weggelassenen
Startwerts.

Ob der echte Server damit startet, zeigt erst ein Lauf auf der Node.
