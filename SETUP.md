# SETUP – Palantir einrichten

> **Status:** unvollständig. Ausgearbeitet sind **Datenbank** (Abschnitt 2) und
> **Deployment** (Abschnitt 3). Was noch fehlt – VPS-Grundinstallation, OAuth-Apps,
> WireGuard, Owner-Ersteinrichtung – steht laut [PFLICHTENHEFT.md §12.3](PFLICHTENHEFT.md)
> noch aus und ist unten als offen markiert (siehe „Gefundene Punkte" Nr. 2 in
> [WORK_STATUS.md](WORK_STATUS.md)).

Palantir läuft auf zwei Maschinen:

| Maschine                                     | Rolle                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| **VPS** (Hetzner, öffentlich)                | Reverse Proxy, Frontend, Backend-API, Tunnel-Gateway, Game-Traffic-Proxy, PostgreSQL |
| **Homeserver** (Gameserver-VM unter Proxmox) | Agent, Docker-Socket-Proxy, Docker Engine, Gameserver-Container                      |

Bei jedem Schritt unten steht dabei, auf welcher Maschine er ausgeführt wird.

---

## 1. Zentrale Konfiguration

Es gibt genau **eine** `.env` ([PFLICHTENHEFT.md §12.1](PFLICHTENHEFT.md)). Dieselbe Datei
wird auf beiden Maschinen eingesetzt; jede Komponente liest nur die für sie relevanten
Variablen.

| Maschine            | Ablageort                                   |
| ------------------- | ------------------------------------------- |
| VPS                 | `/opt/palantir/.env`                        |
| Homeserver          | `/opt/palantir/.env` (in der Gameserver-VM) |
| Entwicklungsrechner | `<Repo-Root>/.env`                          |

Erzeugen (auf der jeweiligen Maschine, im Repo-Root):

```bash
./scripts/setup.sh
```

Das Skript kopiert `.env.example` nach `.env`, erzeugt JWT-, CSRF-, ALTCHA- und
Agent-Secret, legt WireGuard-Schlüsselpaare an (sofern `wireguard-tools` installiert ist)
und prüft die Pflichtfelder. Bereits gefüllte Werte werden nie überschrieben.

**Sicherheitsauflage:** `chmod 600 .env`, Eigentümer auf den ausführenden Dienst-Nutzer.
Die Datei gehört nie ins Repository und nicht unverschlüsselt in automatische Backups.

---

## 2. Datenbank (PostgreSQL)

### 2.1 Produktion – VPS

PostgreSQL läuft laut [PFLICHTENHEFT.md §3](PFLICHTENHEFT.md) im Container. Rolle und
Datenbank werden **nicht** von Hand angelegt, sondern vom Container beim ersten Start aus
der `.env` erzeugt.

**Schritt 1 – Zugangsdaten in `/opt/palantir/.env` auf der VPS setzen.** Ein starkes,
zufälliges Passwort erzeugen:

```bash
openssl rand -base64 32 | tr -d '\n=+/' | cut -c1-40
```

Den Wert an **beiden** Stellen eintragen – sie müssen identisch sein:

```
POSTGRES_PASSWORD=<erzeugter Wert>
DATABASE_URL=postgresql://palantir:<erzeugter Wert>@db:5432/palantir
```

Nur alphanumerische Zeichen verwenden. Sonderzeichen müssten in `DATABASE_URL`
URL-kodiert werden und sind eine häufige Fehlerquelle.

**Schritt 2 – Container starten.** Der offizielle `postgres`-Container legt beim ersten
Start aus `POSTGRES_USER`, `POSTGRES_PASSWORD` und `POSTGRES_DB` automatisch Rolle und
Datenbank an:

```bash
docker compose up -d db
```

**Schritt 3 – Migrationen anwenden** (Drizzle Kit, im Repo-Root auf der VPS):

```bash
pnpm --filter @palantir/backend db:migrate
```

**Schritt 4 – Seed-Rollen anlegen** (einmalig bei der Ersteinrichtung, im Repo-Root
`/opt/palantir` auf der **VPS**):

```bash
pnpm --filter @palantir/backend db:seed
```

Legt die Rollen **Admin**, **Moderator**, **Nutzer** und die geschützte Systemrolle
**Gast** an ([PFLICHTENHEFT.md §8](PFLICHTENHEFT.md)). Der Lauf ist idempotent – siehe
Abschnitt 2.4.

**Schritt 5 – Owner-Konto einrichten** (einmalig, nachdem das Panel erreichbar ist):
über die Oberfläche registrieren, dann im Repo-Root `/opt/palantir` auf der **VPS**:

```bash
pnpm --filter @palantir/backend db:owner <benutzername>
```

Ohne diesen Schritt hat niemand die Rechte, den ersten Admin freizuschalten – die
vollständige Anleitung samt Begründung steht in Abschnitt 2.5.

**Wichtig:**

- Der Datenbank-Port wird **nicht** nach außen veröffentlicht. Die Datenbank ist nur im
  Docker-Netz erreichbar – deshalb `@db:5432` in der `DATABASE_URL` und nicht `127.0.0.1`.
- Das Passwort wird nur aus der `.env` gelesen, steht nie in einem Kommando und nie in der
  Shell-History.
- Schema-Änderungen laufen ausschließlich über Migrationen, nie manuell an der laufenden
  Datenbank ([CLAUDE.md §4](CLAUDE.md)).

> Die Compose-Dateien liegen unter `deploy/vps/` und `deploy/gamenode/`. Aus dem
> VPS-Verzeichnis heraus aufrufen:
> `docker compose --env-file ../../.env up -d`

### 2.2 Entwicklungsrechner

Hier läuft PostgreSQL typischerweise nativ statt im Container. Dafür gibt es ein
Hilfsskript, das Rolle und Datenbank anlegt und die `.env` konsistent befüllt:

```powershell
.\scripts\dev-db-setup.ps1
```

Das Skript erzeugt ein zufälliges Passwort für die Rolle `palantir`, legt Rolle und
Datenbank an (mehrfaches Ausführen ist unproblematisch), schreibt `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB` und `DATABASE_URL` in die `.env` und prüft die
Verbindung. Beim Anlegen fragt `psql` einmal nach dem Passwort des
`postgres`-Superusers – dieses Passwort wird nirgends gespeichert.

Von Hand geht es genauso:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -c "CREATE ROLE palantir LOGIN PASSWORD 'DEIN_PASSWORT';"
```

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -c "CREATE DATABASE palantir OWNER palantir;"
```

Danach `POSTGRES_PASSWORD` und `DATABASE_URL` in der `.env` auf denselben Wert setzen.

#### Fallstrick: Welches Datenverzeichnis benutzt der Server wirklich?

`pg_hba.conf` liegt **nicht** zwingend unter `C:\Program Files\PostgreSQL\<version>\data`.
Wird der Cluster mit einem eigenen Datenverzeichnis betrieben, existiert dort trotzdem eine
ungenutzte `pg_hba.conf` – Änderungen daran bleiben wirkungslos, ohne dass es eine
Fehlermeldung gibt. Das tatsächlich benutzte Verzeichnis steht als `-D` im Startbefehl des
Dienstes:

```powershell
Get-CimInstance Win32_Service -Filter "Name='postgresql-x64-18'" | Select-Object -ExpandProperty PathName
```

#### Postgres-Superuser-Passwort unbekannt?

Auf einem Entwicklungsrechner ist der saubere Weg, den Cluster **neu zu initialisieren**,
statt an der Authentifizierung zu drehen. Dienst stoppen, altes Datenverzeichnis umbenennen
(nicht löschen – so bleibt es wiederherstellbar), neu aufsetzen:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\initdb.exe" -D "C:\PalantirDev\pgdata" -U postgres --pwfile=<Datei mit dem Passwort> -E UTF8 --auth-host=scram-sha-256 --auth-local=scram-sha-256
```

Das Passwort über `--pwfile` übergeben, nie als Kommandozeilenargument – sonst steht es in
der Prozessliste und in der Shell-History. Die Datei danach löschen.

Anschließend braucht das Dienstkonto Zugriff auf das neue Verzeichnis (bei der
Standardinstallation `NT AUTHORITY\NetworkService`):

```powershell
icacls "C:\PalantirDev\pgdata" /grant "NT AUTHORITY\NETWORKSERVICE:(OI)(CI)F" /T
```

Dann Dienst starten und `dev-db-setup.ps1` ausführen.

Die Alternative – `pg_hba.conf` vorübergehend auf `trust` setzen, Passwort per
`ALTER ROLE postgres PASSWORD '...'` neu setzen, danach **sofort** auf `scram-sha-256`
zurückstellen – funktioniert auch, öffnet die Datenbank aber währenddessen für jeden
lokalen Prozess. Nur auf einem Entwicklungsrechner, nie auf der VPS, und die Originaldatei
vorher kopieren.

### 2.3 Migrationen (Drizzle Kit)

Das Datenbank-Schema wird ausschließlich über Migrationen geändert, nie von Hand an der
laufenden Datenbank ([CLAUDE.md §4](CLAUDE.md)). Alle Kommandos laufen im Repo-Root, auf
der Maschine, auf der auch das Backend liegt (VPS bzw. Entwicklungsrechner). Die
`DATABASE_URL` kommt aus der zentralen `.env`.

**Migration anwenden** – der übliche Schritt bei Deployment und nach jedem `git pull`:

```bash
pnpm --filter @palantir/backend db:migrate
```

**Migration erzeugen** – nur nach einer Änderung an `apps/backend/src/db/schema.ts`. Die
erzeugte Datei unter `apps/backend/drizzle/` gehört mit in den Commit:

```bash
pnpm --filter @palantir/backend db:generate
```

**Migrationskette prüfen** – meldet Lücken oder Konflikte, etwa nach einem Merge, bei dem
zwei Arbeitspakete parallel eine Migration mitgebracht haben:

```bash
pnpm --filter @palantir/backend db:check
```

Bereits angewendete Migrationen werden nicht nachträglich verändert – Drizzle prüft sie
über einen Hash. Korrekturen laufen immer als neue Migration.

### 2.4 Seed-Rollen (Ersteinrichtung)

Eine frisch migrierte Datenbank enthält **keine** Rollen. Der Seed-Lauf legt die vier
Rollen aus [PFLICHTENHEFT.md §8](PFLICHTENHEFT.md) an. Er gehört einmalig in die
Ersteinrichtung, direkt nach `db:migrate`, und läuft im Repo-Root auf derselben Maschine
wie das Backend – auf der **VPS** unter `/opt/palantir`, auf dem
**Entwicklungsrechner** im geklonten Repository:

```bash
pnpm --filter @palantir/backend db:seed
```

| Rolle         | Berechtigungen                                                                     | Geschützt |
| ------------- | ---------------------------------------------------------------------------------- | --------- |
| **Admin**     | vollständiger Permission-Katalog                                                   | nein      |
| **Moderator** | wie Nutzer, zusätzlich `message.moderate`                                          | nein      |
| **Nutzer**    | eigene Server und Backups verwalten, Nodes einsehen                                | nein      |
| **Gast**      | keine – Standardrolle nach jeder Registrierung ([LASTENHEFT.md §2](LASTENHEFT.md)) | **ja**    |

Admin, Moderator und Nutzer sind danach über die Rollenverwaltung frei editierbar. Die
Rolle **Gast** ist eine geschützte Systemrolle und lässt sich weder bearbeiten noch löschen
– auch nicht vom Owner. Das ist Absicht: sie ist die Auffangrolle jeder neuen
Registrierung.

Der Lauf ist **idempotent** und kann jederzeit wiederholt werden. Vorhandene Rollen bleiben
dabei unverändert – auch dann, wenn ihre Berechtigungen inzwischen angepasst wurden. Ein
erneuter Lauf legt lediglich fehlende Rollen wieder an und stellt so sicher, dass die
Gast-Rolle nie dauerhaft fehlt.

> Der Owner-Account (`User.isOwner`) wird hiervon **nicht** angelegt – er steht außerhalb
> des Rollensystems und bekommt einen eigenen Schritt (§2.5).

### 2.5 Owner-Konto (Ersteinrichtung)

Der Owner ist der Ersteinrichter der Instanz. Sein Sonderstatus liegt **außerhalb** des
Rollensystems ([LASTENHEFT.md §2](LASTENHEFT.md), [PFLICHTENHEFT.md §8](PFLICHTENHEFT.md)):
ein einzelnes Flag am Konto, das immer alle Berechtigungen garantiert – der Schutz davor,
sich durch eine unbedachte Rollenänderung selbst auszusperren. **Genau ein Konto** trägt
ihn.

Ohne diesen Schritt lässt sich die Instanz nicht in Betrieb nehmen: Jedes neu registrierte
Konto bekommt die Rolle „Gast" und damit keinerlei Rechte – ohne Owner ist niemand da, der
den ersten Admin freischalten könnte.

**Schritt 1 – ganz normal registrieren.** Im Browser auf `https://<deine-domain>/register`
ein Konto mit Benutzername und Passwort anlegen. Bewusst der reguläre Weg: dieselben
Passwortregeln, dasselbe CAPTCHA, dieselbe `AuthMethod` wie bei jedem anderen Konto. Der
Wartebildschirm nach der Registrierung ist erwartet – Schritt 2 löst ihn auf.

**Schritt 2 – dieses Konto zum Owner heben.** Im Repo-Root auf derselben Maschine wie das
Backend – auf der **VPS** unter `/opt/palantir`, auf dem **Entwicklungsrechner** im
geklonten Repository:

```bash
pnpm --filter @palantir/backend db:owner <benutzername>
```

Der Benutzername ist die Anmeldekennung aus Schritt 1. Nach einer erfolgreichen Ausführung
meldet das Kommando den Anzeigenamen und die Konto-Id; der Vorgang landet als
`user.ownerGranted` im Audit-Log. Danach einmal ab- und wieder anmelden, damit die
Oberfläche die neuen Rechte sieht.

**Warum ein eigener Schritt und nicht automatisch?** Die Registrierung ist offen
([LASTENHEFT.md §3.1](LASTENHEFT.md)) und das Panel erreichbar, sobald es läuft. Würde das
_erste_ registrierte Konto automatisch Owner, könnte ein Fremder die Instanz im Zeitfenster
zwischen Start und eigener Registrierung übernehmen – ohne Zugangsdaten, allein durch
schnelleres Ausfüllen des Formulars. Der Nachweis ist hier stattdessen der Systemzugang zur
Maschine; ein zusätzliches Geheimnis in der `.env` braucht es dafür nicht.

Der Lauf ist **wiederholbar**: Trägt das genannte Konto den Status schon, passiert nichts.
Trägt ihn ein **anderes** Konto, bricht der Lauf mit `OWNER_ALREADY_EXISTS` ab. Ein zweiter
Owner ist zusätzlich in der Datenbank ausgeschlossen (partieller Unique-Index
`users_single_owner_idx`).

> Einen Weg, den Owner-Status wieder zu entziehen oder auf ein anderes Konto zu übertragen,
> gibt es in Version 1 bewusst nicht – er ist der Schutz davor, dass sich niemand mehr
> anmelden kann. Das Owner-Konto lässt sich aus demselben Grund weder sperren noch selbst
> löschen.

**Ab hier läuft alles über die Oberfläche:** Der Owner sieht die Freischalt-Warteliste
(„Anfragen") und gibt dort weitere Konten mit der passenden Rolle frei.

### 2.6 Archivierung des Audit-Logs (laufender Betrieb)

Das Audit-Log ist append-only ([PFLICHTENHEFT.md §6](PFLICHTENHEFT.md)). Damit die Tabelle
nicht unbegrenzt wächst, exportiert ein Wartungslauf Einträge, die älter als 24 Monate
sind, in eine komprimierte Archivdatei und entfernt sie **erst danach** aus der aktiven
Tabelle. Schlägt der Export fehl, bleibt die Tabelle unverändert.

Vorher in der zentralen `.env` (Abschnitt 14) das Archivverzeichnis eintragen. Es liegt auf
der **VPS**, Vorgabe:

```
AUDIT_ARCHIVE_DIR=/opt/palantir/data/audit-archive
```

Das Verzeichnis anlegen und restriktiv berechtigen – dort liegen Sicherheitsprotokolle:

```bash
sudo mkdir -p /opt/palantir/data/audit-archive
sudo chown palantir:palantir /opt/palantir/data/audit-archive
sudo chmod 700 /opt/palantir/data/audit-archive
```

Der Lauf selbst, im Repo-Root auf der **VPS** (`/opt/palantir`):

```bash
pnpm --filter @palantir/backend audit:archive
```

Er ist gefahrlos wiederholbar: Gibt es nichts zu archivieren, passiert nichts. Wer ihn
regelmäßig will, hängt ihn auf der VPS in einen Cronjob, z. B. monatlich am 1. um 4 Uhr
(`sudo crontab -e -u palantir`):

```
0 4 1 * * cd /opt/palantir && pnpm --filter @palantir/backend audit:archive
```

Dieselbe Aktion steht Admins mit `audit.view` auch in der Oberfläche zur Verfügung.
Einzelne Einträge lassen sich **auf keinem Weg** ändern oder löschen – auch nicht vom
Owner und auch nicht direkt über `psql`: Ein Trigger in der Datenbank lehnt UPDATE, DELETE
und TRUNCATE auf `audit_log` ab.

Die Archivdateien gehören in die Systemsicherung. Sie enthalten das vollständige Protokoll
als gzip-komprimiertes JSON Lines und lassen sich ohne Werkzeug lesen:

```bash
zcat /opt/palantir/data/audit-archive/audit-log-bis-2024-08-26.jsonl.gz | head
```

---

---

## 3. Deployment einrichten

Diese Schritte führt der **Betreiber** aus. Sie sind bewusst nicht automatisiert: jeder
davon legt Zugangsdaten an oder vergibt Rechte, und beides gehört in die Hand einer
Person, nicht in ein Skript.

Konzept und Begründungen stehen in [docs/ci-cd.md](docs/ci-cd.md).

### 3.1 Deploy-Benutzer auf der VPS

Ein eigener Benutzer, **nicht `root`**. Er darf genau zwei Dinge: das Repository unter
`/opt/palantir` aktualisieren und Docker ansprechen.

Alle Befehle auf der **VPS** als `root`:

```bash
adduser --system --group --shell /bin/bash --home /home/palantir-deploy palantir-deploy
```

```bash
usermod -aG docker palantir-deploy
```

> Die Mitgliedschaft in der Gruppe `docker` entspricht faktisch Root-Rechten auf dem
> Host – wer Container starten darf, kann Host-Verzeichnisse einhängen. Das ist der
> Grund, warum der Schlüssel im nächsten Schritt auf ein einziges Kommando festgenagelt
> wird.

Repository auschecken und übergeben:

```bash
git clone https://github.com/nightriderp/Palantir_Panel.git /opt/palantir && chown -R palantir-deploy:palantir-deploy /opt/palantir
```

Für ein privates Repository braucht der Klon Zugangsdaten. Am saubersten ist ein
**Deploy-Key mit Leserecht**: Schlüsselpaar auf der VPS erzeugen, den öffentlichen Teil
unter _Settings → Deploy keys_ im Repository hinterlegen (ohne Schreibrecht), dann über
SSH klonen statt über HTTPS.

Die zentrale `.env` anlegen (siehe Abschnitt 1) und übergeben:

```bash
chown palantir-deploy:palantir-deploy /opt/palantir/.env && chmod 600 /opt/palantir/.env
```

### 3.2 Schlüsselpaar für die Pipeline

Auf dem **Entwicklungsrechner** oder der VPS erzeugen – der private Teil geht gleich nach
GitHub, der öffentliche bleibt auf der VPS:

```bash
ssh-keygen -t ed25519 -f palantir-ci -N "" -C "github-actions-deploy"
```

Auf der **VPS** den öffentlichen Teil hinterlegen. Entscheidend ist das erzwungene
Kommando davor – ohne das wäre der Schlüssel ein vollwertiger Shell-Zugang:

```bash
install -d -m 700 -o palantir-deploy -g palantir-deploy /home/palantir-deploy/.ssh
```

Dann in `/home/palantir-deploy/.ssh/authorized_keys` **eine einzige Zeile** eintragen:

```
command="/opt/palantir/deploy/vps/deploy.sh",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc ssh-ed25519 AAAA... github-actions-deploy
```

Der Teil ab `ssh-ed25519` ist der Inhalt von `palantir-ci.pub`. Rechte setzen:

```bash
chown palantir-deploy:palantir-deploy /home/palantir-deploy/.ssh/authorized_keys && chmod 600 /home/palantir-deploy/.ssh/authorized_keys
```

Probe vom Entwicklungsrechner – der Versuch, eine Shell zu bekommen, muss **scheitern**:

```bash
ssh -i palantir-ci palantir-deploy@49.13.199.77 "whoami"
```

Erwartet wird nicht `palantir-deploy`, sondern die Fehlermeldung des Deploy-Skripts
(`Kein gültiger Commit-SHA`). Genau das ist der Beweis, dass das erzwungene Kommando
greift. Kommt stattdessen `palantir-deploy` zurück, fehlt der `command=`-Teil.

### 3.3 GitHub-Environment `production`

Im Repository unter _Settings → Environments → New environment_, Name `production`.

- **Required reviewers**: dich selbst eintragen. Das ist die Freigabestelle – ohne sie
  läuft kein Deployment.
- **Deployment branches**: auf `main` beschränken.

Dann unter _Environment secrets_ anlegen:

| Name          | Inhalt                                                        |
| ------------- | ------------------------------------------------------------- |
| `VPS_SSH_KEY` | vollständiger Inhalt von `palantir-ci` (der **private** Teil) |
| `VPS_HOST`    | IP oder Hostname der VPS                                      |
| `VPS_USER`    | `palantir-deploy`                                             |

Wichtig: als **Environment**-Secret, nicht als Repository-Secret. Nur dann ist der
Schlüssel ausschließlich für Jobs verfügbar, die dieses Environment ansprechen – und die
brauchen deine Freigabe. Als Repository-Secret wäre er für jeden Workflow-Lauf lesbar,
auch ohne Freigabe.

Den privaten Schlüssel danach vom Entwicklungsrechner löschen. Er liegt jetzt an genau
zwei Stellen, an denen er sein soll: im GitHub-Environment und – als öffentlicher
Gegenpart – in der `authorized_keys`.

### 3.4 Gamenode vorbereiten

In der **Gameserver-VM** auf dem Homeserver:

```bash
git clone https://github.com/nightriderp/Palantir_Panel.git /opt/palantir
```

Auch hier ist für ein privates Repository ein **Deploy-Key mit Leserecht** nötig – die
Node holt sich ihren Stand selbst und braucht dauerhaften Lesezugriff.

Datenverzeichnisse anlegen (Pfade müssen zu `AGENT_DATA_DIR` und `AGENT_BACKUP_DIR` in
der `.env` passen):

```bash
mkdir -p /srv/palantir/servers /srv/palantir/backups
```

Timer einrichten:

```bash
cp /opt/palantir/deploy/gamenode/palantir-update.{service,timer} /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now palantir-update.timer
```

Prüfen:

```bash
systemctl list-timers palantir-update.timer
```

### 3.5 Reihenfolge

3.1 und 3.2 gehören zusammen und müssen vor 3.3 fertig sein – sonst liegt im Environment
ein Schlüssel, zu dem es keinen Gegenpart gibt. 3.4 ist unabhängig und kann jederzeit
erfolgen; der Timer läuft dann eben ins Leere, bis der Zweig `prod` das erste Mal gesetzt
wird.

---

## 4. Noch zu ergänzen

Diese Abschnitte fordert [PFLICHTENHEFT.md §12.3](PFLICHTENHEFT.md), sie sind noch nicht
geschrieben:

- **VPS vorbereiten** – Grundinstallation, Reverse Proxy (Caddy oder Traefik) mit
  automatischem TLS, Firewall
- **OAuth-Apps anlegen** – Discord, Twitch, Steam inkl. Redirect-URIs passend zur Domain
- **WireGuard einrichten** – fertige `wg0.conf` für VPS (`/etc/wireguard/wg0.conf`) und
  Homeserver (`/etc/wireguard/wg0.conf` in der Gameserver-VM), Keepalive, AllowedIPs
- **Homeserver-VM vorbereiten** – Docker, Docker-Socket-Proxy, Datenverzeichnisse
- **DNS/Cloudflare** – Zone, API-Token mit ausschließlich DNS-Bearbeitungsrecht,
  „DNS only" für Spiele-Subdomains
