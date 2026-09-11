# Satisfactory (`palantir-game-satisfactory`)

Ein Server, der sich selbst verwaltet.

| Sache         | Wert                                            |
| ------------- | ----------------------------------------------- |
| Basis         | `palantir-base-steam:2`                         |
| Anwendung     | 1690800 (dedizierter Server), anonyme Anmeldung |
| Port          | 7777 — **TCP und UDP unter derselben Nummer**   |
| Konsole       | keine                                           |
| Serverdateien | `/data/server`, von SteamCMD verwaltet          |
| Spielstände   | `/data/spielstaende`                            |

## Der Port trägt beide Protokolle

Seit Update 1.0 läuft alles über eine Nummer — Spiel, Abfrage und die Schnittstelle des
Server-Managers im Spiel. Der Client leitet die zweite Adresse **nicht ab**, er benutzt dieselbe.

Mit zwei getrennten Port-Einträgen bekäme er aus dem Pool zwei verschiedene Nummern, und das
Beitreten bräche. Die Spieltyp-Definition sagt deshalb `protocol: 'both'`; der Pool sucht dann eine
Nummer, die in beiden Bereichen frei ist, und vergibt sie zweimal. Genau dafür wurde das
Port-Modell erweitert — vorher fiel dieses Spiel aus der Liste.

## Es gibt fast nichts einzustellen

Und das ist keine Lücke: **Servername, Passwörter und Spielstand vergibt der erste Spieler im
Spiel**, wenn er den Server übernimmt („claimt"). Das Panel hat deshalb kein einziges
Konfigurationsfeld für Satisfactory — ein Formularfeld, das nach dem Übernehmen nichts mehr
bewirkt, wäre eine Falle.

Das Panel liefert: Port, Ressourcen und den Ordner, in dem die Spielstände liegen.

## Zwei Dinge, die trotzdem schiefgehen können

**`HOME` muss in den Datenordner zeigen.** Satisfactory legt seine Spielstände unter
`$HOME/.config/Epic/FactoryGame` ab. Zeigte `HOME` ins schreibgeschützte Wurzeldateisystem, verlöre
der Server jeden Spielstand beim Neuaufbau des Containers — und das fiele erst auf, wenn es zu spät
ist.

**`steamclient.so` gehört nach `~/.steam/sdk64`.** Fehlt sie, scheitert die Anmeldung an Steam und
niemand kommt herein.

**`-multihome=0.0.0.0`** ist Pflicht: Ohne das lauscht der Server auf einer Adresse, die im
Container niemandem gehört.

## Der erste Start dauert

Über zehn Gigabyte Serverdateien. Die Startfrist steht auf dreißig Minuten.

## Tests

`start.test.mjs` prüft ohne Docker, ohne Steam und ohne das Spiel: dass das Zuhause im Datenordner
liegt, dass `steamclient.so` dort landet, wo der Server sie sucht, und dass Port und
`-multihome` in der Argumentliste ankommen.

Ob der echte Server damit startet, zeigt erst ein Lauf auf der Node.
