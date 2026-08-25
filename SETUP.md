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

**Postgres-Superuser-Passwort unbekannt?** Dann hilft nur die offizielle
Wiederherstellungsprozedur: Authentifizierungsmethode in `pg_hba.conf` vorübergehend auf
`trust` setzen, Dienst neu starten, Passwort per `ALTER ROLE postgres PASSWORD '...'`
setzen, `pg_hba.conf` **sofort** wieder auf `scram-sha-256` zurückstellen und erneut neu
starten. Während dieses Fensters kann sich jeder lokale Prozess ohne Passwort verbinden –
deshalb nur auf einem Entwicklungsrechner, nie auf der VPS, und die Datei danach
zuverlässig zurücksetzen (vorher kopieren).

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
