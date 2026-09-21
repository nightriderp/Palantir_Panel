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

| Datei                            | Länge    | Inhalt                                             |
| -------------------------------- | -------- | -------------------------------------------------- |
| `fassungen/palantir-trailer.mp4` | ~1:08    | Schneller Schnitt für Discord, Startseite, Beitrag |
| `fassungen/palantir-tour.mp4`    | ~3:07    | Ruhiger Rundgang durch alle Funktionen             |
| `…-stumm.mp4`                    | dieselbe | Dieselben Schnitte ohne Ton, zum Selbstvertonen    |

Beide entstehen aus denselben zwölf Clips in `aufnahmen/`. Wer nur eine Szene neu
aufnimmt, schneidet danach neu – der Rest bleibt, wie er war.

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
  aufnehmen.mjs         Die Szenen
  regie.mjs             Die Aufnahme-Maschinerie
  schicht.mjs           Kamera und Einblendungen im Browser
schnitt/     Zusammenschnitt
  schneiden.mjs         Schnittlisten beider Fassungen
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
genügt `/etc/hosts`:

```
127.0.0.1 palantir.example router.palantir.example
127.0.0.1 smp.palantir.example creative.palantir.example survival.palantir.example
127.0.0.1 valheim.palantir.example terraria.palantir.example
```

## Von null zum fertigen Video

```bash
./buehne/buehne.sh bauen          # Produktionsbau des Frontends (einmalig)
./buehne/zuruecksetzen.sh         # Datenbank neu + Demo-Zustand (~2 Minuten)
node aufnahme/aufnehmen.mjs       # alle zwölf Szenen aufnehmen (~30 Minuten)
node schnitt/schneiden.mjs        # beide Fassungen bauen (~3 Minuten)
```

Einzelne Szene wiederholen (etwa nach einer Änderung an der Oberfläche):

```bash
node aufnahme/aufnehmen.mjs 05-starten
node schnitt/schneiden.mjs trailer
```

Bricht eine Szene ab, liegt ein Bildschirmfoto des Moments in
`aufnahmen/abbruch-<szene>.png` – daraus ist meist sofort zu sehen, welcher
Knopf ausgegraut war oder welche Meldung im Weg stand.

## Die Szenen

| Clip            | Inhalt                                                      |
| --------------- | ----------------------------------------------------------- |
| `01-vorspann`   | Titel über dem Anmeldebildschirm                            |
| `02-anmelden`   | Anmelden, Spam-Schutz, Sprung ins Panel                     |
| `03-uebersicht` | Alle Server, Live-Werte, Gesamtstatus                       |
| `04-erstellen`  | Assistent: Spiel, Name, Adresse, Node, Optionen, EULA       |
| `05-starten`    | Start, Konsole läuft voll, `Online`, Spieler verbinden sich |
| `11-luecke`     | Tafel, die den Platz für euer Gameplay hält                 |
| `06-konsole`    | Live-Konsole, Schnellbefehle, eigener Befehl                |
| `07-monitoring` | Messwerte, verbundene Spieler, Node-Auslastung              |
| `08-backups`    | Sicherung anstoßen, Wiederherstellen mit Rückfrage          |
| `09-admin`      | Anfrage freigeben, Rollen, Audit-Log                        |
| `10-abspann`    | Schlusstitel                                                |

Die Reihenfolge im Video steht in `schnitt/schneiden.mjs` (`FASSUNGEN`); dort
sind auch die Ein- und Ausstiegspunkte je Segment hinterlegt.

## Zwei Dinge, die vor der Veröffentlichung gehören

1. **Die Domain im Bild.** `PALANTIR_DOMAIN` steht in der Vorlage auf
   `palantir.example`. Diese Adresse steht im Video an jedem Server. Vor der
   endgültigen Aufnahme gehört dort eure echte Domain hinein – danach
   `zuruecksetzen.sh` erneut laufen lassen und die `/etc/hosts`-Zeilen
   anpassen.
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
