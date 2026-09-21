# Werbevideo

Werkzeug, mit dem sich ein Vorstellungsvideo des Panels **aus dem laufenden
Panel selbst** aufnehmen lässt: Demo-Bühne, Aufnahme, Schnitt.

Kein Teil der Anwendung. Es liegt bewusst außerhalb der pnpm-Workspaces – es
wird weder gebaut noch in der CI geprüft und hat eigene Abhängigkeiten.

## Der Grundsatz

Im Video ist nichts nachgestellt. Jeder Zustand, jede Konsolenzeile und jede
Spielerzahl entsteht über die echten Wege des Panels: Die Demo-Node spricht das
Agent-Protokoll aus `packages/contracts` und beantwortet auf dem Spielport
echte Minecraft-Abfragen – deshalb setzt der Health-Check des Backends einen
gestarteten Server auch wirklich auf `running`, und die Spielerzahl im Panel
ist gemessen, nicht gesetzt.

Was es **nicht** ist: ein Ersatz für einen Agent. Es entsteht kein Container,
keine Datei, kein Backup. Die Bühne gehört deshalb ausschließlich auf einen
Aufnahmerechner mit Wegwerf-Datenbank, nie an eine Installation mit echten
Daten.

## Was am Ende herauskommt

Drei Videos aus demselben Material, dazu je eine stumme Fassung zum
Selbstvertonen:

| Datei                            | Länge | Inhalt                                                        |
| -------------------------------- | ----- | ------------------------------------------------------------- |
| `fassungen/palantir-trailer.mp4` | ~1:15 | Bildschirmaufnahme, schnell geschnitten                       |
| `fassungen/palantir-tour.mp4`    | ~4:00 | Bildschirmaufnahme, ruhiger Rundgang durch alle Funktionen    |
| `fassungen/palantir-motion.mp4`  | ~1:05 | Motion-Film: Standbilder, Schnitt auf den Takt, große Schrift |
| `fassungen/palantir-mix.mp4`     | ~2:20 | Motion als Rahmen und Kapitelmarken, dazwischen die Aufnahme  |
| `…-stumm.mp4`                    | je    | Dieselben Schnitte ohne Ton                                   |

Trailer und Tour kommen aus den Szenen in `aufnahme/aufnehmen.mjs`, der
Motion-Film aus `motion/film.mjs`, die Mischung aus beidem. Wer nur eine Szene
neu aufnimmt, schneidet danach neu – der Rest bleibt, wie er war.

**Gefilmt wird ein Konto mit der Rolle „Nutzer"** – kein Owner, kein Admin.
Die Administrationsseiten kommen in keinem der drei Videos vor: Sie sieht außer
dem Betreiber nie jemand.

## Aufbau

```
buehne/      Demo-Bühne: Backend, Frontend, Demo-Node und der Demo-Zustand
  umgebung.beispiel.sh  Vorlage für die Werte der Aufnahme-Installation
  buehne.sh             start | stop | status | bauen
  demo-node.mjs         Agent-Protokoll über WebSocket + Minecraft-Abfrage am Spielport
  daten.mjs             Legt Konten, Server und Sicherungen über die echte API an
  zuruecksetzen.sh      Datenbank neu, Migrationen, Seed, Owner, Demo-Zustand
  api.mjs               API-Client mit ALTCHA-Nachweis und CSRF
aufnahme/    Regie: Kamerafahrten, Zeiger, Einblendungen, Einzelbilder
  aufnehmen.mjs         Die Szenen der Aufnahmefassung
  regie.mjs             Die Aufnahme-Maschinerie
  schicht.mjs           Kamera und Einblendungen im Browser
motion/      Der Motion-Film: keine Aufnahme, sondern inszenierte Standbilder
  bilder.mjs            Legt die Bildbibliothek an (und holt das Logo aus dem Repo)
  buehne.html           Die Bühne: Kacheln, Schrift, Scan-Ecken, Blitz, Abbinder
  kino.mjs              Der Renderer – Zustand setzen, fotografieren, weiter
  film.mjs              Das Drehbuch in vier Abschnitten
schnitt/     Zusammenschnitt
  schneiden.mjs         Die Schnittlisten aller Fassungen
  musik.mjs             Erzeugt die Musik passend zur Länge
  telefonrahmen.mjs     Zeichnet den Rahmen für die Handy-Aufnahme
material/    Euer eigenes Material (Gameplay, eigene Musik) – siehe dort
```

## Voraussetzungen

Node 24, ein PostgreSQL auf `127.0.0.1:5432`, Chromium (Pfad über `CHROMIUM`;
Vorgabe ist der Chromium von Playwright) und die Abhängigkeiten dieses Ordners:

```bash
cd werbevideo
npm install
cp buehne/umgebung.beispiel.sh buehne/umgebung.sh   # und die Werte darin setzen
```

`umgebung.sh` trägt die Geheimnisse dieser Aufnahme-Installation und bleibt
lokal – dieselbe Regel wie für die zentrale `.env` im Repo-Root.

Die Adressen der Demo-Server müssen auf den Aufnahmerechner zeigen; unter Linux
genügt `/etc/hosts`. Die Namen folgen `PALANTIR_DOMAIN` aus `umgebung.sh` – mit
`nightriderp.org` also:

```
127.0.0.1 nightriderp.org router.nightriderp.org
127.0.0.1 smp.nightriderp.org creative.nightriderp.org survival.nightriderp.org
127.0.0.1 valheim.nightriderp.org terraria.nightriderp.org
```

Die Einträge gelten nur auf dem Aufnahmerechner; an der echten DNS-Zone ändert
sich nichts. Der Health-Check des Backends fragt die Server über genau diese
Namen ab – ohne die Zeilen liefe die Abfrage gegen die echte Adresse.

## Von null zum fertigen Video

```bash
./buehne/buehne.sh bauen          # Produktionsbau des Frontends (einmalig)
./buehne/zuruecksetzen.sh         # Datenbank neu + Demo-Zustand (~2 Minuten)
node aufnahme/aufnehmen.mjs       # alle Szenen aufnehmen (~35 Minuten)
node motion/bilder.mjs            # Bildbibliothek für den Motion-Film (~2 Minuten)
node motion/film.mjs              # den Motion-Film rendern (~6 Minuten)
node schnitt/schneiden.mjs        # alle vier Fassungen bauen (~6 Minuten)
```

Einzelne Szene oder Fassung wiederholen (etwa nach einer Änderung an der
Oberfläche):

```bash
node aufnahme/aufnehmen.mjs 05-starten
node motion/film.mjs 21-koennen
node schnitt/schneiden.mjs trailer
```

Der Motion-Film braucht **nur die Bildbibliothek**, keine laufende Bühne – er
lässt sich also auch dann neu rendern, wenn Backend und Demo-Node aus sind.
Die Bibliothek selbst braucht sie natürlich.

Bricht eine Szene ab, liegt ein Bildschirmfoto des Moments in
`aufnahmen/abbruch-<szene>.png` – daraus ist meist sofort zu sehen, welcher
Knopf ausgegraut war oder welche Meldung im Weg stand.

## Die Szenen

Bildschirmaufnahme (`aufnahme/aufnehmen.mjs`) – alles aus der Sicht von `mika`,
Rolle „Nutzer":

| Clip            | Inhalt                                                      |
| --------------- | ----------------------------------------------------------- |
| `01-vorspann`   | Titel über dem Anmeldebildschirm                            |
| `02-anmelden`   | Anmelden, Spam-Schutz, Sprung ins Panel                     |
| `03-uebersicht` | Alle Server, Live-Werte, Gesamtstatus                       |
| `04-erstellen`  | Assistent: Spiel, Name, Adresse, Node, Optionen, EULA       |
| `05-starten`    | Start, Konsole läuft voll, `Online`, Spieler verbinden sich |
| `06-konsole`    | Live-Konsole, Schnellbefehle, eigener Befehl                |
| `07-monitoring` | Messwerte, verbundene Spieler, Node-Auslastung              |
| `08-backups`    | Sicherung anstoßen, Wiederherstellen mit Rückfrage          |
| `09-teilen`     | Mitverwalter eintragen, geplante Aufgabe anlegen            |
| `10-drumherum`  | Nachrichten, Arcade (kurz gespielt), Erfolge                |
| `11-themes`     | Durch die Themes klicken – ohne Neuladen                    |
| `12-handy`      | Dasselbe Panel im Hochformat (kommt in den Telefonrahmen)   |
| `13-luecke`     | Tafel, die den Platz für euer Gameplay hält                 |
| `14-abspann`    | Schlusstitel                                                |

Motion-Film (`motion/film.mjs`) – inszenierte Standbilder, nichts aufgenommen:

| Abschnitt    | Inhalt                                                       |
| ------------ | ------------------------------------------------------------ |
| `20-auftakt` | Getippter Titel, die Streuung rückt heran                    |
| `21-koennen` | Neun Beats: je eine Sache, je ein Bild, Schnitt auf den Takt |
| `22-ohne`    | Heller Teil: kein Abo, keine Slot-Preise, keine fremde Firma |
| `23-marke`   | Abbinder mit dem Logo aus dem Repo                           |

Die Reihenfolge im Video steht in `schnitt/schneiden.mjs` (`FASSUNGEN`); dort
sind auch die Ein- und Ausstiegspunkte je Segment hinterlegt.

### Der Ton

Frech in den Zwischentexten, nüchtern in der Sache – dieselbe Regel wie bei den
Theme-Sprüchen des Panels (`lib/theme/sprueche.ts`): Ein Scherz steht nur dort,
wo ein Missverständnis nichts kostet. Kein Untertitel behauptet etwas, das im
selben Bild nicht zu sehen ist.

## Zwei Dinge, die vor der Veröffentlichung gehören

1. **Die Domain im Bild.** `PALANTIR_DOMAIN` steht im Video an jedem Server.
   In der Vorlage steht der Platzhalter `palantir.example`; für die
   ausgelieferten Fassungen ist `nightriderp.org` gesetzt. Beim Wechsel gehören
   drei Schritte zusammen: Wert in `umgebung.sh`, `/etc/hosts` anpassen und
   **das Frontend neu bauen** (`./buehne/buehne.sh bauen`) – `NEXT_PUBLIC_BASE_DOMAIN`
   steckt fest im Bau. Danach neu aufnehmen; die Adresse ist in fast jeder
   Szene zu sehen.
2. **Euer Spielmaterial.** Siehe `material/README.md`. Ohne es steht an der
   Stelle eine Tafel.

## Warum es so gebaut ist

**Einzelbilder statt Bildschirmaufnahme.** Vor jedem Bild wird Chromiums
virtuelle Uhr um genau ein Bild weitergestellt, dann wird fotografiert. Ob ein
Bild 20 ms oder 500 ms braucht, ändert am Ergebnis nichts – jede Bewegung im
Video ist exakt gleichmäßig, auch die der Oberfläche selbst. Eine Aufnahme nach
der Wanduhr ruckelt auf einem ausgelasteten Rechner.

**Kamera im Browser statt Zoom im Schnitt.** Ein Zoom im Schnitt rechnet
Bildpunkte hoch. Ein `transform` auf der Seite lässt Chromium den Text in der
Zielgröße neu rastern – der Zoom ist so scharf wie das Standbild.

**Die Oberfläche wird über sichtbaren Text angesprochen**, nicht über
Klassennamen. Ändert sich das Markup, läuft die Aufnahme weiter; ändert sich
die Beschriftung, bricht sie ab und sagt, wo.
