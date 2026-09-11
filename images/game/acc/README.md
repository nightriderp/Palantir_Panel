# Assetto Corsa Competizione (`palantir-game-acc`)

Anonym gibt Valve diesen Server nicht heraus — deshalb zwei Wege zu den Dateien, beide ohne Passwort im Panel.

| Sache         | Wert                                                    |
| ------------- | ------------------------------------------------------- |
| Basis         | `palantir-base-proton:3`                                |
| Serverdateien | `/data/server` — über Steam-Konto oder Datei-Manager    |
| Ports         | 9231/udp Spiel, 9232/tcp Verbindungsaufbau              |
| Konsole       | keine                                                   |
| Abfrage       | keine                                                   |
| Konfiguration | `cfg/configuration.json`, `settings.json`, `event.json` |

## Zwei Wege zu den Serverdateien

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
docker run -it --rm -v /srv/palantir/steam-konto:/heim -e HOME=/heim   ghcr.io/nightriderp/palantir-base-steam:3 /opt/steamcmd/steamcmd.sh +login DEIN_STEAM_NAME +quit
```

Danach im Panel bei den Einstellungen des Servers den **Steam-Benutzernamen** eintragen. Der
Container bekommt den Ordner mit dem Token schreibgeschützt eingehängt (`requiresSteamAccount`),
und der Server holt und **aktualisiert** sich von da an selbst — wie jedes andere Spiel aus Steam.

Ohne Token wird SteamCMD gar nicht erst gerufen: Ein Login, der nach einem Passwort fragt, hinge in
einem Container ohne Eingabe fest. Stattdessen steht im Log, was zu tun ist.

**Was der Token wert ist:** Er ist die Anmeldung an diesem Steam-Konto. Wer Wurzelrechte auf der
Node hat, kann damit herunterladen, was das Konto besitzt. Er gehört dem Benutzer 1000 und
niemandem sonst — und nicht in ein Backup, das das Haus verlässt.

### 2. Von Hand (ohne Steam-Konto)

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
