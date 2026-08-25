# WORK_STATUS – laufender Stand aller Arbeitspakete

Diese Datei ist der **laufend aktuelle** Stand aller Arbeitspakete aus [STRUKTUR.md](STRUKTUR.md)
– keine reine Start-Markierung (siehe [CLAUDE.md §6](CLAUDE.md)).

**Regeln für jede Sitzung:**

1. **Vor Arbeitsbeginn hier nachsehen**, ob das Paket schon in Bearbeitung ist.
2. Eigene Zeile bei Start auf `in Bearbeitung` setzen, Branch eintragen, Datum aktualisieren.
3. Bei jedem nennenswerten Fortschritt oder Blocker die Zeile aktualisieren.
4. Bei Abschluss auf `fertig` setzen.
5. Auffälligkeiten außerhalb des eigenen Pakets unter **Gefundene Punkte** eintragen –
   nicht ungefragt nebenbei miterledigen.

**Status-Werte:** `offen` · `in Bearbeitung` · `blockiert` · `fertig`

**Branch-Schema:** `<kürzel-klein>/<kurzname>`, z. B. `b1/auth`, `f2/shared-ui`, `a2/container-runtime`.
Commit-Präfix ist das Arbeitspaket in eckigen Klammern, z. B. `[auth] Argon2id-Hashing implementiert`.

---

## Grundgerüst

| Arbeitspaket                                                  | Branch | Status | Zuletzt aktualisiert | Notiz                                                                                                                            |
| ------------------------------------------------------------- | ------ | ------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Grundgerüst (Monorepo, Tooling, .env.example, setup.sh, Doku) | `main` | fertig | 2026-08-25           | pnpm-Workspaces, Turborepo, Fastify-Backend, Next.js-Frontend, Agent, leere Contracts-/Validation-Packages. Keine Feature-Logik. |

---

## Backend

| Arbeitspaket                                                                 | Branch                    | Status | Zuletzt aktualisiert | Notiz                                                                |
| ---------------------------------------------------------------------------- | ------------------------- | ------ | -------------------- | -------------------------------------------------------------------- |
| B1 – Auth & Identity (`apps/backend/src/modules/auth`)                       | `b1/auth`                 | offen  | 2026-08-25           | –                                                                    |
| B2 – RBAC / Permissions (`apps/backend/src/modules/rbac`)                    | `b2/rbac`                 | offen  | 2026-08-25           | Liefert das `permissions`-Objekt für fast jedes DTO – früh beginnen. |
| B3 – Server-Orchestrierung (`apps/backend/src/modules/server-orchestration`) | `b3/server-orchestration` | offen  | 2026-08-25           | Eng gekoppelt mit A2, Schnittstelle nur über `packages/contracts`.   |
| B4 – Ressourcen & Kapazität (`apps/backend/src/modules/resources`)           | `b4/resources`            | offen  | 2026-08-25           | –                                                                    |
| B5 – Backup-Verwaltung (`apps/backend/src/modules/backups`)                  | `b5/backups`              | offen  | 2026-08-25           | –                                                                    |
| B6 – Notification-Engine (`apps/backend/src/modules/notifications`)          | `b6/notifications`        | offen  | 2026-08-25           | –                                                                    |
| B7 – Chat & Moderation (`apps/backend/src/modules/chat`)                     | `b7/chat`                 | offen  | 2026-08-25           | –                                                                    |
| B8 – Admin-Funktionen (`apps/backend/src/modules/admin`)                     | `b8/admin`                | offen  | 2026-08-25           | –                                                                    |

---

## Agent

| Arbeitspaket                                       | Branch                 | Status | Zuletzt aktualisiert | Notiz                   |
| -------------------------------------------------- | ---------------------- | ------ | -------------------- | ----------------------- |
| A1 – Core-Verbindung (`apps/agent/src/connection`) | `a1/connection`        | offen  | 2026-08-25           | –                       |
| A2 – Container-Runtime (`apps/agent/src/runtime`)  | `a2/container-runtime` | offen  | 2026-08-25           | Eng gekoppelt mit B3.   |
| A3 – Jobs & Scheduler (`apps/agent/src/jobs`)      | `a3/jobs`              | offen  | 2026-08-25           | Setzt A1 und A2 voraus. |

---

## Frontend

| Arbeitspaket                                                                    | Branch               | Status | Zuletzt aktualisiert | Notiz                                                   |
| ------------------------------------------------------------------------------- | -------------------- | ------ | -------------------- | ------------------------------------------------------- |
| F1 – Auth & Onboarding (`apps/frontend/src/app/(auth)`)                         | `f1/auth-onboarding` | offen  | 2026-08-25           | –                                                       |
| F2 – Shared UI / Design-System (`apps/frontend/src/components/shared`)          | `f2/shared-ui`       | offen  | 2026-08-25           | **Priorität** – Grundlage für F3–F11.                   |
| F3 – Server-Übersicht & Lifecycle (`apps/frontend/src/app/(dashboard)/servers`) | `f3/servers`         | offen  | 2026-08-25           | –                                                       |
| F4 – Meine Backups (`apps/frontend/src/app/(dashboard)/my-backups`)             | `f4/my-backups`      | offen  | 2026-08-25           | –                                                       |
| F5 – Nachrichten/Chat (`apps/frontend/src/app/(dashboard)/messages`)            | `f5/messages`        | offen  | 2026-08-25           | –                                                       |
| F6 – Benachrichtigungen (`apps/frontend/src/app/(dashboard)/notifications`)     | `f6/notifications`   | offen  | 2026-08-25           | –                                                       |
| F7 – Nodes (Nutzeransicht) (`apps/frontend/src/app/(dashboard)/nodes`)          | `f7/nodes`           | offen  | 2026-08-25           | –                                                       |
| F8 – Arcade (`apps/frontend/src/app/(dashboard)/arcade`)                        | `f8/arcade`          | offen  | 2026-08-25           | Echte Umsetzung, kein Platzhalter.                      |
| F9 – Skins (`apps/frontend/src/app/(dashboard)/skins`)                          | `f9/skins`           | offen  | 2026-08-25           | Platzhalter über `PhaseLockedPlaceholder` aus F2.       |
| F10 – Admin-Kernbereich (`apps/frontend/src/app/admin/(core)`)                  | `f10/admin-core`     | offen  | 2026-08-25           | –                                                       |
| F11 – Admin-Spiele-Verwaltung (`apps/frontend/src/app/admin/(games)`)           | `f11/admin-games`    | offen  | 2026-08-25           | Alles Platzhalter über `PhaseLockedPlaceholder` aus F2. |

---

## Gefundene Punkte

Fortlaufende Liste für Dinge, die während der Arbeit auffallen, aber **nicht** Teil der
aktuellen Aufgabe sind und andere Arbeitspakete/Sitzungen betreffen
([CLAUDE.md §6](CLAUDE.md)). Neue Einträge unten anhängen, nichts löschen – erledigte
Punkte auf `erledigt` setzen.

| #   | Betroffenes Arbeitspaket | Fundstelle                          | Beschreibung                                                                                                                                                                                                                        | Status |
| --- | ------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | contracts                | `apps/backend/src/routes/health.ts` | Der Health-Endpunkt formt den Response-Envelope aus Pflichtenheft §5.1 aktuell lokal (inline). Sobald `@palantir/contracts` den Envelope-Typ liefert, von dort importieren.                                                         | offen  |
| 2   | Grundgerüst / Deployment | Repo-Root                           | `SETUP.md` (Pflichtenheft §12.3) und die `docker-compose.yml` für VPS- und Homeserver-Seite fehlen noch.                                                                                                                            | offen  |
| 3   | B1 / Datenbank           | Repo-Root                           | Drizzle-ORM-Setup, Schema und Migrationsverzeichnis existieren noch nicht. Wer als Erstes eine Tabelle braucht, legt die Drizzle-Grundkonfiguration in einem eigenen kleinen PR an – nicht nebenbei im Feature-PR.                  | offen  |
| 4   | Grundgerüst              | `scripts/setup.sh`                  | Datenbank-Passwort wird noch nicht automatisch erzeugt (`POSTGRES_PASSWORD` und `DATABASE_URL` müssen konsistent geschrieben werden); ebenso fehlt die Generierung fertiger `wg0.conf`-Dateien. Beides als TODO im Skript markiert. | offen  |
| 5   | F2                       | `apps/frontend/tailwind.config.ts`  | Design-Tokens (Farben, Abstände, Typografie) sind noch leer – gehören ins Shared-UI-Paket F2.                                                                                                                                       | offen  |
