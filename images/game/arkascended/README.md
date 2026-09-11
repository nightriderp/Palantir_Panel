# ARK: Survival Ascended (`palantir-game-arkascended`)

Das größte Spiel dieser Liste — und das einzige mit einer eigenen Proton-Fassung.

| Sache         | Wert                                              |
| ------------- | ------------------------------------------------- |
| Basis         | **`palantir-base-proton10:1`**                    |
| Anwendung     | 2430930 (dedizierter Server, **Windows**), anonym |
| Ports         | 7777/udp Spiel, 27015/udp Abfrage                 |
| Konsole       | RCON (TCP 27020, nicht veröffentlicht)            |
| Serverdateien | `/data/server`, zweistellig viele Gigabyte        |
| Welten        | `/data/welten`, per Verweis aus dem Serverordner  |

## Warum Proton 10

GE-Proton 11 bleibt beim Start dieses Servers hängen — ohne Meldung, ohne Ende, ohne Absturz. Der
Linux-ASA-Server-Manager pinnt deshalb ausdrücklich auf die 10er-Reihe. Dafür gibt es
[`base/proton10`](../../base/proton10/README.md); die vier anderen Proton-Spiele bleiben auf
`base/proton` (GE-Proton11-6).

Im Log steht, welche Reihe läuft: `Proton GE-Proton10-34 aus /opt/proton`.

## Die Optionskette

ARK nimmt seine Einstellungen nicht aus einer Datei, sondern hinter dem Kartennamen, mit `?`
getrennt:

```
TheIsland_WP?listen?SessionName=…?ServerPassword=…?ServerAdminPassword=…?RCONEnabled=True
```

Ein **Fragezeichen im Servernamen** zerschnitte die Kette, und der Server startete mit halben
Einstellungen — ohne Passwort zum Beispiel. Das Startskript entfernt es deshalb, zusammen mit
Anführungszeichen und Zeilenumbrüchen.

## Verwalter und Konsole sind dasselbe Passwort

ARK kennt kein eigenes RCON-Passwort: Wer RCON spricht, ist Verwalter. Das Feld „Passwort für
Verwalter" gilt deshalb für beides — im Spiel für `enablecheats`, im Panel für die Konsole.

Bleibt es leer, erzeugt das Startskript ein zufälliges. Dann hat das Panel seine Konsole, und im
Spiel wird niemand Verwalter. Das ist die sichere Vorgabe, nicht die bequeme.

## Keine Spielerzahl

Die Kachel bleibt ohne Spielerzahl, und das ist kein Fehler. ARK beantwortet **keine A2S-Abfrage**
mehr; es meldet sich beim Verzeichnis von Epic an, und genau dort fragt `gamedig` nach — nach der
öffentlichen Adresse. Hinter dem Rückwärtstunnel steht bei Epic die Adresse der VPS, gefragt wird
nach der des Containers: Der Eintrag wird nie gefunden. Dieselbe Klasse wie bei Vintage Story.

Deshalb `query: { kind: 'none' }` — der Start gilt als geglückt, sobald der Container läuft.

## ARK speichert beim Stoppen nicht

Der Befehl dafür (`DoExit`) ginge über RCON, und einen RCON-Sprecher hat dieses Image nicht. Was
seit dem letzten selbsttätigen Speichern geschehen ist, ist nach einem Stopp fort — deshalb steht
`AutoSavePeriodMinutes` auf 10 statt auf ARKs eigener Vorgabe.

**Wer sauber stoppen will, schickt vorher `SaveWorld` über die Konsole des Panels.** Der
Schnellbefehl dafür ist da.

## Die Spielstände müssen aus dem Serverordner heraus

Wie bei Abiotic Factor: Die Unreal Engine legt sie unter `ShooterGame/Saved` ab — mitten in dem, was
SteamCMD verwaltet. Das Startskript holt den Ordner beim ersten Start nach `/data/welten` und lässt
einen Verweis zurück.

## Der erste Start dauert wirklich

Zweistellig viele Gigabyte über SteamCMD, danach der Wine-Prefix. Die Startfrist steht auf **eine
Stunde**; auf einer gewöhnlichen Hausleitung ist der Download der Löwenanteil. Das Kontingent ist
entsprechend: 16 GiB Arbeitsspeicher, 80 GiB Platte.

## Schalter, die aus sind

**BattlEye** ist Vorgabe aus: Unter Proton ist der Dienst eine zusätzliche Fehlerquelle, und ein
Server, der daran nicht startet, sieht aus wie einer, der gar nicht startet. **Crossplay** (Spieler
aus dem Microsoft Store) ebenfalls — wer es will, schaltet es ein.

## Tests

`start.test.mjs` prüft ohne Docker, ohne Steam, ohne Proton und ohne Xvfb: die Optionskette, das
entfernte Fragezeichen, beide Passwort-Wege, die drei Schalter, die Mod-Kennungen — und den Umzug
der Spielstände. Die letzten beiden Fälle brauchen symbolische Verweise und laufen deshalb nur in
der CI.

Ob der echte Server damit startet, zeigt erst ein Lauf auf der Node. Bei diesem Spiel ist der
Abstand dorthin größer als bei jedem anderen.
