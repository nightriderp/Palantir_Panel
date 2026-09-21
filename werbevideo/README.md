# Werbevideo

Werkzeug, mit dem sich ein Vorstellungsvideo des Panels **aus dem laufenden
Panel selbst** aufnehmen lässt: Demo-Bühne, Aufnahme, Schnitt.

Kein Teil der Anwendung. Bewusst außerhalb der pnpm-Workspaces – es wird weder
gebaut noch in der CI geprüft und hat eigene Abhängigkeiten (`npm install` hier
im Ordner).

## Der Grundsatz

Im Video ist nichts nachgestellt. Jeder Zustand, jede Konsolenzeile und jede
Spielerzahl entsteht über die echten Wege des Panels: Die Demo-Node spricht das
Agent-Protokoll aus `packages/contracts` und beantwortet auf dem Spielport
echte Minecraft-Abfragen, weshalb der Health-Check des Backends einen
gestarteten Server auch wirklich auf `running` setzt.

Was es **nicht** ist: ein Ersatz für einen Agent. Es entsteht kein Container,
keine Datei, kein Backup. Die Bühne gehört deshalb ausschließlich auf einen
Aufnahmerechner mit Wegwerf-Datenbank, nie an eine Installation mit echten
Daten.

## Aufbau

```
buehne/      Demo-Bühne: Backend, Frontend, Demo-Node und der Demo-Zustand
  umgebung.beispiel.sh  Vorlage für die Werte der Aufnahme-Installation
  buehne.sh        start | stop | status | bauen
  demo-node.mjs    Agent-Protokoll über WebSocket + Minecraft-Abfrage auf dem Spielport
  daten.mjs        Legt Konten, Server, Sicherungen über die echte API an
  zuruecksetzen.sh Datenbank neu, Migrationen, Seed, Owner, Demo-Zustand
  api.mjs          API-Client mit ALTCHA-Nachweis und CSRF
aufnahme/    Regie: Kamerafahrten, Zeiger, Einblendungen, Einzelbilder
  regie.mjs        Die Aufnahme-Maschinerie
  schicht.mjs      Kamera und Einblendungen im Browser
schnitt/     Zusammenschnitt der Clips zu den fertigen Fassungen
```

## Voraussetzungen

Node 24, ein PostgreSQL auf `127.0.0.1:5432`, Chromium (Pfad über `CHROMIUM`,
Vorgabe ist der Playwright-Chromium) und die Abhängigkeiten dieses Ordners:

```bash
cd werbevideo && npm install
cp buehne/umgebung.beispiel.sh buehne/umgebung.sh   # und die Werte darin setzen
```

`umgebung.sh` trägt die Geheimnisse dieser Aufnahme-Installation und bleibt
lokal – dieselbe Regel wie für die zentrale `.env` im Repo-Root.

Die Adressen der Demo-Server müssen auf den Aufnahmerechner zeigen – auf einem
Linux-Rechner genügt `/etc/hosts`:

```
127.0.0.1 palantir.example router.palantir.example
127.0.0.1 smp.palantir.example creative.palantir.example
127.0.0.1 valheim.palantir.example terraria.palantir.example
```

## Bühne aufbauen

```bash
./buehne/zuruecksetzen.sh     # Datenbank neu + Demo-Zustand (dauert ~2 Minuten)
./buehne/buehne.sh status
```

Danach läuft das Panel auf `http://127.0.0.1:3000`, Anmeldung `mika` /
`Palantir-Demo-2026!`.

> **Die Domain im Bild.** `PALANTIR_DOMAIN` in `buehne/umgebung.sh` steht in
> der Vorlage auf
> `palantir.example`. Diese Adresse steht im Video an jedem Server. Vor der
> endgültigen Aufnahme gehört dort eure echte Domain hinein – danach
> `zuruecksetzen.sh` erneut laufen lassen und die `/etc/hosts`-Zeilen anpassen.

## Stand

Fertig: Bühne, Demo-Daten, Aufnahme-Werkzeug (erprobt an einem Probeclip).
Offen: die Szenen, der Schnitt der beiden Fassungen und die Musik.
