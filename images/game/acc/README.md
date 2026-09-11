# Assetto Corsa Competizione (`palantir-game-acc`)

Anonym gibt Valve diesen Server nicht heraus — deshalb drei Wege zu den Dateien, keiner davon mit einem Passwort im Panel.

| Sache         | Wert                                                     |
| ------------- | -------------------------------------------------------- |
| Basis         | `palantir-base-proton:3`                                 |
| Serverdateien | `/data/server` — Steam-Konto, eigenes Archiv oder Upload |
| Ports         | 9231/udp Spiel, 9232/tcp Verbindungsaufbau               |
| Konsole       | keine                                                    |
| Abfrage       | keine                                                    |
| Konfiguration | `cfg/configuration.json`, `settings.json`, `event.json`  |

## Drei Wege zu den Serverdateien

Kunos gibt den dedizierten Server **nicht anonym** heraus: Er ist ein Werkzeug am Elternspiel
(Anwendung 1430110, Eltern 805550). Nachgemessen:

```
Connecting anonymously to Steam Public...OK
ERROR! Failed to install app '1430110' (No subscription)
```

Es braucht ein Konto, das ACC besitzt. **Ein Passwort steht deshalb trotzdem nirgends im Panel.**

### 1. Steam-Konto (der Server lädt selbst)

Einmalig auf der Gamenode — Passwort und Steam-Guard-Code werden dort abgefragt, per SSH:

```bash
mkdir -p /srv/palantir/steam-konto && chown 1000:1000 /srv/palantir/steam-konto
docker run -it --rm -v /srv/palantir/steam-konto:/konto ghcr.io/nightriderp/palantir-base-steam:5 palantir-steam-anmelden DEIN_STEAM_NAME
```

Danach im Panel bei den Einstellungen des Servers den **Steam-Benutzernamen** eintragen. Der
Container bekommt den Ordner mit dem Token schreibgeschützt eingehängt (`requiresSteamAccount`),
und der Server holt und **aktualisiert** sich von da an selbst — wie jedes andere Spiel aus Steam.

`palantir-steam-anmelden` steckt im Image: Von Hand aufgerufen scheitert SteamCMD daran, dass es sich in sein eigenes Verzeichnis aktualisieren will — das gehört `root`, gelaufen wird als Benutzer 1000, und die Meldung darauf lautet irreführend „Steamcmd needs to be online to update".

Ohne Token wird SteamCMD gar nicht erst gerufen: Ein Login, der nach einem Passwort fragt, hinge in
einem Container ohne Eingabe fest. Stattdessen steht im Log, was zu tun ist.

**Was der Token wert ist:** Er ist die Anmeldung an diesem Steam-Konto. Wer Wurzelrechte auf der
Node hat, kann damit herunterladen, was das Konto besitzt. Er gehört dem Benutzer 1000 und
niemandem sonst — und nicht in ein Backup, das das Haus verlässt.

### 2. Eigenes Archiv (der Weg ganz ohne Steam)

Den Serverordner **als ZIP oder tar.gz** an eine Adresse legen, die die Node erreicht — die eigene
VPS genügt. Dann im Panel zwei Felder füllen:

| Feld                       | Inhalt                                 |
| -------------------------- | -------------------------------------- |
| Adresse des Server-Archivs | `https://…/acc-server.zip`             |
| Prüfsumme des Archivs      | Ausgabe von `sha256sum acc-server.zip` |

**Die Prüfsumme ist Bedingung, nicht Zierde.** Was hier ankommt, wird unter Proton ausgeführt; ohne
sie wäre jede halbe Übertragung und jede falsche Adresse ein ausgeführtes Programm unbekannter
Herkunft. Sie ist außerdem das, woran der zweite Start erkennt, dass er nichts tun muss.

Geholt wird **nur, wenn die Serverdateien fehlen** — ein Archiv aktualisiert sich nicht von selbst,
und ein Download bei jedem Start wäre hundert Megabyte für nichts. Bei einem ACC-Update tauschst du
das Archiv aus, löschst den Ordner `server` im Datei-Manager und startest neu.

Packt jemand den Ordner samt Namen ein (der häufigste Fehler), liegt `accServer.exe` eine Ebene zu
tief. Das Startskript zieht den Inhalt dann selbst hoch und sagt es im Log.

### 3. Von Hand (ohne Steam-Konto)

Den Ordner aus der eigenen ACC-Installation über den **Datei-Manager** nach `server` im Datenordner
legen; als ZIP hochladen und entpacken geht auch:

```
steamapps/common/Assetto Corsa Competizione Dedicated Server
```

Dann bleibt das Feld für den Benutzernamen leer. Der Preis: Bei einem ACC-Update lädst du den Ordner
neu hoch.

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
