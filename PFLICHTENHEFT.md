# Pflichtenheft – Palantir

**Version:** 1.0
**Dokumenttyp:** Pflichtenheft (technisches Umsetzungskonzept zum Lastenheft)
**Bezug:** LASTENHEFT.md

---

## 1. Architekturüberblick

```
                        ┌─────────────────────────────┐
                        │   VPS (Hetzner, öffentlich) │
                        │                             │
  Nutzer ──HTTPS──────▶ │  Reverse Proxy (TLS)        │
                        │  Frontend (Next.js)         │
                        │  Backend-API (Node/TS)      │
                        │  Tunnel-Gateway (WS-Server) │
  Spieler ──Game-Proto─▶│  Game-Traffic-Proxy (TCP/UDP)│
                        └───────────┬─────────────────┘
                                    │ WireGuard-Tunnel
                                    │ (vom Homeserver ausgehend aufgebaut)
                        ┌───────────▼─────────────────┐
                        │  Homeserver-VM (Proxmox)     │
                        │  Ryzen 7 5800X / 32GB / 2TB  │
                        │                             │
                        │  Agent (Node/TS)            │
                        │   ↳ verbindet nur ausgehend │
                        │  Docker-Socket-Proxy         │
                        │  Docker Engine               │
                        │   ↳ Gameserver-Container      │
                        └───────────────────────────────┘
```

**Grundprinzip:** Der Homeserver nimmt zu keinem Zeitpunkt eingehende Verbindungen an – weder vom Router noch innerhalb des Tunnels. Der Agent baut die Verbindung zur VPS aktiv auf und hält sie über einen persistenten WebSocket-Kanal (durch den WireGuard-Tunnel) offen. Dadurch entfällt jede Notwendigkeit für Portfreigaben am Heimrouter, und ein Angriff auf die VPS verschafft keinen direkten Zugriff auf das Heimnetz.

---

## 2. Netzwerk- & Security-Architektur im Detail

### 2.1 WireGuard-Tunnel
- Feste interne Adressen (z. B. VPS `10.10.0.1`, Homeserver `10.10.0.2`)
- Keepalive-Intervall gesetzt, damit NAT-Mapping am Heimrouter nicht wegen Inaktivität verfällt
- Schlüsselpaare werden beim Setup automatisiert generiert (siehe Abschnitt 12)

### 2.2 Agent ↔ Backend
- Persistente, vom Agent ausgehend initiierte WebSocket-Verbindung über den Tunnel
- Zusätzliche Authentifizierung des Agents gegenüber dem Backend per Pre-Shared-Token (Schicht zusätzlich zur WireGuard-Verschlüsselung – Defense in Depth)
- **Reconnect-Strategie:** exponentielles Backoff bei Verbindungsabbruch; nach Wiederverbindung meldet der Agent den vollständigen Ist-Zustand aller ihm bekannten Container, das Backend gleicht diesen mit dem in der Datenbank erwarteten Soll-Zustand ab und korrigiert Abweichungen (z. B. Server, der während der Trennung abgestürzt ist)
- Jeder Befehl trägt eine Korrelations-ID; der Agent verwirft Befehle mit einer bereits verarbeiteten ID (Schutz vor Doppelausführung bei Netzwerk-Retries)

### 2.3 Docker-Ansteuerung
- Der Agent spricht **nicht** direkt mit dem Docker-Socket, sondern über einen vorgeschalteten Docker-Socket-Proxy (z. B. `docker-socket-proxy`), der nur die tatsächlich benötigten API-Endpunkte freigibt
- Container-Hardening als Standard für alle Gameserver-Container:
  - `no-new-privileges` gesetzt
  - Wo vom Spiel unterstützt: Read-only-Root-Filesystem, beschreibbare Daten nur im gemounteten Volume
  - Restriktives Seccomp-Profil
  - Feste CPU-/RAM-Limits je Container

### 2.4 Game-Traffic-Proxy (VPS)
- TCP/UDP-Proxy-Schicht, die öffentliche Ports auf die passenden internen Container-Adressen im Tunnel-Netz umleitet
- Zuordnung Port ↔ Zielserver liegt in der Datenbank, wird bei Erstellung/Löschung eines Servers automatisch aktualisiert
- Für Spiele mit `supportsVirtualHostRouting = true` (initial: Minecraft) läuft stattdessen ein Hostname-basierter Reverse-Proxy (z. B. Infrared) auf einem einzigen öffentlichen Port für alle Instanzen dieses Spiels

### 2.5 Testbarkeit
- Die Docker-Ansteuerung im Agent liegt hinter einer abstrahierten Schnittstelle (`ContainerRuntime`), damit Unit-/Integrationstests mit einer Fake-Implementierung laufen können, ohne echten Docker-Host zu benötigen

---

## 3. Tech-Stack

| Komponente | Wahl |
|---|---|
| Backend | Node.js + TypeScript (Fastify oder NestJS) |
| Frontend | Next.js + React, Tailwind CSS, Mobile-First |
| Agent | Node.js + TypeScript |
| Datenbank | PostgreSQL |
| ORM | Drizzle ORM |
| Validierung/Typen | Zod (schema-first, gemeinsam genutzt von Backend-Validierung und Frontend-Typen) |
| Monorepo-Tooling | pnpm Workspaces + Turborepo |
| Container | Docker / Docker Compose |
| Reverse Proxy (VPS, Web) | Caddy oder Traefik (automatisches TLS) |
| Reverse Proxy (Minecraft) | Infrared (Hostname-Routing) |
| CAPTCHA | ALTCHA (selbstgehostet, Proof-of-Work-basiert) |
| Query-Protokolle Gameserver | `gamedig` |
| DNS-Automatisierung | Cloudflare API (Token mit ausschließlich DNS-Bearbeitungsrecht) |

---

## 4. Monorepo-Struktur

```
/apps
  /backend       Node/TS API
  /frontend      Next.js
  /agent         Homeserver-Agent
/packages
  /contracts     Einzige Quelle der Wahrheit für alle Datenstrukturen (DTOs, Envelope, Events)
  /validation    Zod-Schemas, gemeinsam von Backend & Frontend genutzt
```

**Versionierungsregel für `packages/contracts`:** Änderungen sind bevorzugt additiv (neue optionale Felder). Breaking Changes an bestehenden Feldern müssen im Commit/PR explizit als solche gekennzeichnet werden, da mehrere parallele Entwicklungs-Sessions gegen dieselben Contracts arbeiten. Diese Package-Grenze ist die zentrale Konvention für parallele Arbeit an Backend und Frontend (Basis für die spätere `CLAUDE.md`-Abschnittsaufteilung).

---

## 5. API-Design

### 5.1 Response-Envelope (einheitlich für jede REST-Antwort)
```ts
{
  success: boolean,
  data: T | null,
  error: { code: string, message: string } | null
}
```
Fehlercodes folgen einem festen, wachsenden Katalog (z. B. `AUTH_INVALID_CREDENTIALS`, `RESOURCE_LIMIT_EXCEEDED`, `SUBDOMAIN_TAKEN`), jeweils mit definierter HTTP-Status-Zuordnung.

**Ort des Katalogs:** `packages/contracts/src/errors.ts` (`ERROR_CATALOG`) – dort steht jeder Code zusammen mit seinem HTTP-Status und einer Fallback-Meldung. Neue Fehlerfälle werden ausschließlich dort additiv ergänzt, nie als Freitext-String am Aufrufort. Aktueller Stand:

| Code | HTTP-Status | Anlass |
|---|---|---|
| `AUTH_INVALID_CREDENTIALS` | 401 | Login mit falschen Zugangsdaten (§7) |
| `AUTH_REQUIRED` | 401 | Zugriff ohne gültige Sitzung (§7, §8) |
| `PERMISSION_DENIED` | 403 | Angemeldet, aber die nötige Permission fehlt (§8) |
| `RESOURCE_LIMIT_EXCEEDED` | 403 | Nutzer-Kontingent oder freie Node-Kapazität reicht nicht (§10) |
| `ROLE_PROTECTED` | 403 | Änderung an einer geschützten Systemrolle („Gast", §8) |
| `ROLE_NOT_FOUND` | 404 | Rolle existiert nicht (§8) |
| `ROLE_NAME_TAKEN` | 409 | Rollenname bereits vergeben (§8) |
| `SUBDOMAIN_TAKEN` | 409 | Subdomain belegt oder reserviert (§13) |

Die Hilfsfunktionen `ok()` und `fail()` aus `@palantir/contracts` erzeugen den Envelope – Backend-Routen formen ihn nicht selbst.

### 5.2 DTO-Prinzip
- Jede Ressource wird **immer vollständig** ausgeliefert (kein Zuschneiden auf einzelne Frontend-Ansichten); das Frontend entscheidet, was angezeigt wird
- Jedes DTO enthält ein serverseitig berechnetes `permissions`-Objekt (z. B. `{ canStart, canDelete, canManageMembers }`), damit Berechtigungslogik ausschließlich im Backend lebt

### 5.3 Kommunikationskanäle
- REST für klassische CRUD-Operationen
- WebSocket-Kanäle für Live-Daten: Konsole/Logs, Live-Stats, Chat, Benachrichtigungen
- Agent-Protokoll: Befehle mit Korrelations-ID (`CREATE`, `START`, `STOP`, `RESTART`, `DELETE`, `GET_STATS`, `GET_LOGS`, `EXEC_CONSOLE`, `FILE_LIST/READ/WRITE`, `CREATE_BACKUP`, `RESTORE_BACKUP`, `GET_STORAGE_BREAKDOWN`); Events vom Agent zurück (`STATUS_CHANGED`, `STATS_UPDATE`, `LOG_LINE`, `CRASHED`)

---

## 6. Datenmodell (Kernentitäten)

| Entität | Wesentliche Felder |
|---|---|
| `User` | id, displayName, isOwner, banned, createdAt |
| `AuthMethod` | userId, type (password/discord/steam/twitch), providerUserId, passwordHash |
| `Session` | userId, refreshTokenHash, deviceInfo, ipHint, createdAt, lastUsedAt, revokedAt |
| `Role` | id, name, permissions[], isProtected |
| `UserRole` | userId, roleId |
| `GameServer` | id, ownerId, gameType, name, status, dockerContainerId, hostId, subdomain, assignedPorts, resourceLimits, configJson, autoShutdownEnabled, createdAt |
| `ServerMember` | serverId, userId, permissionLevel |
| `Backup` | id, serverId, createdAt, sizeBytes, storagePath, type |
| `Schedule` | serverId, cronExpression, action, payload |
| `AuditLog` | id, userId, action, targetType, targetId, timestamp, metadata *(append-only, keine Update-/Delete-Operation zulässig)* |
| `GameTypeDefinition` | id, dockerImage, defaultEnv, defaultPorts, configSchema, resourceDefaults, queryType, iconUrl, supportsVirtualHostRouting |
| `HostNode` | id, wireguardIp, totalResources, status |
| `NotificationChannel` | id, name, type, targetConfig |
| `NotificationRule` | eventType, channelId, recipientScope |
| `Conversation` | id, type (dm/server_chat), serverId? |
| `Message` | conversationId, senderId, content, createdAt, deletedAt |
| `MessageReport` | messageId, reportedBy, reason, status, actionTaken |
| `ArcadeScore` | userId, gameId, score, createdAt |
| `UserResourceLimit` | userId, maxRamMb, maxCpuCores, maxDiskMb, maxConcurrentServers *(alle nullable)* |

**Audit-Log-Aufbewahrung:** Einträge werden nie durch Admin-Aktionen verändert oder gelöscht (append-only). Ein separater, rein additiver Archivierungsprozess exportiert Einträge, die älter als 24 Monate sind, in eine komprimierte Archivdatei und entfernt sie anschließend aus der aktiven Tabelle – so bleibt das Datenbankwachstum kontrollierbar, ohne dass die Unveränderlichkeit während laufender Vorgänge aufgeweicht wird.

---

## 7. Auth & Identity

- Login über Passwort oder OAuth2 (Discord, Twitch) / OpenID (Steam)
- OAuth-Scopes minimal (nur Identitätsinformationen, keine weitergehenden Berechtigungen)
- Beim Login über einen Provider wird `providerUserId` gegen bestehende `AuthMethod`-Einträge geprüft; kein Treffer → neuer `User` mit Rolle Gast + Verknüpfung dieser Methode
- Verknüpfung weiterer Login-Methoden nur im eingeloggten Zustand möglich
- Passwort-Hashing mit Argon2id; Mindestanforderungen an Passwörter (Mindestlänge 12 Zeichen)
- 2FA (TOTP) optional aktivierbar für Passwort-Konten
- Access-Token: kurzlebiges JWT; Refresh-Token: opak, **gehasht in der `Session`-Tabelle gespeichert** (nicht im Klartext), in httpOnly-Secure-Cookie mit `SameSite=Lax` (bewusst nicht `Strict`: das würde den Cookie-Versand beim Rückkehr-Redirect von Discord/Steam/Twitch-OAuth verhindern und den Login-Flow brechen); zustandsändernde Requests zusätzlich per CSRF-Token abgesichert
- Aktive Sitzungen einsehbar/einzeln widerrufbar über die `Session`-Tabelle
- ALTCHA-Verifikation + IP-basiertes Rate-Limiting auf Registrierung und Login

---

## 8. RBAC / Permission-System

- Permissions als feste String-Konstanten (Auszug): `server.create`, `server.view.own`, `server.view.any`, `server.manage.own`, `server.manage.any`, `server.delete.own`, `server.delete.any`, `backup.manage.own`, `backup.manage.any`, `user.manage`, `role.manage`, `notification.manage`, `node.view`, `node.manage`, `address.manage`, `audit.view`, `message.moderate`, `gametype.manage`
- Hinweis: `gametype.manage` ist bereits Teil des Katalogs, bleibt in Version 1 aber ungenutzt (kein UI-Pfad davorgeschaltet, siehe Abgrenzung im Lastenheft) – vorbereitet für die Admin-Oberfläche zur Spiele-Verwaltung in Phase 3
- Rollen sind frei definierbare Bündel dieser Permissions; ein Nutzer kann mehrere Rollen haben, effektive Rechte = Vereinigung
- Seed-Rollen bei Ersteinrichtung: **Admin**, **Moderator**, **Nutzer** (vollständig editierbar); **Gast** als geschützte Systemrolle ohne jede Permission
- `User.isOwner`-Flag: unabhängig vom Rollensystem immer alle Permissions – verhindert Selbst-Aussperrung

**Ort des Katalogs:** `packages/contracts/src/permissions.ts` (`PERMISSION_CATALOG`) – dort steht jede Permission zusammen mit Beschreibung (für den Rollen-Editor) und Geltungsbereich (`own` / `any` / `global`). Neue Permissions werden ausschließlich dort additiv ergänzt und zusätzlich in der obigen Aufzählung nachgetragen.

**Auswertung von `.own`/`.any`:** Wer `<basis>.any` besitzt, darf den Vorgang bei jeder Ressource; wer nur `<basis>.own` besitzt, ausschließlich bei eigenen (bzw. solchen, bei denen er Mitglied ist). Die Paare sind in `SCOPED_PERMISSION_BASES` festgehalten, die Auswertung liegt an genau einer Stelle im Backend-Modul `apps/backend/src/modules/rbac`.

**Feldbenennung im Rollen-DTO (Abweichung von §6):** §6 nennt das Permission-Bündel der Entität `Role` schlicht `permissions`. Im DTO ist `permissions` jedoch durchgängig für das serverseitig berechnete Flags-Objekt aus §5.2 reserviert, damit sich das Frontend über alle DTOs hinweg darauf verlassen kann. Das Bündel heißt im `RoleDto` deshalb `grantedPermissions`; die Datenbankspalte bleibt `permissions`.

**Kontobezogenes `permissions`-Objekt:** Neben den ressourcenbezogenen Flags gibt es `GlobalPermissions` (`packages/contracts/src/permissions.ts`) für die instanzweiten Rechte des angemeldeten Nutzers (Navigation, Admin-Bereiche). Es hängt am Session-/Konto-DTO aus §7; das Frontend leitet nie selbst etwas aus Rollen ab.

---

## 9. Server-Lifecycle

**Zustände:** `creating → stopped → starting → running → stopping → stopped`, zusätzlich `error` und `crashed`

- `starting → running` erfolgt erst nach erfolgreichem Health-Check (Query via `gamedig` bzw. generischer Port-Connect-Test beim Test-Typ) – ein gestarteter Prozess allein reicht nicht
- Bei `crashed`: automatischer Neustart-Versuch mit begrenzter Anzahl an Wiederholungen innerhalb eines Zeitfensters (Crash-Loop-Schutz), danach `error` mit Benachrichtigung
- Auto-Shutdown: periodische Spielerabfrage durch den Agent; Schonfrist nach Start, konfigurierbarer Inaktivitäts-Timeout, pro Server deaktivierbar
- Ein automatischer Neustart nach Absturz zählt im Sinne der Auto-Shutdown-Schonfrist als regulärer Serverstart – verhindert, dass ein gerade wiederhergestellter Server sofort fälschlich als inaktiv erkannt und erneut abgeschaltet wird
- Klonen: erzeugt einen neuen `GameServer`-Datensatz mit kopierter Konfiguration und zwingend neuer, eigener Subdomain (gleiche Prüf-/Formatregeln wie bei Neuerstellung); Weltdaten werden optional synchron mitkopiert, Fortschritt wird im Frontend angezeigt

---

## 10. Ressourcen- & Kapazitätsmanagement

- `UserResourceLimit` optional pro Nutzer (nullable = kein Limit)
- Vor jedem Start: harte Prüfung der tatsächlich freien Ressourcen der Ziel-VM gegen die angeforderten Limits des Servers – unabhängig vom Nutzer-Kontingent
- Ressourcen-Warnungen (Event `resource.low`) bei konfigurierbaren Schwellwerten (Server- und Node-Ebene)

---

## 11. Spiele-Registry

- `GameTypeDefinition` kapselt alles Spielspezifische: Docker-Image, Standard-Umgebungsvariablen, editierbares Config-Schema fürs Frontend, Standard-Ports, Ressourcen-Empfehlung, Query-Typ (für `gamedig`), Icon, Flag für Hostname-Routing-Fähigkeit
- Phase 1 nutzt einen minimalen Test-Typ (einfacher Container, der auf einem Port lauscht) zur Validierung der gesamten Orchestrierungs-Pipeline ohne echtes Spiel
- Neue Spiele werden in Version 1 per Code/Deployment ergänzt, nicht über eine Admin-Oberfläche

---

## 12. Deployment, Setup & Konfiguration

### 12.1 Zentrale Konfigurationsdatei
- **Eine** `.env.example`-Datei im Repo-Root, vollständig kommentiert, mit allen im System benötigten Variablen (Domain, DB-Zugang, JWT-Secret, OAuth-Client-Keys je Provider, Discord-Webhook-URL, WireGuard-Keys, Cloudflare-API-Token, ALTCHA-Konfiguration)
- `.env` wird lokal daraus erzeugt, ist in `.gitignore` ausgeschlossen, landet niemals im Repository
- Dieselbe `.env` wird sowohl auf der VPS als auch auf dem Homeserver eingesetzt; jede Komponente liest nur die für sie relevanten Variablen
- **Sicherheitsauflage:** Dateirechte auf `.env` restriktiv setzen (nur lesbar für den ausführenden Dienst-Nutzer); `.env` darf nicht unverschlüsselt in automatisierten System-Backups landen
- Maximale Upload-Größe pro Datei im Datei-Manager ist über eine Umgebungsvariable konfigurierbar (Standardwert: 2 GB)
- Konvention: jede neue Konfigurationsvariable muss zwingend mit Kommentar in `.env.example` ergänzt werden (relevant für parallele Entwicklung)

### 12.2 Setup-Wizard
Ein Skript (`scripts/setup.sh`), das:
1. `.env.example` nach `.env` kopiert, falls noch nicht vorhanden
2. sichere Secrets automatisch generiert (JWT-Secret etc.)
3. ein WireGuard-Schlüsselpaar für VPS und Homeserver erzeugt und ausgibt
4. vor dem Start prüft, ob alle Pflichtfelder (Domain, mindestens ein OAuth-Provider) ausgefüllt sind

### 12.3 Dokumentation im Repository
- `README.md`: Projektüberblick, Architekturdiagramm, Quick-Start
- `SETUP.md`: Schritt-für-Schritt-Anleitung – VPS vorbereiten, `.env` ausfüllen, OAuth-Apps bei Discord/Twitch/Steam anlegen (inkl. Redirect-URI-Konfiguration passend zur Domain), WireGuard zwischen VPS und Homeserver einrichten, Homeserver-VM vorbereiten, `docker compose up` auf beiden Seiten, Ersteinrichtung des Owner-Accounts

---

## 13. Domain- & Subdomain-Routing

- Nutzer wählt beim Erstellen eines Servers eine eigene Subdomain (Verfügbarkeitsprüfung, Formatvalidierung, gesperrte reservierte Namen wie `www`, `api`, `admin`, `vpn`, `mail`)
- Backend legt automatisch den passenden DNS-Eintrag über die Cloudflare-API an (Token beschränkt auf DNS-Bearbeitungsrecht)
- Minecraft: DNS-Eintrag zeigt auf den Hostname-Routing-Proxy (ein öffentlicher Port für alle Instanzen)
- Andere Spiele: DNS-Eintrag zeigt auf die VPS-IP, Port bleibt für den Spieler sichtbar/einzugeben
- Web-Domain (Frontend/API) kann zusätzlich hinter Cloudflare als CDN/WAF laufen; Spiele-Subdomains müssen auf "DNS only" stehen, da Cloudflares Standardprodukt kein rohes TCP/UDP-Spieleprotokoll proxied

---

## 14. Notification-Engine

- Internes Event-System (`server.started`, `server.stopped`, `server.crashed`, `backup.failed`, `autoShutdown.triggered`, `resource.low`, `user.registered`, `message.reported`, ...)
- **Benennungsschema:** `<domäne>.<vorgang>`, beide Segmente lowerCamelCase, genau ein Punkt als Trenner. Als Typ festgehalten in `packages/contracts/src/events.ts` (`WEBSOCKET_EVENTS`, `WebSocketEventName`); neue Events werden dort und in dieser Liste additiv ergänzt.
- `NotificationChannel` (aktuell: Discord-Webhook) getrennt von `NotificationRule` (Event → Kanal → Empfängerkreis), beides über Admin-Oberfläche konfigurierbar

---

## 15. Chat & Moderation

- `Conversation` (DM oder Server-Chat), `Message`, `MessageReport`
- Server-Chat entsteht automatisch mit dem Server, Teilnehmerkreis folgt `ServerMember`
- Moderation ausschließlich reaktiv über Meldungen, kein genereller Admin-Zugriff auf private Nachrichteninhalte
- Moderationsaktionen werden im Audit-Log erfasst

---

## 16. Speicherverwaltung (Storage-Explorer)

- Agent-Befehl `GET_STORAGE_BREAKDOWN`: liefert Größen von Server-Datenordnern, Backups, Docker-Images (inkl. Nutzungsstatus) und nicht zuordenbaren Daten
- Scan erfolgt on-demand (nicht dauerhaft im Hintergrund), Ergebnis wird mit Zeitstempel zwischengespeichert
- Löschbar über die Oberfläche: Backups, ungenutzte Docker-Images, eindeutig verwaiste Daten
- Aktive Server-Datenordner sind hierüber nicht löschbar (nur über den dedizierten Server-Löschen-Vorgang)

---

## 17. Arcade-Modul

- Eigenständig implementierte Browser-Minispiele (kein Bezug zu geschützten Original-Marken/-Assets), rein clientseitig
- `ArcadeScore`-Entität für Bestenlisten je Spiel

---

## 18. Sicherheitskonzept – Zusammenfassung

- Kein offener Port am Heimrouter, kein Listener am Homeserver
- WireGuard-Verschlüsselung + zusätzliche Authentifizierung des Agent-Kanals
- Docker-Socket-Proxy statt direktem Root-Zugriff, gehärtete Container-Konfiguration
- Frei definierbares RBAC mit Owner-Schutzmechanismus
- Gehashte Passwörter (Argon2id) und gehashte Refresh-Tokens, 2FA optional
- CSRF-Schutz bei zustandsändernden Requests
- ALTCHA + Rate-Limiting gegen Spam/Brute-Force
- Append-only Audit-Log
- Restriktive Rechte auf die zentrale `.env`, keine Secrets im Repository
- Minimale OAuth-Scopes
- Reaktive statt proaktive Chat-Moderation (Datenschutz-Prinzip)

---

## 19. Offene Punkte (Platzhalter zum Zeitpunkt der Dokumenterstellung)

- Endgültiger Domain-Name
- Feasibility-Prüfung einzelner Spiele aus Anhang A des Lastenhefts (insbesondere Mecca Chameleon, Hytale) bei Umsetzung in Phase 3
- Konkrete Docker-Registry für selbst gebaute Spiele-Images (eigene Registry vs. privates Repository) – wird bei Beginn von Phase 2 festgelegt
- Datenschutzerklärung/Impressum bzw. rechtliche Anforderungen bei offener Registrierung mit gespeicherten Profildaten (Discord/Steam/Twitch) wurden nicht bewertet – dieses Dokument gibt dazu keine Rechtsberatung; ggf. rechtlich prüfen lassen, sobald die Nutzung über den reinen Freundeskreis hinausgeht

---

## 20. Nächster Schritt

Aufbauend auf diesem Pflichtenheft folgt die `CLAUDE.md` mit konkreter Abschnittseinteilung für parallele Entwicklung (Backend-Module, Frontend-Views, `packages/contracts` als Schnittstellen-Grenze) zur direkten Nutzung mit Claude Code.
