# V Rising (`palantir-game-vrising`)

Das zweite Spiel unter Proton — und das erste Windows-Spiel mit einer **echten Konsole**: V Rising
spricht das Source-RCON-Protokoll.

| Sache         | Wert                                                    |
| ------------- | ------------------------------------------------------- |
| Basis         | `palantir-base-proton:2`                                |
| Anwendung     | 1829350 (dedizierter Server, **Windows**), anonym       |
| Ports         | 9876/udp Spiel, 9877/udp Abfrage, 25575/tcp RCON intern |
| Konsole       | RCON                                                    |
| Serverdateien | `/data/server`, von SteamCMD verwaltet                  |
| Welten        | `/data/welten` (`Settings/` und `Saves/`)               |

## Nur was abweicht

Stunlock liest zuerst die Vorgaben aus `VRisingServer_Data/StreamingAssets/Settings/` und legt dann
die Datei aus dem `-persistentDataPath` darüber. In `Settings/ServerHostSettings.json` muss deshalb
nur stehen, was anders sein soll — das Image schreibt genau die Felder, die das Panel kennt, und
lässt den Rest bei den Vorgaben des Herstellers.

## Der Bildschirm, den es nicht gibt

V Rising läuft auf Unity und verlangt unter Wine eine X11-Verbindung, obwohl niemand zusieht. Das
Startskript ruft deshalb `proton_bildschirm_starten` (Xvfb, seit `base/proton:2`). Ohne das beendet
sich der Server gleich nach dem Start, mit einer Meldung, die von einem fehlenden Bildschirm nichts
sagt.

## Zwei Verzeichnisse, ein Schalter

Der Client sucht in der **EOS**-Liste; die **Steam**-Liste trägt die A2S-Abfrage, über die das Panel
Spielerzahl und Ping erfährt. Beide hängen am Schalter „In der Serverliste zeigen". Wer ihn
ausschaltet, bleibt erreichbar — wer die Adresse hat, spielt —, aber die Kachel im Panel bleibt
ohne Spielerzahl. Genau dafür gibt es `requiresConfigFlag` in der Spieltyp-Definition; sonst hielte
das Panel einen privaten Server nach zwanzig Minuten für tot (Fundpunkt 248).

## Administratoren

V Rising kennt keine Rechteverwaltung im Panel: Wer Administrator sein will, steht mit seiner
Steam-Kennung in `welten/Settings/adminlist.txt`, eine je Zeile, und meldet sich im Spiel mit
`adminauth` an. Das Image **legt die Datei an, überschreibt sie aber nie** — was der Betreiber
hineinschreibt, überlebt jeden Neustart.

## Tests

`start.test.mjs` prüft ohne Docker, ohne Steam, ohne Proton und ohne Xvfb: die Felder in
`ServerHostSettings.json`, die Maskierung, beide Verzeichnis-Schalter, das RCON-Passwort (bei jedem
Start neu, und dasselbe in Datei und Konfiguration), die Übersetzung des Datenordners in einen
Windows-Pfad — und dass `adminlist.txt` unangetastet bleibt.

Ob der echte Server damit startet, zeigt erst ein Lauf auf der Node.
