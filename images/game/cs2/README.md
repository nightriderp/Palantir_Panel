# Spiel-Image: Counter-Strike 2 (`palantir-game-cs2`)

Counter-Strike-2-Server von Valve. Spieltyp-Kennung `cs2`.

| Enthalten          | Version                                          |
| ------------------ | ------------------------------------------------ |
| Grundlage          | `palantir-base-steam:6`                          |
| Serverdaten        | Anwendung 730, beim ersten Start geholt (~30 GB) |
| MetaMod:Source     | 2.0.0-git1469, beim ersten Start geholt          |
| CounterStrikeSharp | v1.0.374 mit .NET-Laufzeit, beim ersten Start    |
| `start.sh`         | Einstiegspunkt                                   |

## Was die Grundlage war

Funktionsumfang nach den Hilfeseiten von DatHost (`help.dathost.net/category/129-cs2`), die
technischen Angaben selbst geprüft: App-ID, anonymer Abruf, Binärpfad, Ports und das
Protokoll-Kürzel in `gamedig`.

## Drei Dinge, ohne die CS2 hier nicht liefe

**1. `steamclient.so` unter `~/.steam/sdk64`.** Ohne sie bricht der Server beim Anmelden an Steam
ab. Das Startskript legt sie aus dem SteamCMD-Ordner dorthin — und setzt `HOME` dafür
ausdrücklich auf den internen Ordner, weil `steam_vorbereiten` es vorher in den SteamCMD-Ordner
gelegt hat. Palworld braucht dasselbe und macht es genauso.

**2. Kein RCON.** Valve hat es in CS2 nie freigeschaltet. Die Konsole des Panels geht über die
Standardeingabe, wie bei Terraria. Das „Fake RCON"-Plugin ist für Spieler im Spiel, nicht für das
Panel.

**3. Schalter kommen als `true`/`false`.** Das Panel schreibt jeden Wert mit `String()` in die
Umgebung; CS2 will `0` und `1`. Beim Rundenschalter zusätzlich umgekehrt: „Alle Runden spielen"
an heißt `mp_match_can_clinch 0`. `mp_match_can_clinch true` wäre still wirkungslos gewesen.

## Wo die Einstellungen landen

| Datei                            | Wer schreibt sie                             | Wann                     |
| -------------------------------- | -------------------------------------------- | ------------------------ |
| `game/csgo/cfg/palantir.cfg`     | das Startskript                              | bei jedem Start neu      |
| `game/csgo/cfg/server.cfg`       | der Betreiber                                | nie vom Skript angefasst |
| `game/csgo/gamemodes_server.txt` | einmal aus der Vorlage, danach der Betreiber | nur, wenn sie fehlt      |

**`palantir.cfg` und `server.cfg` getrennt**, weil `palantir_schluessel_verschmelzen` nur
`schlüssel=wert` kennt und eine `server.cfg` mit Leerzeichen und Anführungszeichen trennt. Eine
zweite Auslegung derselben Aufgabe wäre eine Fehlerquelle mehr.

**Wer gewinnt, wenn beide dasselbe setzen: die `server.cfg`.** Sie läuft bei jedem Kartenwechsel,
unsere Datei einmal beim Start. Wer dort eine Zeile von Hand hinschreibt, will sie offenbar.

`gamemodes_server.txt` ist ein verschachteltes Valve-Format; dort stehen Spielerzahl je Modus und
die eigene Kartenliste (`mg_custom`). Verschmelzen wäre Raterei — die Datei gehört dem Betreiber.

## Felder im Panel

| Feld                                      | Wirkt als                                                     |
| ----------------------------------------- | ------------------------------------------------------------- |
| Servername                                | `hostname` in `palantir.cfg`                                  |
| Spieler höchstens                         | `+maxplayers`                                                 |
| Spielmodus                                | `+game_type` / `+game_mode` (siehe unten)                     |
| Kartenquelle, Startkarte, Workshop-Nummer | `+map`, `+host_workshop_map` oder `+host_workshop_collection` |
| Server-Passwort                           | `sv_password` in `palantir.cfg`                               |
| GSLT                                      | `+sv_setsteamaccount`                                         |
| Alle Runden spielen                       | `mp_match_can_clinch 0`                                       |
| GOTV einschalten                          | `tv_enable 1`; `tv_autorecord` bleibt immer `0`               |
| Plugins laden                             | MetaMod-Zeile in `gameinfo.gi` (siehe unten)                  |
| Admins (SteamID64)                        | `addons/counterstrikesharp/configs/admins.json`               |

**Spielmodi** — Valve kennt sie nur als zwei Zahlen:

| Modus       | `game_type` | `game_mode` |
| ----------- | ----------- | ----------- |
| casual      | 0           | 0           |
| competitive | 0           | 1           |
| wingman     | 0           | 2           |
| armsrace    | 1           | 0           |
| deathmatch  | 1           | 2           |
| custom      | 3           | 0           |

**Eigene Karten nur aus dem Workshop.** Valve hat FastDL abgeschafft. Bei einer Sammlung lässt sich
die Startkarte nicht setzen — das kann Valve nicht.

**Der GSLT ist keine Pflicht.** Ohne ihn läuft der Server, taucht aber nicht im Serverbrowser auf.
Zu holen unter `steamcommunity.com/dev/managegameservers`, Anwendung 730.

## Plugin-Grundlage

MetaMod:Source lädt Plugins in den Server, CounterStrikeSharp lädt C#-Plugins — fast alles, was
es für CS2 gibt, baut darauf. Adressen und Prüfsummen stehen im `Dockerfile`; das Startskript
holt die Archive beim ersten Start in den internen Ordner und verwirft, was nicht zur Summe passt.

**Ausgepackt wird nur bei einer neuen Fassung** (Merkdatei `addons/.palantir-stand`). Die
`metaplugins.ini` des Betreibers bleibt dabei stehen, `core.json` entsteht einmal aus der
Vorlage und gehört danach dem Betreiber.

**Die Zeile in `gameinfo.gi` wird bei jedem Start geprüft.** Ein Update von Valve schreibt die
Datei neu und nimmt sie mit; ohne sie lädt MetaMod nie. Eingetragen wird direkt hinter
`Game_LowViolence`, nie doppelt.

**„Plugins laden" aus** nimmt nur die Zeile heraus. Das ist der Notausgang, wenn ein CS2-Update
MetaMod bricht: Der Server läuft ohne Plugins weiter, die Dateien bleiben liegen.

## Admins

SteamID64-Nummern, getrennt durch Komma, Leerzeichen oder Semikolon. Jede bekommt `@css/root`.
Was keine SteamID64 ist (17 Ziffern, beginnend mit `7656119`), steht im Log und nicht in der
Datei. **Ist das Feld leer, fasst das Skript `admins.json` nicht an** — für Betreiber, die Gruppen
und feinere Rechte von Hand pflegen.

## Updates zurückhalten

CounterStrikeSharp bricht nach Updates von Valve regelmässig, bis die Grundlage nachzieht. Auf der
Templates-Seite kann die Administration deshalb das Update beim Start abschalten
(`PALANTIR_UPDATES_HALTEN=true`). SteamCMD bleibt dann aus, sofern die Serverdateien schon da
sind — der allererste Start holt trotzdem. Der Preis: Spieler mit einem neueren Client kommen
womöglich nicht mehr auf den Server.

## Ports

| Port  | Protokoll | Zweck                                     |
| ----- | --------- | ----------------------------------------- |
| 27015 | UDP + TCP | Spiel und Abfrage — eine Nummer für beide |
| 27020 | UDP       | GOTV                                      |

## Tests

`start.test.mjs` ruft `start.sh` mit `sh` auf, ohne Docker, ohne SteamCMD und ohne CS2. Statt der
30 GB legt eine `steamcmd.sh`-Attrappe eine Binärdatei ab, die ihre Argumente aufschreibt.
Geprüft: alle sechs Modi, alle drei Kartenquellen, `palantir.cfg`, die Übersetzung der Schalter,
`steamclient.so`, `gamemodes_server.txt`, GSLT und Startparameter, dazu Plugin-Grundlage, Admins
und die Update-Sperre. Die Archive baut der Test selbst und legt sie mit passender Summe ab.

Plugin- und Admin-Prüfungen brauchen `tar` mit Laufwerksbuchstaben und werden unter Windows
übersprungen; in der CI laufen sie.

## Was noch aussteht

**Dieses Image ist nie gelaufen.** Die Rauchprobe prüft beim Bau die Laufzeit, nicht das Spiel. Ob
CS2 unter dem schreibgeschützten Wurzeldateisystem hochkommt und ob die 30 GB in der Startfrist von
einer Stunde durchgehen, zeigt erst ein Start auf der Node.

**Die einzelnen Plugins fehlen noch** — MatchZy, SimpleAdmin, WeaponPaints und die übrigen kommen
in einem eigenen Schritt. Die Grundlage dafür steht.
