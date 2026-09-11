# Abiotic Factor (`palantir-game-abioticfactor`)

Das vierte Spiel unter Proton. Kurzes Image, zwei Eigenheiten.

| Sache         | Wert                                              |
| ------------- | ------------------------------------------------- |
| Basis         | `palantir-base-proton:2`                          |
| Anwendung     | 2857200 (dedizierter Server, **Windows**), anonym |
| Ports         | 7777/udp Spiel, 27015/udp Abfrage                 |
| Konsole       | keine                                             |
| Serverdateien | `/data/server`, von SteamCMD verwaltet            |
| Welten        | `/data/welten`, per Verweis aus dem Serverordner  |

## Keine Konfigurationsdatei

Alles, was das Panel setzt, steht auf der Befehlszeile. Die `Game.ini` im Serverordner ist für die
Feineinstellungen da, die der Betreiber im Spiel macht — ein Startskript, das sie bei jedem Start
schriebe, räumte die weg.

Ein Passwort, das leer ist, wird **weggelassen** statt als `-ServerPassword=` mitgegeben: Bei
manchen Fassungen heißt das sonst „das Passwort ist der leere Text", und dann kommt niemand mehr
herein.

## Die Spielstände müssen aus dem Serverordner heraus

Die Unreal Engine legt sie unter `AbioticFactor/Saved` ab — mitten in dem, was SteamCMD verwaltet.
Wer den Serverordner löscht, um die Dateien neu zu holen (der übliche Rat bei kaputten
Serverdateien), löschte damit die Welt.

Das Startskript holt den Ordner beim ersten Start nach `/data/welten` und lässt einen Verweis
zurück. SteamCMD rührt ihn bei einer Aktualisierung nicht an.

## Der Bildschirm, den es nicht gibt

Die Unreal Engine verlangt unter Wine eine X11-Verbindung. Das Startskript ruft deshalb
`proton_bildschirm_starten` (Xvfb, seit `base/proton:2`).

## Tests

`start.test.mjs` prüft ohne Docker, ohne Steam, ohne Proton und ohne Xvfb: die Befehlszeile, das
weggelassene leere Passwort, den Aufruf über `proton run` — und den Umzug der Spielstände samt
Verweis. Die letzten beiden Fälle brauchen symbolische Verweise und laufen deshalb nicht auf einem
Windows-Arbeitsplatz, wohl aber in der CI.

Ob der echte Server damit startet, zeigt erst ein Lauf auf der Node.
