# Palantir

Selbst betriebene Webapplikation, mit der ein fester Kreis von Freunden eigenständig
Gameserver auf einem privaten Homeserver erstellen, starten, stoppen und verwalten kann –
per Knopfdruck, ohne technisches Vorwissen und ohne kommerziellen Hosting-Anbieter.

Aktiv in Entwicklung.

> **Hinweis zum Umfang dieses Repositories:** Öffentlich ist der Code. Die
> Projektunterlagen – Lastenheft, Pflichtenheft, Arbeitsaufteilung, Einrichtungsanleitung,
> Statusverfolgung und Design-Mockups – liegen bewusst nur lokal beim Team und sind hier
> nicht enthalten. Ältere Commits enthalten sie noch; die Historie wurde nicht
> umgeschrieben.

---

## Architektur (Kurzfassung)

```
                        ┌─────────────────────────────┐
                        │   VPS (Hetzner, öffentlich) │
  Nutzer ──HTTPS──────▶ │  Reverse Proxy (TLS)        │
                        │  Frontend (Next.js)         │
                        │  Backend-API (Fastify)      │
                        │  Tunnel-Gateway (WS-Server) │
  Spieler ──Game-Proto─▶│  Game-Traffic-Proxy (TCP/UDP)│
                        └───────────┬─────────────────┘
                                    │ WireGuard-Tunnel
                                    │ (vom Homeserver ausgehend aufgebaut)
                        ┌───────────▼─────────────────┐
                        │  Homeserver-VM (Proxmox)     │
                        │  Agent (Node/TS)             │
                        │  Docker-Socket-Proxy         │
                        │  Docker Engine               │
                        │   ↳ Gameserver-Container     │
                        └──────────────────────────────┘
```

Der Homeserver nimmt zu keinem Zeitpunkt eingehende Verbindungen an. Der Agent baut die
Verbindung zur VPS aktiv auf – dadurch ist keine Portfreigabe am Heimrouter nötig. Der
Agent spricht ausschließlich über einen Docker-Socket-Proxy mit der Container-Engine, nie
direkt mit dem Docker-Socket.

---

## Monorepo-Struktur

```
/apps
  /backend       Node/TS API (Fastify)
  /frontend      Next.js + React + Tailwind (Mobile-First)
  /agent         Homeserver-Agent (Node/TS)
/packages
  /contracts     Einzige Quelle der Wahrheit für alle Datenstrukturen
  /validation    Zod-Schemas, gemeinsam von Backend & Frontend genutzt
/deploy          Compose-Dateien und Update-Einheiten für VPS und Homeserver
/scripts
  setup.sh       Setup-Wizard (Secrets, WireGuard-Keys, Pflichtfeld-Check)
```

`packages/contracts` und `packages/validation` sind die einzige Schnittstelle zwischen
Backend, Frontend und Agent. Änderungen daran sind bevorzugt additiv und laufen über einen
eigenen, kleinen Pull Request.

### Technologie-Entscheidungen

| Bereich           | Wahl                                  | Begründung                                                                                                                                                                                                                                                                               |
| ----------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend-Framework | **Fastify**                           | Palantir fährt viele Live-Kanäle über WebSockets (Konsole, Stats, Chat, Agent-Protokoll); Fastify bildet das ohne DI-/Decorator-Schicht direkt ab. Response-Envelope und `permissions`-Objekt sind eigene Konventionen – die Struktur-Vorgaben von NestJS hätten hier wenig beigetragen. |
| Paketmanager      | pnpm Workspaces                       | Ein Lockfile über alle Workspaces, harte Trennung der Abhängigkeiten                                                                                                                                                                                                                     |
| Task-Runner       | Turborepo                             | Abhängigkeitsgraph zwischen den Workspaces, Caching in CI und lokal                                                                                                                                                                                                                      |
| Datenbank         | PostgreSQL + Drizzle ORM              | Schema-Änderungen ausschließlich über generierte Migrationen                                                                                                                                                                                                                             |
| TypeScript        | `strict` + `noUncheckedIndexedAccess` | Verbindlich in allen Workspaces                                                                                                                                                                                                                                                          |

---

## Voraussetzungen

- Node.js ≥ 20.11
- pnpm 9
- Docker / Docker Compose (für Datenbank und Gameserver-Container)

---

## Quick-Start (Entwicklung)

```bash
pnpm install
cp .env.example .env      # oder: ./scripts/setup.sh
pnpm build
pnpm test
pnpm dev
```

- Frontend: http://localhost:3000
- Backend-Health: http://localhost:4000/health

> **Konfiguration:** Es gibt genau eine `.env` im Repo-Root. Im Betrieb liegt sie unter
> `/opt/palantir/.env` – sowohl auf der VPS als auch auf dem Homeserver – und muss dort mit
> `chmod 600` geschützt werden. Jede Variable ist in `.env.example` mit Kommentar
> beschrieben; das ist zugleich die vollständige Liste dessen, was Palantir kennt.

### Verfügbare Skripte im Repo-Root

| Befehl           | Wirkung                                            |
| ---------------- | -------------------------------------------------- |
| `pnpm build`     | Baut alle Workspaces (Turborepo)                   |
| `pnpm dev`       | Startet Backend, Frontend und Agent im Watch-Modus |
| `pnpm lint`      | ESLint über alle Workspaces                        |
| `pnpm test`      | Vitest über alle Workspaces                        |
| `pnpm typecheck` | TypeScript-Prüfung ohne Emit                       |
| `pnpm format`    | Prettier über das gesamte Repository               |

Datenbank-Migrationen liegen unter `apps/backend/drizzle` und werden mit
`pnpm --filter @palantir/backend db:generate` erzeugt – niemals von Hand geschrieben.

---

## Mitarbeit

Ein Branch pro Änderung, niemals direkt auf `main` – Zusammenführung ausschließlich über
Pull Request mit grüner CI (Build, Typecheck, Lint, Tests, Prettier). Commits tragen ein
Präfix mit dem Bereich, z. B. `[auth] Argon2id-Hashing implementiert`.
