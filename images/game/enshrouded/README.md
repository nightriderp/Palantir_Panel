# Enshrouded (`palantir-game-enshrouded`)

Das erste Spiel unter Proton. Es gibt davon **nur einen Windows-Server** — wie bei der halben Liste
aus Anhang A.

| Sache         | Wert                                              |
| ------------- | ------------------------------------------------- |
| Basis         | `palantir-base-proton:1`                          |
| Anwendung     | 2278520 (dedizierter Server, **Windows**), anonym |
| Ports         | 15636/udp Spiel, 15637/udp Abfrage                |
| Konsole       | keine                                             |
| Serverdateien | `/data/server`, von SteamCMD verwaltet            |
| Welten        | `/data/welten`, gehören dem Betreiber             |

## Der erste Start dauert doppelt

Zweimal etwas, das genau einmal passiert: SteamCMD holt die Windows-Dateien, und Proton legt danach
einen **Wine-Prefix** an — ein ganzes Windows-Dateisystem in Miniatur, unter
`/data/.palantir/proton`. Die Startfrist steht deshalb auf dreißig Minuten.

## Windows-Pfade in der Konfiguration

Proton sieht den Datenordner als Laufwerk `Z:`. `saveDirectory` und `logDirectory` in
`enshrouded_server.json` bekommen deshalb übersetzte Pfade:

```
/data/welten   →   Z:\data\welten
```

Ein Linux-Pfad liefe ins Leere, und der Server legte seine Welt irgendwohin — sichtbar erst, wenn
sie beim nächsten Neuaufbau des Containers fehlt.

## Drei Rollen, drei Passwörter

Enshrouded kennt keine Rechteverwaltung mit Konten, sondern drei Gruppen mit je einem Passwort. Das
Panel bietet alle drei an:

| Rolle      | Darf                                             |
| ---------- | ------------------------------------------------ |
| Verwalter  | alles, auch hinauswerfen und sperren             |
| Mitspieler | bauen und an Truhen, aber niemanden hinauswerfen |
| Gast       | mitspielen, aber nichts am Bau ändern            |

Die Datei wird bei jedem Start neu geschrieben; Werte gehen maskiert hinein, sonst zerbräche ein
Anführungszeichen im Servernamen die Datei und der Server startete mit Vorgaben — **ohne Passwort**.

## Keine Konsole

Enshrouded nimmt weder über die Standardeingabe noch über RCON Befehle entgegen. Das Panel zeigt
deshalb nur die Ausgabe, mit ausgegrautem Eingabefeld.

## Tests

`start.test.mjs` prüft ohne Docker, ohne Steam, ohne Proton und ohne das Spiel: die Felder in der
JSON-Datei, die Übersetzung der Ordner in Windows-Pfade, die Maskierung, die drei Rollen mit ihren
Rechten — und dass die Windows-Datei über `proton run` aufgerufen wird.

Ob der echte Server damit startet, zeigt erst ein Lauf auf der Node. Bei diesem Image ist der
Abstand dorthin größer als bei jedem anderen: Unter Proton kann auch eine fehlende Bibliothek
scheitern lassen, die im Basis-Image noch niemand vermisst hat.
