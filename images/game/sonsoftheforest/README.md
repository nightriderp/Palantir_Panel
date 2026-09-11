# Sons of the Forest (`palantir-game-sonsoftheforest`)

Windows-Server unter Proton, wie Enshrouded und V Rising. Die Besonderheit sind die **drei Ports**.

| Sache         | Wert                                                   |
| ------------- | ------------------------------------------------------ |
| Basis         | `palantir-base-proton:2`                               |
| Anwendung     | 2465200 (dedizierter Server, **Windows**), anonym      |
| Ports         | 8766/udp Spiel, 27016/udp Abfrage, 9700/udp Abgleich   |
| Konsole       | keine                                                  |
| Serverdateien | `/data/server`, von SteamCMD verwaltet                 |
| Welten        | `/data/welten` (`dedicatedserver.cfg` und Spielstände) |

## Der dritte Port

Spiel- und Abfrage-Port kennt man von jedem Steam-Spiel. Der dritte (`BlobSyncPort`) gleicht beim
Beitreten die Weltdaten ab — alles, was Spieler gebaut und verändert haben. Fehlt er, verbindet sich
der Spieler, der Server meldet nichts Auffälliges, und der Ladebildschirm bleibt stehen. Ein Fehler,
der wie ein Problem des Spielers aussieht und keins ist.

## Der Erreichbarkeitstest muss aus

Der Server prüft beim Start, ob er von außen erreichbar ist, und **beendet sich, wenn die Prüfung
fehlschlägt**. Hinter dem Rückwärtstunnel schlägt sie immer fehl: Der Server sieht die Adresse der
Node, erreichbar ist er über die der VPS. `SkipNetworkAccessibilityTest` steht deshalb fest auf
`true`; ohne das startete kein einziger Server dieses Spiels im Panel.

## Der Bildschirm, den es nicht gibt

Der Server läuft auf Unity und verlangt unter Wine eine X11-Verbindung, obwohl niemand zusieht. Das
Startskript ruft deshalb `proton_bildschirm_starten` (Xvfb, seit `base/proton:2`).

## Keine Konsole

Weder Standardeingabe noch RCON. Das Panel zeigt die Ausgabe, mit ausgegrautem Eingabefeld. Verwaltet
wird im Spiel.

## Tests

`start.test.mjs` prüft ohne Docker, ohne Steam, ohne Proton und ohne Xvfb: die Felder in
`dedicatedserver.cfg`, alle drei Ports, den abgeschalteten Erreichbarkeitstest, `SaveMode`
(„Continue" statt „New" — sonst begänne jeder Neustart eine neue Welt), die Maskierung und die
Übersetzung des Datenordners in einen Windows-Pfad.

Ob der echte Server damit startet, zeigt erst ein Lauf auf der Node.
