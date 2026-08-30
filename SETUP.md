# SETUP – Palantir einrichten

> **Status:** vollständig für Version 1. Beschrieben sind zentrale Konfiguration (§1),
> Datenbank (§2), Deployment-Pipeline (§3), VPS-Grundinstallation (§4), OAuth-Apps (§5),
> WireGuard-Tunnel (§6), Homeserver-VM (§7) und DNS/Cloudflare (§8). Deckt die von
> [PFLICHTENHEFT.md §12.3](PFLICHTENHEFT.md) geforderte Schritt-für-Schritt-Anleitung ab.
>
> **Empfohlene Reihenfolge einer Neu-Einrichtung:** §1 (`.env`) → §4 (VPS-Grundinstallation)
> → §6 (WireGuard) → §8 (DNS) → §5 (OAuth-Apps) → §2 (Datenbank) → §3 (Deployment-Pipeline)
> → §7 (Homeserver-VM). WireGuard (§6) muss vor dem ersten `docker compose up` stehen,
> sonst existiert die Tunnel-Adresse `10.10.0.1` beim Containerstart noch nicht (§3.4).

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
DATABASE_URL=postgresql://palantir:<erzeugter Wert>@postgres:5432/palantir
```

Nur alphanumerische Zeichen verwenden. Sonderzeichen müssten in `DATABASE_URL`
URL-kodiert werden und sind eine häufige Fehlerquelle.

**Schritt 2 – Container starten.** Der offizielle `postgres`-Container legt beim ersten
Start aus `POSTGRES_USER`, `POSTGRES_PASSWORD` und `POSTGRES_DB` automatisch Rolle und
Datenbank an:

```bash
docker compose --env-file ../../.env up -d postgres
```

**Schritt 3 – Migrationen.** Nichts zu tun: der Dienst `migrate` in der Compose-Datei
wendet sie bei jedem Start an, bevor Backend und Frontend hochfahren.

**Schritt 4 – Ersteinrichtung ausführen** (einmalig, aus `/opt/palantir/deploy/vps`
auf der **VPS**):

```bash
docker compose --env-file ../../.env run --rm seed
```

> Achtung, häufiger Irrtum: Auf der VPS gibt es **weder Node noch pnpm** - dort läuft nur
> Docker. Ein `pnpm --filter @palantir/backend db:seed` ist dort nicht ausführbar. Der
> Aufruf oben nutzt denselben kompilierten Stand aus dem Backend-Image.
>
> Ohne diesen Lauf existiert nach dem ersten Start **keine einzige Rolle** - niemand kann
> dann irgendetwas, auch der Owner nicht.

Legt die Rollen **Admin**, **Moderator**, **Nutzer** und die geschützte Systemrolle
**Gast** an ([PFLICHTENHEFT.md §8](PFLICHTENHEFT.md)). Der Lauf ist idempotent – siehe
Abschnitt 2.4.

**Schritt 5 – Owner-Konto einrichten** (einmalig, nachdem das Panel erreichbar ist):
zuerst über die Oberfläche registrieren, dann aus `/opt/palantir/deploy/vps` auf der
**VPS**:

```bash
docker compose --env-file ../../.env run --rm owner <benutzername>
```

Ohne diesen Schritt hat niemand die Rechte, den ersten Admin freizuschalten – die
vollständige Anleitung samt Begründung steht in Abschnitt 2.5.

**Wichtig:**

- Der Datenbank-Port wird **nicht** nach außen veröffentlicht. Die Datenbank ist nur im
  Docker-Netz erreichbar – deshalb `@postgres:5432` in der `DATABASE_URL` und nicht `127.0.0.1`.
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
laufenden Datenbank ([CLAUDE.md §4](CLAUDE.md)).

Die folgenden Kommandos gelten für den **Entwicklungsrechner** und laufen dort im
Repo-Root. Auf der **VPS** gibt es weder Node noch pnpm - dort erledigt das der Dienst
`migrate` beim Start (Abschnitt 2.1). Die `DATABASE_URL` kommt jeweils aus der zentralen
`.env`.

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
Rollen aus [PFLICHTENHEFT.md §8](PFLICHTENHEFT.md) an und dazu die erste Node. Er gehört
einmalig in die Ersteinrichtung.

Auf der **VPS** (aus `/opt/palantir/deploy/vps`, siehe Abschnitt 2.1 Schritt 4):

```bash
docker compose --env-file ../../.env run --rm seed
```

Auf dem **Entwicklungsrechner** im Repo-Root:

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

**Schritt 2 – dieses Konto zum Owner heben.** Auf der **VPS** über den Compose-Dienst
`owner`, aus `/opt/palantir/deploy/vps`:

```bash
docker compose --env-file ../../.env run --rm owner <benutzername>
```

> Wie beim Seed-Lauf: Auf der VPS gibt es **weder Node noch pnpm**, dort läuft nur Docker.
> Der Dienst nutzt denselben kompilierten Stand aus dem Backend-Image. Er trägt den
> Benutzernamen bewusst als `entrypoint`-Argument – ein `command` würde von
> `docker compose run` ersetzt, und der Name käme nie beim Skript an.

Auf dem **Entwicklungsrechner** läuft derselbe Schritt direkt über pnpm, im Repo-Root des
geklonten Repositories:

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
sudo chown 1000:1000 /opt/palantir/data/audit-archive
sudo chmod 700 /opt/palantir/data/audit-archive
```

> Die Zahl 1000 ist kein Tippfehler: In das Verzeichnis schreibt der
> **Backend-Container**, und der läuft als Benutzer `node` mit dieser UID. Ein
> Verzeichnis, das dem Deploy-Benutzer des Hosts gehört, wäre für ihn nicht
> beschreibbar.

Der Lauf selbst, aus `/opt/palantir/deploy/vps` auf der **VPS**:

```bash
docker compose --env-file ../../.env run --rm archive
```

Auch hier gilt: Auf der VPS gibt es weder Node noch pnpm. Der Aufruf nutzt denselben
kompilierten Stand aus dem Backend-Image.

Er ist gefahrlos wiederholbar: Gibt es nichts zu archivieren, passiert nichts. Wer ihn
regelmäßig will, hängt ihn auf der VPS in einen Cronjob, z. B. monatlich am 1. um 4 Uhr
(`sudo crontab -e -u palantir-deploy` – der Benutzer muss in der Gruppe `docker` sein):

```
0 4 1 * * cd /opt/palantir/deploy/vps && docker compose --env-file ../../.env run --rm archive
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

Alle Schritte in diesem Abschnitt laufen in der **Gameserver-VM** auf dem Homeserver.

#### Wo die Zugangsdaten liegen – und warum nicht in `/root`

Der Update-Dienst läuft als `root`, aber mit `ProtectHome=true`: `/root` und `/home` sind
für ihn ausgeblendet. Zugangsdaten, die dort liegen, sieht er nicht – ein `docker login`
als root schriebe nach `/root/.docker/config.json`, und der Pull des privaten Agent-Images
scheiterte im Timer mit `unauthorized`, obwohl er von Hand funktioniert. Beides gehört
deshalb nach `/etc/palantir`:

```bash
mkdir -p /etc/palantir/docker && chmod 700 /etc/palantir
```

#### Deploy-Key und Auscheckung

Das Repository ist privat, die Node braucht dauerhaften Lesezugriff. Der Schlüssel der VPS
lässt sich nicht mitbenutzen: GitHub nimmt denselben Deploy-Key nur bei genau einem
Repository an, und ein zweiter Rechner braucht ohnehin ein eigenes Schlüsselpaar.

```bash
ssh-keygen -t ed25519 -N '' -C 'palantir-gamenode-readonly' -f /etc/palantir/repo_readonly
```

Den **öffentlichen** Teil (`/etc/palantir/repo_readonly.pub`) im Repository unter
_Settings → Deploy keys → Add deploy key_ eintragen, **ohne** Schreibrecht.

Vor dem ersten Klonen muss der Host-Key von GitHub bekannt sein, sonst bricht `git` mit
`Host key verification failed` ab. Er gehört aus demselben Grund wie die übrigen
Zugangsdaten nach `/etc/palantir`: unter `/root/.ssh/known_hosts` wäre er für den
Update-Dienst unsichtbar, und dessen `git fetch` scheiterte später an derselben Stelle.

```bash
printf 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n' > /etc/palantir/known_hosts
```

Den Eintrag gegen den von GitHub veröffentlichten Fingerabdruck prüfen – blindes
Bestätigen der Rückfrage ist genau die Lücke, die der Host-Key schließen soll. Erwartet
wird `SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU`, abrufbar über
`https://api.github.com/meta`:

```bash
ssh-keygen -lf /etc/palantir/known_hosts
```

```bash
GIT_SSH_COMMAND='ssh -i /etc/palantir/repo_readonly -o IdentitiesOnly=yes -o UserKnownHostsFile=/etc/palantir/known_hosts' git clone git@github.com:nightriderp/Palantir_Panel.git /opt/palantir
```

Damit der Timer denselben Schlüssel und dieselbe `known_hosts` benutzt, wird beides fest in
der Auscheckung hinterlegt – als Umgebungsvariable ginge es beim Dienststart verloren:

```bash
git -C /opt/palantir config core.sshCommand 'ssh -i /etc/palantir/repo_readonly -o IdentitiesOnly=yes -o UserKnownHostsFile=/etc/palantir/known_hosts'
```

Auscheckung auf den freigegebenen Stand setzen – dorthin zeigt auch das Image-Tag `prod`:

```bash
git -C /opt/palantir checkout --detach origin/prod
```

Datenverzeichnisse anlegen (Pfade müssen zu `AGENT_DATA_DIR` und `AGENT_BACKUP_DIR` in
der `.env` passen):

```bash
mkdir -p /srv/palantir/servers /srv/palantir/backups
```

#### Agent-Kanal auf der VPS freigeben

Der WebSocket-Kanal `/agent` läuft **nicht** über Traefik, sondern durch den
WireGuard-Tunnel (Pflichtenheft §2.2). Damit der Agent das Backend erreicht, veröffentlicht
`deploy/vps/docker-compose.yml` den Backend-Port an der Tunnel-Adresse:

```yaml
ports:
  - '${WIREGUARD_VPS_IP:-10.10.0.1}:4000:4000'
```

Die IP-Angabe davor ist kein Schönheitsfehler, sondern sicherheitsrelevant: ohne sie bindet
Docker an `0.0.0.0` und der Agent-Kanal steht im offenen Internet. Voraussetzung ist, dass
`wg-quick@wg0` **vor** Docker läuft – sonst existiert `10.10.0.1` beim Containerstart noch
nicht und die Bindung scheitert:

```bash
systemctl is-enabled wg-quick@wg0
```

Prüfen lässt sich die Freigabe **auf der VPS**:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://10.10.0.1:4000/health
```

`200` heißt: erreichbar. `000` heißt: der Port ist nicht veröffentlicht.

#### `.env` auf der Gamenode

Die `.env` liegt nie im Repository und wird **auf dem Homeserver** von Hand angelegt:
`/opt/palantir/.env` (in der Gameserver-VM). Sie braucht nicht den vollen Satz der VPS –
diese Werte genügen:

| Variable               | Wert                                         |
| ---------------------- | -------------------------------------------- |
| `NODE_ENV`             | `production`                                 |
| `LOG_LEVEL`            | `info`                                       |
| `PALANTIR_VERSION`     | `prod`                                       |
| `SOCKET_PROXY_VERSION` | derselbe Wert wie auf der VPS                |
| `AGENT_TOKEN`          | **identisch mit dem Wert in der VPS-`.env`** |
| `AGENT_BACKEND_WS_URL` | `ws://10.10.0.1:4000/agent`                  |
| `AGENT_DATA_DIR`       | `/srv/palantir/servers`                      |
| `AGENT_BACKUP_DIR`     | `/srv/palantir/backups`                      |

`AGENT_TOKEN` ist der einzige Wert, der zwischen den Maschinen wandern muss. Auslesen
**auf der VPS**:

```bash
grep '^AGENT_TOKEN=' /opt/palantir/.env
```

Stimmen die beiden Werte nicht überein, weist das Backend die Verbindung im Handshake ab
(Log: „Agent-Verbindung ohne gültiges Pre-Shared-Token abgelehnt"). Der Agent versucht es
dann in exponentiell wachsenden Abständen weiter – es sieht also nicht nach einem Fehler
aus, es passiert nur nichts.

#### Registry-Login

Das Agent-Image liegt in einem **privaten** GHCR-Repository. Ohne Anmeldung schlägt der
Pull mit `unauthorized` fehl – dieselbe Hürde wie auf der VPS. Nötig ist ein Personal
Access Token (classic) mit **`read:packages`**. Die Anmeldung muss nach `/etc/palantir/docker`
schreiben, nicht in das Standardverzeichnis unter `/root` (Begründung oben):

```bash
read -rsp 'Token: ' T; echo; echo "$T" | DOCKER_CONFIG=/etc/palantir/docker docker login ghcr.io -u nightriderp --password-stdin; unset T
```

Das `read -rsp` ist Absicht: `docker login -p` schriebe das Token in die Shell-History.

#### Stack starten

Auch von Hand gilt `DOCKER_CONFIG` – sonst sucht Docker die Anmeldung wieder unter `/root`:

```bash
export DOCKER_CONFIG=/etc/palantir/docker && cd /opt/palantir/deploy/gamenode && docker compose --env-file ../../.env up -d
```

Prüfen:

```bash
docker compose --env-file ../../.env logs -f agent
```

Erwartet wird eine Zeile über die aufgebaute Verbindung. Gegenprobe **auf der VPS**:

```bash
docker logs palantir-backend 2>&1 | grep -i 'Agent verbunden'
```

Im Panel wechselt die Node danach von `offline` auf `online`, und `last_seen_at` füllt sich.

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
ein Schlüssel, zu dem es keinen Gegenpart gibt.

3.4 setzt zweierlei voraus: den stehenden WireGuard-Tunnel und ein Deployment, das die
Portfreigabe an der Tunnel-Adresse bereits enthält. Der Agent-Stack lässt sich zwar früher
starten, findet dann aber kein Backend und wartet im Reconnect-Backoff. Der Timer selbst
ist unabhängig und läuft ins Leere, bis der Zweig `prod` das erste Mal gesetzt wird.

---

## 4. VPS-Grundinstallation

Alle Schritte in diesem Abschnitt laufen auf der **VPS** (Hetzner, öffentlich) als `root`.
Sie legen die Grundlage, auf der die Compose-Stacks aus §2 und §3 laufen.

### 4.1 Betriebssystem und Docker

Empfohlen ist ein aktuelles Debian oder Ubuntu LTS. Palantir braucht auf der VPS **nur
Docker** – weder Node noch pnpm (vgl. §2.1). Docker Engine samt Compose-Plugin über das
offizielle Repository installieren:

```bash
curl -fsSL https://get.docker.com | sh
```

Prüfen, dass das Compose-Plugin vorhanden ist – der ganze Betrieb ruft `docker compose`
(mit Leerzeichen), nicht das alte `docker-compose`:

```bash
docker compose version
```

### 4.2 Firewall

Nach außen offen sein müssen nur vier Ports. Der Backend-Port `4000` gehört **nicht** dazu:
er wird in `deploy/vps/docker-compose.yml` bewusst an die Tunnel-Adresse `10.10.0.1`
gebunden (§3.4) und ist so nur über WireGuard erreichbar. Der Datenbank-Port `5432` bindet
nur an `127.0.0.1` und darf ebenfalls nie geöffnet werden.

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 51820/udp
ufw enable
```

| Port        | Wofür                                                                 |
| ----------- | --------------------------------------------------------------------- |
| `22/tcp`    | SSH-Administration und der Deploy-Zugang (§3.2)                       |
| `80/tcp`    | HTTP – Traefik leitet auf HTTPS um und beantwortet die ACME-Challenge |
| `443/tcp`   | HTTPS – Frontend und API                                              |
| `51820/udp` | WireGuard-Tunnel zum Homeserver (§6, `WIREGUARD_LISTEN_PORT`)         |

> Steht die VPS-Web-Domain zusätzlich hinter Cloudflare (§8), kann `80/443` auf die
> Cloudflare-Adressbereiche eingegrenzt werden. Der WireGuard-Port bleibt davon unberührt.

### 4.3 Reverse Proxy und TLS

Ein Reverse Proxy wird **nicht von Hand** aufgesetzt: Der Dienst `traefik` im Compose-Stack
(`deploy/vps/docker-compose.yml`) übernimmt Terminierung, HTTP→HTTPS-Umleitung und holt die
Let's-Encrypt-Zertifikate automatisch über die HTTP-Challenge. Nötig sind dafür nur zwei
Dinge, beide bereits an anderer Stelle:

- `ACME_EMAIL` in der zentralen `.env` (Abschnitt 16 der `.env.example`) – dorthin gehen die
  Ablauf-Hinweise von Let's Encrypt.
- Die DNS-Einträge für `<PALANTIR_DOMAIN>` und `api.<PALANTIR_DOMAIN>` müssen auf die VPS
  zeigen (§8), sonst schlägt die ACME-Challenge fehl.

Traefik spricht die Docker-API nie direkt an, sondern über den mitgelieferten
`socket-proxy` (Pflichtenheft §2.3). Es ist also kein manueller Eingriff am Docker-Socket
nötig.

---

## 5. OAuth-Apps anlegen

Palantir kennt kein eigenes Passwort-Login über Drittanbieter, sondern meldet Nutzer über
**Discord, Twitch und Steam** an ([PFLICHTENHEFT.md §7](PFLICHTENHEFT.md)). Mindestens **ein**
Provider muss konfiguriert sein – `scripts/setup.sh` bricht sonst mit einem Pflichtfeld-Fehler
ab. Die Werte werden in der zentralen `.env` auf der **VPS** (`/opt/palantir/.env`)
eingetragen; die Redirect-URIs unten müssen **exakt** so auch in der jeweiligen
Entwickler-Konsole stehen.

Alle Redirect-URIs werden im Backend aus `PUBLIC_API_URL` abgeleitet
(`apps/backend/src/config/env.ts`). Steht dort nichts, gilt `https://api.<PALANTIR_DOMAIN>`.
Die abgeleiteten Werte:

| Provider | `.env`-Variable        | Redirect-/Return-URL (`<domain>` = `PALANTIR_DOMAIN`) |
| -------- | ---------------------- | ----------------------------------------------------- |
| Discord  | `DISCORD_REDIRECT_URI` | `https://api.<domain>/auth/discord/callback`          |
| Twitch   | `TWITCH_REDIRECT_URI`  | `https://api.<domain>/auth/twitch/callback`           |
| Steam    | `STEAM_RETURN_URL`     | `https://api.<domain>/auth/steam/callback`            |

> Die URIs sind **nicht frei wählbar** – sie zeigen auf die feste Route
> `/auth/:provider/callback` des Backends. Ein Tippfehler äußert sich als
> `redirect_uri_mismatch` (Discord/Twitch) bzw. als stumme Zurückweisung (Steam).

### 5.1 Discord

1. <https://discord.com/developers/applications> → **New Application**.
2. Reiter **OAuth2** → **Redirects** → die Discord-URL aus der Tabelle eintragen.
3. **Client ID** und ein neu erzeugtes **Client Secret** in die `.env` übernehmen:
   `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`.

Es werden nur die minimalen Scopes `identify` (und, falls gewünscht, `email`) angefragt –
mehr braucht Palantir nicht.

### 5.2 Twitch

1. <https://dev.twitch.tv/console/apps> → **Register Your Application**.
2. **OAuth Redirect URLs**: die Twitch-URL aus der Tabelle eintragen.
3. **Client-ID** und ein erzeugtes **Client-Secret** in die `.env`:
   `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_REDIRECT_URI`.

### 5.3 Steam

Steam nutzt **OpenID 2.0** und hat kein Client-Secret – nur einen Web-API-Key:

1. <https://steamcommunity.com/dev/apikey> → Key auf die eigene Domain registrieren.
2. `STEAM_API_KEY` und `STEAM_RETURN_URL` (Steam-URL aus der Tabelle) in die `.env`.

Der Domainname bei der Key-Registrierung sollte `PALANTIR_DOMAIN` entsprechen; Steam bindet
den Key an diese Domain.

---

## 6. WireGuard-Tunnel (VPS ↔ Homeserver)

Der Tunnel ist das einzige Netz zwischen den beiden Maschinen
([PFLICHTENHEFT.md §2.1](PFLICHTENHEFT.md)). Über ihn läuft der Agent-Kanal
(`ws://10.10.0.1:4000/agent`); nach außen ist auf dem Homeserver **kein** Port offen.

**Feste Adressen:** VPS `10.10.0.1`, Homeserver `10.10.0.2` (aus der `.env`:
`WIREGUARD_VPS_IP`, `WIREGUARD_HOME_IP`).

### 6.1 Schlüssel

`scripts/setup.sh` erzeugt auf jeder Maschine ein Schlüsselpaar und trägt es in die `.env`
ein (`WIREGUARD_*_PRIVATE_KEY` / `WIREGUARD_*_PUBLIC_KEY`). Der **private** Schlüssel bleibt
auf seiner Maschine; die beiden **öffentlichen** Schlüssel müssen über Kreuz getauscht
werden – der VPS-Public-Key gehört in die Homeserver-`.env` und umgekehrt. Auslesen z. B.:

```bash
grep '^WIREGUARD_VPS_PUBLIC_KEY=' /opt/palantir/.env
```

### 6.2 `wg0.conf` auf der VPS

Zielort: **`/etc/wireguard/wg0.conf` auf der VPS**. Die `<Platzhalter>` durch die Werte aus
der `.env` ersetzen:

```ini
[Interface]
Address = 10.10.0.1/24
ListenPort = 51820
PrivateKey = <WIREGUARD_VPS_PRIVATE_KEY>

[Peer]
# Homeserver
PublicKey = <WIREGUARD_HOME_PUBLIC_KEY>
AllowedIPs = 10.10.0.2/32
```

Die VPS kennt keinen `Endpoint` des Homeservers – der sitzt hinter NAT und meldet sich
selbst. `AllowedIPs = 10.10.0.2/32` begrenzt den Tunnel bewusst auf die eine Gegenstelle.

### 6.3 `wg0.conf` auf dem Homeserver

Zielort: **`/etc/wireguard/wg0.conf` in der Gameserver-VM**. `<VPS_PUBLIC_IP>` ist die
öffentliche IPv4 der VPS (`.env`: `VPS_PUBLIC_IP`):

```ini
[Interface]
Address = 10.10.0.2/24
PrivateKey = <WIREGUARD_HOME_PRIVATE_KEY>
# Eingehenden Tunnelverkehr blockieren – Pflicht, siehe unten und
# deploy/gamenode/wireguard-firewall.md
PostUp = nft add table inet palantir_wg; nft add chain inet palantir_wg input '{ type filter hook input priority 0; policy accept; }'; nft add rule inet palantir_wg input iifname "wg0" ct state established,related accept; nft add rule inet palantir_wg input iifname "wg0" drop
PostDown = nft delete table inet palantir_wg

[Peer]
# VPS
PublicKey = <WIREGUARD_VPS_PUBLIC_KEY>
Endpoint = <VPS_PUBLIC_IP>:51820
AllowedIPs = 10.10.0.1/32
PersistentKeepalive = 25
```

- **`PersistentKeepalive = 25`** hält das NAT-Mapping am Heimrouter offen (`.env`:
  `WIREGUARD_KEEPALIVE`) – ohne das fiele der Tunnel bei Inaktivität aus.
- **`PostUp`/`PostDown`** sind auf dem Homeserver **nicht optional**: Sie verwerfen jeden
  neu eingehenden Verkehr auf `wg0` – auch SSH-Port 22 – und lassen nur den Rückverkehr der
  vom Agent ausgehend aufgebauten Verbindung zu. Ohne diese Regel steht SSH aus dem Tunnel
  offen (Zustand aus Gefundenem Punkt 85), was [PFLICHTENHEFT.md §1](PFLICHTENHEFT.md)
  ausdrücklich verbietet. Begründung, Prüfbefehle, die `ufw`-Variante und der einzig
  zulässige Ausnahmeweg für Fernwartung stehen in
  [`deploy/gamenode/wireguard-firewall.md`](deploy/gamenode/wireguard-firewall.md).

### 6.4 Tunnel starten

Auf **beiden** Maschinen, so aktiviert, dass er beim Systemstart und **vor** Docker läuft
(sonst existiert `10.10.0.1` beim Containerstart der VPS noch nicht, siehe §3.4):

```bash
systemctl enable --now wg-quick@wg0
```

Gegenprobe auf der **VPS** – der Homeserver muss über den Tunnel antworten:

```bash
ping -c 3 10.10.0.2
```

---

## 7. Homeserver-VM vorbereiten

Zielmaschine: die **Gameserver-VM** (unter Proxmox). Sie trägt den Agent, den
Docker-Socket-Proxy und die Gameserver-Container.

**Grundsatz:** Diese Maschine nimmt **keine** eingehenden Verbindungen an – weder vom Router
noch aus dem Tunnel (§6.3). Es wird kein Port weitergeleitet und in
`deploy/gamenode/docker-compose.yml` bewusst kein `ports:` gesetzt.

### 7.1 Docker

Wie auf der VPS (§4.1) genügt Docker mit Compose-Plugin; Node/pnpm sind nicht nötig.

```bash
curl -fsSL https://get.docker.com | sh
```

Der **Docker-Socket-Proxy** wird nicht separat installiert – er ist der Dienst
`socket-proxy` im Gamenode-Stack. Der Agent spricht ausschließlich über ihn mit Docker
(Pflichtenheft §2.3), nie direkt mit dem Socket.

### 7.2 Datenverzeichnisse

Server-Daten und Backups liegen auf dem Host, damit sie einen Neustart des Agents
überdauern. Die Pfade müssen zu `AGENT_DATA_DIR` und `AGENT_BACKUP_DIR` in der `.env`
passen:

```bash
mkdir -p /srv/palantir/servers /srv/palantir/backups
```

### 7.3 Restliche Einrichtung

Deploy-Key, GitHub-Host-Key, die knappe Homeserver-`.env`, der Registry-Login und der Start
des Gamenode-Stacks samt Update-Timer stehen bereits ausführlich in **§3.4 (Gamenode
vorbereiten)**. Voraussetzung dort: der stehende WireGuard-Tunnel aus §6 und ein Deployment,
das die Portfreigabe an der Tunnel-Adresse enthält.

---

## 8. DNS / Cloudflare

Palantir legt DNS-Einträge für neue Gameserver-Subdomains **automatisch** über die
Cloudflare-API an ([PFLICHTENHEFT.md §13](PFLICHTENHEFT.md)). Einzurichten sind einmalig die
Zone, das API-Token und die festen Einträge.

### 8.1 Feste Einträge

In der Cloudflare-Zone von `PALANTIR_DOMAIN` anlegen (Ziel ist jeweils `VPS_PUBLIC_IP`):

| Typ | Name             | Ziel            | Proxy-Status                                |
| --- | ---------------- | --------------- | ------------------------------------------- |
| `A` | `@` (Web-Domain) | `VPS_PUBLIC_IP` | „Proxied" möglich (CDN/WAF) oder „DNS only" |
| `A` | `api`            | `VPS_PUBLIC_IP` | wie Web-Domain                              |
| `A` | `*` (Wildcard)   | `VPS_PUBLIC_IP` | **„DNS only"** (grau)                       |

> **„DNS only" für die Spiele-Subdomains ist Pflicht.** Cloudflares Standardprodukt proxied
> nur HTTP(S), kein rohes TCP/UDP-Spieleprotokoll – eine „proxied" Spiele-Subdomain wäre für
> den Spieler nicht erreichbar ([PFLICHTENHEFT.md §13](PFLICHTENHEFT.md)). Die Web-Domain und
> `api` dürfen hinter dem Proxy laufen; dann `TRUSTED_PROXY_HOPS` in der `.env` passend
> setzen und die Firewall (§4.2) auf die Cloudflare-Bereiche eingrenzen.

Bei Minecraft (Hostname-Routing über den Infrared-Proxy) setzt das Backend statt eines
`A`-Eintrags einen `CNAME` auf `GAME_ROUTER_HOSTNAME` – dieser Eintrag entsteht ebenfalls
automatisch und muss nicht von Hand angelegt werden.

### 8.2 API-Token

Unter <https://dash.cloudflare.com/profile/api-tokens> ein Token mit **ausschließlich**
DNS-Bearbeitungsrecht für genau diese Zone erzeugen (Vorlage „Edit zone DNS"). Werte in die
zentrale `.env` auf der **VPS**:

```
CLOUDFLARE_API_TOKEN=<Token>
CLOUDFLARE_ZONE_ID=<Zone-ID aus der Zonen-Übersicht>
```

Kein Token mit umfassenderen Rechten verwenden – das Backend braucht nur DNS-Schreibrecht,
und ein weitergehendes Token wäre bei einem Leck ein Vollzugriff auf das Cloudflare-Konto.
