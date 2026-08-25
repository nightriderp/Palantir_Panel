# Palantir

Selbst betriebene Webapplikation, mit der ein fester Kreis von Freunden eigenständig
Gameserver auf einem privaten Homeserver erstellen, starten, stoppen und verwalten kann –
per Knopfdruck, ohne technisches Vorwissen und ohne kommerziellen Hosting-Anbieter.

**Stand:** Grundgerüst (Phase 1, noch keine Feature-Logik).

---

## Verbindliche Dokumente

Diese vier Dokumente sind die Quelle der Wahrheit für das Projekt. Vor jeder Änderung lesen:

| Dokument                             | Inhalt                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------ |
| [LASTENHEFT.md](LASTENHEFT.md)       | Fachliche Anforderungen aus Sicht des Auftraggebers                      |
| [PFLICHTENHEFT.md](PFLICHTENHEFT.md) | Technisches Umsetzungskonzept (Architektur, Datenmodell, Security)       |
| [STRUKTUR.md](STRUKTUR.md)           | Aufteilung in parallel bearbeitbare Arbeitspakete (B1–B8, A1–A3, F1–F11) |
| [CLAUDE.md](CLAUDE.md)               | Verhaltensregeln für jede Entwicklungs-Sitzung                           |

Ergänzend:

- [WORK_STATUS.md](WORK_STATUS.md) – laufend aktueller Stand aller Arbeitspakete
- [SITZUNGS_PROMPTS.md](SITZUNGS_PROMPTS.md) – fertige Start-Prompts für parallele Sitzungen

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
Verbindung zur VPS aktiv auf – dadurch ist keine Portfreigabe am Heimrouter nötig.
Details: [PFLICHTENHEFT.md §1–§2](PFLICHTENHEFT.md).

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
/scripts
  setup.sh       Setup-Wizard (Secrets, WireGuard-Keys, Pflichtfeld-Check)
```

`packages/contracts` und `packages/validation` sind die einzige Schnittstelle zwischen den
Komponenten. Änderungen daran laufen immer über einen eigenen, kleinen PR
([CLAUDE.md §3 und §6](CLAUDE.md)).

### Technologie-Entscheidungen des Grundgerüsts

| Bereich           | Wahl                                  | Begründung                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend-Framework | **Fastify**                           | Das Pflichtenheft lässt Fastify oder NestJS offen. Fastify gewählt, weil Palantir viele Live-Kanäle über WebSockets fährt (Konsole, Stats, Chat, Agent-Protokoll) und Fastify das ohne DI-/Decorator-Schicht direkt abbildet. Der Response-Envelope und das `permissions`-Objekt sind ohnehin eigene Konventionen aus dem Pflichtenheft – NestJS' Struktur-Vorgaben würden hier wenig beitragen und die parallele Arbeit an acht Backend-Paketen eher schwerer machen. |
| Paketmanager      | pnpm Workspaces                       | Vorgabe Pflichtenheft §3                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Task-Runner       | Turborepo                             | Vorgabe Pflichtenheft §3                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| TypeScript        | `strict` + `noUncheckedIndexedAccess` | Vorgabe CLAUDE.md §4                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

---

## Voraussetzungen

- Node.js ≥ 20.11
- pnpm 9
- Docker / Docker Compose (für Datenbank und spätere Gameserver-Container)

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

> **Konfiguration:** Es gibt genau eine `.env` im Repo-Root
> ([PFLICHTENHEFT.md §12.1](PFLICHTENHEFT.md)). Sie liegt im Betrieb unter
> `/opt/palantir/.env` – sowohl auf der VPS als auch auf dem Homeserver – und muss dort mit
> `chmod 600` geschützt werden. Jede neue Variable gehört zwingend mit Kommentar in
> `.env.example`.

### Verfügbare Skripte im Repo-Root

| Befehl           | Wirkung                                            |
| ---------------- | -------------------------------------------------- |
| `pnpm build`     | Baut alle Workspaces (Turborepo)                   |
| `pnpm dev`       | Startet Backend, Frontend und Agent im Watch-Modus |
| `pnpm lint`      | ESLint über alle Workspaces                        |
| `pnpm test`      | Vitest über alle Workspaces                        |
| `pnpm typecheck` | TypeScript-Prüfung ohne Emit                       |
| `pnpm format`    | Prettier über das gesamte Repository               |

---

## Mitarbeit / parallele Entwicklung

Es arbeiten mehrere Sitzungen gleichzeitig an unterschiedlichen Arbeitspaketen.
Verbindlich dafür:

1. Vor Arbeitsbeginn [WORK_STATUS.md](WORK_STATUS.md) lesen und die eigene Zeile auf
   „in Bearbeitung" setzen.
2. Ein Branch pro Arbeitspaket, niemals direkt auf `main` – Zusammenführung nur über
   Pull Request.
3. Commit-Präfix mit dem Arbeitspaket-Kürzel, z. B. `[auth] Argon2id-Hashing implementiert`.
4. Alles Weitere in [CLAUDE.md](CLAUDE.md).

Fertige Start-Prompts für alle 22 Arbeitspakete liegen in
[SITZUNGS_PROMPTS.md](SITZUNGS_PROMPTS.md).

---

## Ausstehend

- `SETUP.md` – Schritt-für-Schritt-Anleitung für VPS, Homeserver, OAuth-Apps und WireGuard
  ([PFLICHTENHEFT.md §12.3](PFLICHTENHEFT.md))
- `docker-compose.yml` für VPS- und Homeserver-Seite
- Datenbank-Schema und Migrationen (Drizzle Kit)
- Inhalte von `packages/contracts` und `packages/validation`
