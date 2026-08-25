# Struktur – Arbeitspakete für parallele Entwicklung (Palantir)

Dieses Dokument teilt Palantir in unabhängig bearbeitbare Arbeitspakete auf, damit mehrere Entwicklungs-Sitzungen gleichzeitig arbeiten können, ohne sich gegenseitig in denselben Dateien zu stören. Verhaltensregeln für die Zusammenarbeit stehen in `CLAUDE.md`, fachliche/technische Details in `LASTENHEFT.md` und `PFLICHTENHEFT.md`.

---

## Monorepo-Grundstruktur

```
/apps
  /backend       Node/TS API
  /frontend      Next.js
  /agent         Homeserver-Agent
/packages
  /contracts     Einzige Quelle der Wahrheit für alle Datenstrukturen
  /validation    Zod-Schemas, gemeinsam von Backend & Frontend genutzt
```

`packages/contracts` und `packages/validation` gehören keinem einzelnen Arbeitspaket – Änderungen daran laufen immer über einen eigenen, kleinen PR (siehe `CLAUDE.md` Abschnitt 6).

---

## Backend – 8 Arbeitspakete

| # | Arbeitspaket | Inhalt | Vorgeschlagener Pfad |
|---|---|---|---|
| B1 | Auth & Identity | Login (Passwort + OAuth), Account-Linking, Sessions, 2FA, ALTCHA | `apps/backend/src/modules/auth` |
| B2 | RBAC / Permissions | Rollen, Permission-Katalog, Middleware, Owner-Flag | `apps/backend/src/modules/rbac` |
| B3 | Server-Orchestrierung | State Machine, Lifecycle-Befehle, Kommunikation mit dem Agent | `apps/backend/src/modules/server-orchestration` |
| B4 | Ressourcen & Kapazität | Nutzer-Kontingente, globale Kapazitätsprüfung | `apps/backend/src/modules/resources` |
| B5 | Backup-Verwaltung | Manuelle/geplante Backups, Retention, Restore | `apps/backend/src/modules/backups` |
| B6 | Notification-Engine | Event-System, Channels, Regeln, Discord-Webhook | `apps/backend/src/modules/notifications` |
| B7 | Chat & Moderation | DMs, Server-Chat, Melde-/Moderationssystem | `apps/backend/src/modules/chat` |
| B8 | Admin-Funktionen | Nodes, Adressen/Port-Pool, Audit-Log, Storage-Explorer-API | `apps/backend/src/modules/admin` |

---

## Agent – 3 Arbeitspakete

| # | Arbeitspaket | Inhalt | Vorgeschlagener Pfad |
|---|---|---|---|
| A1 | Core-Verbindung | WebSocket-Verbindung zum Backend, Reconnect-/Backoff-Logik, Korrelations-IDs | `apps/agent/src/connection` |
| A2 | Container-Runtime | `ContainerRuntime`-Interface + Docker-Implementierung (über Docker-Socket-Proxy) | `apps/agent/src/runtime` |
| A3 | Jobs & Scheduler | Storage-Scanner, Backup-Job, Health-Check, Auto-Shutdown/Auto-Restart | `apps/agent/src/jobs` |

---

## Frontend – 11 Arbeitspakete

Geschnitten anhand des bereits vorliegenden Mockups. Alle Seiten werden gebaut; Inhalte, die erst in Phase 2/3 fachlich existieren (Skins, Templates, Bilder, Sticker, Arcade-Musik), bekommen einen einheitlichen "Kommt später"-Zustand über die gemeinsame `PhaseLockedPlaceholder`-Komponente aus F2.

| # | Arbeitspaket | Inhalt | Vorgeschlagener Pfad |
|---|---|---|---|
| F1 | Auth & Onboarding | Login, Register, 2FA, Gast-Wartebildschirm | `apps/frontend/src/app/(auth)` |
| F2 | Shared UI / Design-System | `ServerCard`, gemeinsame Modals, Icons, Toasts, `PhaseLockedPlaceholder`, Styles/Tokens – **Priorität, da Grundlage für F3–F11** | `apps/frontend/src/components/shared` |
| F3 | Server-Übersicht & Lifecycle | Übersicht/Serverliste, Server-erstellen-Wizard, Server-Detail (Tabs: Übersicht, Konsole, Dateien, Backups, Aufgaben, Einstellungen) | `apps/frontend/src/app/(dashboard)/servers` |
| F4 | Meine Backups | Globale eigene Backup-Ansicht | `apps/frontend/src/app/(dashboard)/my-backups` |
| F5 | Nachrichten/Chat | DMs, Server-Chat, Melde-Funktion | `apps/frontend/src/app/(dashboard)/messages` |
| F6 | Benachrichtigungen | Inbox-Tab + Einstellungs-Tab | `apps/frontend/src/app/(dashboard)/notifications` |
| F7 | Nodes (Nutzeransicht) | Node-Status, Einrichtungshinweise | `apps/frontend/src/app/(dashboard)/nodes` |
| F8 | Arcade | Minispiele + Bestenliste (echte Umsetzung, kein Platzhalter) | `apps/frontend/src/app/(dashboard)/arcade` |
| F9 | Skins | Platzhalter jetzt, echte Umsetzung Phase 2 | `apps/frontend/src/app/(dashboard)/skins` |
| F10 | Admin-Kernbereich | Nutzer, Rollen, Anfragen, Audit-Log, Backups (global), Node-Platz/Storage-Explorer, Adressen, Benachrichtigungs-Regeln | `apps/frontend/src/app/admin/(core)` |
| F11 | Admin-Spiele-Verwaltung | Templates, Bilder, Sticker, Arcade-Musik – alle als Platzhalter | `apps/frontend/src/app/admin/(games)` |

---

## Abhängigkeiten zwischen den Arbeitspaketen

- **F2 (Shared UI)** wird von praktisch allen anderen Frontend-Paketen benötigt – möglichst zuerst oder mit hoher Priorität parallel bearbeiten.
- **B2 (RBAC)** liefert das `permissions`-Objekt, das in fast jedem DTO steckt – andere Backend-Pakete sollten sich früh daran orientieren, auch wenn die volle Rollen-UI erst über F10 entsteht.
- **B3 (Server-Orchestrierung)** und **A2 (Container-Runtime)** sind eng gekoppelt (Backend-Befehle ↔ Agent-Ausführung) – Schnittstelle darüber läuft ausschließlich über `packages/contracts`, nicht über Absprachen am Code vorbei.
- **F9 und F11** (Platzhalter-Seiten) hängen von **F2** ab (`PhaseLockedPlaceholder`-Komponente), sind ansonsten aber von den zugehörigen Backend-Funktionen (die es in Phase 1 noch nicht gibt) unabhängig.
