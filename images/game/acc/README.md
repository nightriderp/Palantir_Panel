# Assetto Corsa Competizione (`palantir-game-acc`)

Der erste Spieltyp, dessen **Serverdateien der Betreiber selbst mitbringt**.

| Sache         | Wert                                                    |
| ------------- | ------------------------------------------------------- |
| Basis         | `palantir-base-proton:2`                                |
| Serverdateien | `/data/server` — **vom Betreiber hochgeladen**          |
| Ports         | 9231/udp Spiel, 9232/tcp Verbindungsaufbau              |
| Konsole       | keine                                                   |
| Abfrage       | keine                                                   |
| Konfiguration | `cfg/configuration.json`, `settings.json`, `event.json` |

## Warum das Image die Dateien nicht holt

Kunos gibt den dedizierten Server nur an ein Steam-Konto heraus, das ACC besitzt: Er ist ein
**Werkzeug am Elternspiel** (Anwendung 1430110, Eltern 805550), und anonym liefert SteamCMD ihn
nicht aus. Fremde Zugangsdaten gehören nicht in dieses Panel — das ist eine Entscheidung des
Betreibers vom 2026-09-11, und sie gilt weiter.

Sie sind hier auch nicht nötig: Der ganze Server wiegt keine hundert Megabyte und liegt in jeder
ACC-Installation bereit:

```
steamapps/common/Assetto Corsa Competizione Dedicated Server
```

Diesen Ordner über den **Datei-Manager des Panels** nach `server` im Datenordner legen — als ZIP
hochladen und entpacken geht auch. Fehlt er, sagt das Image im Log genau das und beendet sich mit
Rückgabewert 78; es startet nicht in ein leeres Verzeichnis hinein.

## Die Ports tragen drinnen dieselbe Nummer wie draußen

ACC meldet dem Lobby-Dienst die Portnummern aus seiner eigenen `configuration.json`, und wer den
Eintrag dort abholt, verbindet sich dorthin. Stünde drinnen 9231 und draußen 25010, zeigte die
Auskunft auf einen Port, den es nicht gibt — der Server liefe, wäre gesund, und niemand käme herein.

Die Spieltyp-Definition sagt deshalb `usesPublicPortNumber: true`; das Panel vergibt die öffentliche
Nummer, reicht sie als `ACC_UDP_PORT`/`ACC_TCP_PORT` herein, und das Startskript trägt genau sie in
die Konfiguration ein.

## UTF-16 — die Stolperstelle dieses Spiels

ACC liest seine Konfiguration als **UTF-16 LE mit Byte-Reihenfolge-Marke**. Eine Datei in UTF-8 wird
nicht etwa abgelehnt: Sie wird still falsch gelesen. Der Server startet mit Vorgaben — ohne
Passwort, auf anderen Ports — und im Log steht nichts davon.

Das Startskript schreibt deshalb über `iconv` und setzt die Marke selbst.

## Was dem Betreiber gehört

Geschrieben werden bei jedem Start **nur drei Dateien**: `configuration.json`, `settings.json`,
`event.json`. Unangetastet bleiben:

| Datei              | Inhalt                                        |
| ------------------ | --------------------------------------------- |
| `entrylist.json`   | die Fahrer einer Liga samt Startnummern       |
| `eventRules.json`  | Boxenstopp-Regeln, Pflichtstopps, Zeitfenster |
| `assistRules.json` | welche Fahrhilfen erlaubt sind                |

Wer ein Rennwochenende mit mehreren Trainings oder eine eigene Wetterkurve will, legt seine eigene
`event.json` daneben — dann allerdings überschreibt der nächste Start sie wieder. Für solche Fälle
ist der Weg: Felder im Panel leer lassen, was geht, und den Rest über `entrylist.json` und
`eventRules.json` regeln.

## Tests

`start.test.mjs` prüft ohne Docker, ohne Proton und ohne das Spiel: die Meldung bei fehlenden
Serverdateien samt Rückgabewert 78, die Byte-Reihenfolge-Marke und die UTF-16-Kodierung aller drei
Dateien, die öffentlichen Portnummern, den Platz für Zuschauer über den Fahrzeugplätzen, die
Maskierung, das Rennwochenende aus drei Sitzungen — und dass `entrylist.json` und `eventRules.json`
unberührt bleiben.

Ob der echte Server damit startet, zeigt erst ein Lauf auf der Node.
