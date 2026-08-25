# SETUP – Palantir einrichten

> **Status:** unvollständig. Vollständig ausgearbeitet ist bisher nur der Abschnitt
> **Datenbank**. Die übrigen Abschnitte sind laut
> [PFLICHTENHEFT.md §12.3](PFLICHTENHEFT.md) noch zu ergänzen und unten als offen
> markiert (siehe „Gefundene Punkte" Nr. 2 in [WORK_STATUS.md](WORK_STATUS.md)).

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

**Wichtig:**

- Der Datenbank-Port wird **nicht** nach außen veröffentlicht. Die Datenbank ist nur im
  Docker-Netz erreichbar – deshalb `@db:5432` in der `DATABASE_URL` und nicht `127.0.0.1`.
- Das Passwort wird nur aus der `.env` gelesen, steht nie in einem Kommando und nie in der
  Shell-History.
- Schema-Änderungen laufen ausschließlich über Migrationen, nie manuell an der laufenden
  Datenbank ([CLAUDE.md §4](CLAUDE.md)).

> `docker-compose.yml` existiert noch nicht – siehe offene Punkte unten.

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
> des Rollensystems und kommt aus der Ersteinrichtung des Kontos (siehe offene Punkte).

---

## 3. Noch zu ergänzen

Diese Abschnitte fordert [PFLICHTENHEFT.md §12.3](PFLICHTENHEFT.md), sie sind noch nicht
geschrieben:

- **VPS vorbereiten** – Grundinstallation, Reverse Proxy (Caddy oder Traefik) mit
  automatischem TLS, Firewall
- **OAuth-Apps anlegen** – Discord, Twitch, Steam inkl. Redirect-URIs passend zur Domain
- **WireGuard einrichten** – fertige `wg0.conf` für VPS (`/etc/wireguard/wg0.conf`) und
  Homeserver (`/etc/wireguard/wg0.conf` in der Gameserver-VM), Keepalive, AllowedIPs
- **Homeserver-VM vorbereiten** – Docker, Docker-Socket-Proxy, Datenverzeichnisse
- **`docker compose up`** auf beiden Seiten
- **Ersteinrichtung des Owner-Accounts**
- **DNS/Cloudflare** – Zone, API-Token mit ausschließlich DNS-Bearbeitungsrecht,
  „DNS only" für Spiele-Subdomains
