# Spiel-Image: Counter-Strike 2 (`palantir-game-cs2`)

Counter-Strike-2-Server von Valve. Spieltyp-Kennung `cs2`.

## Von vorne, in kleinen Schritten

Der erste Anlauf (Images 1 bis 4) hat alles auf einmal gebaut: Einstellungen, MetaMod,
CounterStrikeSharp, sieben Plugins, MariaDB. Er kam auf der Node nie hoch – CS2 selbst brach an
einer fehlenden Bibliothek ab, und die grünen Tests konnten das nicht zeigen. Seit dem 23.09.2026
wird das Image von vorne aufgebaut, **ein kleiner Schritt nach dem anderen**, jeder erst, wenn der
vorige auf der Node läuft.

| Schritt | Inhalt                                                                                       | Stand            |
| ------- | -------------------------------------------------------------------------------------------- | ---------------- |
| 1       | Linux + SteamCMD + CS2, keine Felder, keine Extras                                           | läuft (0.0.1)    |
| 1.1     | Port drinnen = Port draußen (`CS2_PORT`)                                                     | läuft (0.0.2)    |
| 2       | Servername, Server-Passwort, Spieleranzahl                                                   | läuft (0.0.3)    |
| 3       | Startkarte, Spielmodus, Bots                                                                 | läuft (0.0.4)    |
| 3.1     | Sauber stoppen: Skript als Hauptprozess, `quit`                                              | läuft (0.0.5)    |
| 3.2     | Live-Steuerung: Karte, Modus, Bots (Panel)                                                   | läuft (0.0.6)    |
| 4       | Workshop-Karte (ID, Start und Steuerung)                                                     | läuft (0.0.7)    |
| 4.1     | Workshop-Sammlung                                                                            | zurückgestellt   |
| 5       | Alle Runden spielen (Start und Steuerung)                                                    | läuft (0.0.8)    |
| 5.0.1   | Workshop-Karte beim Start nachladen (Fundpunkt 349)                                          | läuft (0.0.9)    |
| 5.0.2   | Kein Ruhezustand – Konsole antwortet auch leer                                               | läuft (0.0.10)   |
| 5.0.3   | Zeilenweise Ausgabe – Antworten sofort im Panel                                              | läuft (0.0.11)   |
| 5.1     | GOTV (eigener UDP-Port, Passwort wie der Server)                                             | läuft (0.0.12)   |
| 5.2     | GSLT (optional)                                                                              | offen            |
| 6       | Updates zurückhalten (Administration > Templates)                                            | läuft (0.0.16)   |
| 7       | MetaMod + CounterStrikeSharp (Schalter)                                                      | läuft (0.0.15)   |
| 8       | Admins (SteamID64, `@css/root`)                                                              | läuft (0.0.17)   |
| 9       | SimpleAdmin (+ AnyBaseLib, PlayerSettings, MenuManager)                                      | läuft (0.0.18)   |
| 10      | MatchZy (samt `cfg/MatchZy`)                                                                 | läuft (0.0.19)   |
| 11      | Retakes (samt Kartenkonfigurationen)                                                         | läuft (0.0.20)   |
| 11.1    | Gamedata für CS2 1.41.8, eigener Temp-Ordner (SimpleAdmin-SQLite)                            | läuft (0.0.21)   |
| 11.2    | Spielmodus-Plugin als Auswahl (MatchZy/Retakes), Plugins in der Steuerung                    | läuft (0.0.22)   |
| 11.3    | Bots aus dem Panel auch mit MatchZy/Retakes                                                  | läuft (0.0.23)   |
| 11.4    | Plugins ohne Neustart (alle bereitgelegt, `exec`-Dateien je Plugin)                          | läuft (0.0.24)   |
| 11.5    | Bot-Block für alle Spielmodus-Plugins, retakes.cfg vorab, Teams automatisch                  | läuft (0.0.25)   |
| 11.6    | Training-Schalter (Munition, Granaten, Endlos-Runde, Granaten-Kamera, Überall kaufen)        | läuft (0.0.26)   |
| 11.7    | Spielmodus Custom (`game_type 3`, `game_mode 0`)                                             | läuft (0.0.27)   |
| 11.8    | Endlos-Runde mit Respawn und Beitritt jederzeit                                              | läuft (0.0.28)   |
| 11.9    | Teamzuweisung mit CS2-Werten (`mp_force_pick_time`, `mp_join_grace_time`)                    | läuft (0.0.29)   |
| 11.10   | Übung: Aufwärmphase überspringen, keine Standzeit, sofort spawnen; Teamzuweisung wieder raus | läuft (0.0.30)   |
| 11.11   | SimpleAdmin-Stealth-Modul eigener Schalter, Vorgabe aus („You are hidden“)                   | **dieses Image** |
| 12      | Fake RCON – übersprungen (SimpleAdmin hat `css_rcon`; 1.3.2 braucht KHook)                   | –                |
| 13–15   | je ein Plugin, WeaponPaints mit MariaDB zuletzt                                              | offen            |

## Was Schritt 1 tut

| Enthalten   | Version                                          |
| ----------- | ------------------------------------------------ |
| Grundlage   | `palantir-base-steam:6`                          |
| Serverdaten | Anwendung 730, beim ersten Start geholt (~30 GB) |
| `start.sh`  | Einstiegspunkt                                   |

1. SteamCMD holt bzw. aktualisiert die Serverdateien, anonym.
2. `steamclient.so` nach `~/.steam/sdk64` – ohne sie scheitert die Anmeldung an Steam.
3. Start über Valves Starter `game/cs2.sh`, aus `game/` heraus:
   `-dedicated -port <CS2_PORT> +map de_dust2`.

**Warum über `cs2.sh`:** Seit dem Update vom 17.09.2025 braucht CS2 Bibliotheken aus seinen
eigenen Ordnern (`libv8.so`). Den Suchpfad setzt der Starter; direkt gestartet bricht der Server
mit „Unable to load module server" ab.

## Ports

| Port  | Protokoll | Zweck                                     |
| ----- | --------- | ----------------------------------------- |
| 27015 | UDP + TCP | Spiel und Abfrage — eine Nummer für beide |

**Drinnen dieselbe Nummer wie draußen** (Schritt 1.1): Das Panel gibt die öffentliche Nummer als
`CS2_PORT` herein (`usesPublicPortNumber`), und CS2 lauscht darauf. Mit 27015 drinnen und z. B.
25003 draußen kam die Abfrage durch, aber jeder Verbindungsaufbau scheiterte still – CS2 nennt
Clients seinen eigenen Port.

## Versionen

Ab dem Neuanfang dreistellig, beginnend bei `0.0.1` (Wunsch des Betreibers). Die alten Tags `1`
bis `4` bleiben in der Registry liegen; ein Tag wird nie überschrieben.

## Tests

`start.test.mjs` prüft das Skript mit einer SteamCMD-Attrappe: Aufruf von SteamCMD, Start über
`cs2.sh` mit den festen Argumenten, Arbeitsordner, `steamclient.so`, Abbruch ohne Starter. **Ob CS2
wirklich hochkommt, zeigt nur ein Start auf der Node.**
