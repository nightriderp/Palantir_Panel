# Eigenes Material

Hier hinein kommt, was nicht aus dem Panel stammt. Der Ordner ist bis auf diese
Datei leer und bleibt es auch im Repository – große Mediendateien gehören nicht
in die Versionsverwaltung.

## `gameplay.mp4` – der Mitschnitt aus dem Spiel

Im Schnitt ist eine Lücke vorgesehen: Nach dem Start des Servers und der
Adresse sieht man im Video, wie die Ersten sich verbinden – was danach _im
Spiel_ passiert, kann das Aufnahme-Werkzeug nicht liefern. Es steuert einen
Browser, kein Spiel.

Legt euren Mitschnitt hier als `gameplay.mp4` ab (auch `.mov`, `.mkv` oder
`.webm` werden genommen) und schneidet neu:

```bash
node schnitt/schneiden.mjs
```

Der Schnitt nimmt die ersten Sekunden der Datei (8 s im Rundgang, 6 s im
Trailer), bringt sie auf 1920×1080 und blendet an beiden Enden weich. Ohne die
Datei steht dort eine Tafel, die den Platz hält – im fertigen Video ist also
sofort zu sehen, dass dort noch etwas fehlt.

Was sich gut macht: die ersten Sekunden nach dem Verbinden – Ladebildschirm,
Spawn, ein zweiter Spieler, der dazukommt. Kein Ton nötig, der Schnitt legt
ohnehin Musik darüber.

## `musik.wav` – eigene Musik

Liegt hier eine Datei `musik.wav` (oder `.mp3`, `.m4a`, `.flac`, `.ogg`), nimmt
der Schnitt sie statt des erzeugten Stücks. Sie wird um 3 dB abgesenkt und am
Ende ausgeblendet; zu kurze Musik lässt den Rest stumm, zu lange wird
abgeschnitten.

⚠️ Bei Musik von Dritten liegt die Lizenzfrage bei euch. Das erzeugte Stück
(`schnitt/musik.mjs`) entsteht aus Rechnung, nicht aus fremdem Material –
daran hat niemand Rechte außer euch.
