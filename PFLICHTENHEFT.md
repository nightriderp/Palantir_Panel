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
- **Eingehender Verkehr auf dem Homeserver-Interface `wg0` ist per Voreinstellung vollständig blockiert** (Umsetzung: `PostUp`/`PostDown` in `/etc/wireguard/wg0.conf` auf dem Homeserver, dokumentiert in `deploy/gamenode/wireguard-firewall.md`). Das setzt §1 durch: der Homeserver nimmt keine eingehenden Verbindungen an, auch SSH-Port 22 steht aus dem Tunnel nicht offen. Nur der Rückverkehr der vom Agent **ausgehend** aufgebauten Verbindung wird zustandsbehaftet zugelassen.
- **Ausnahmen für Fernwartung** (falls überhaupt nötig) sind eng zu begrenzen – feste Quell-IP eines dedizierten Wartungs-Peers (nicht die VPS) und ausschließlich Port `22/tcp` – und **hier namentlich zu vermerken**. Ohne einen solchen Eintrag gilt der vollständige Block. Derzeit ist keine Ausnahme eingerichtet.

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
- Umsetzung im Agent (Arbeitspaket A2, `apps/agent/src/runtime/hardening.ts`): Die Haertung wird an genau einer Stelle gebaut, an der jede Container-Erzeugung vorbeimuss. Zusaetzlich zu den obigen Punkten werden alle Linux-Capabilities entzogen (`CapDrop: ALL`), Swap deaktiviert (sonst waere das RAM-Limit ueber die Auslagerungsdatei umgehbar), ein PID-Limit gegen Fork-Bomben gesetzt, das Container-Log rotiert und Ports an ein festes Interface statt an `0.0.0.0` gebunden. Die Neustart-Regel der Engine steht bewusst auf `no`: Neustarts nach Absturz steuert Palantir selbst mit Crash-Loop-Schutz (§9).
- **Seccomp-Profil:** Das Profil ist ueber die Variable `AGENT_SECCOMP_PROFILE_PATH` konfigurierbar (Pfad zu einer JSON-Datei auf dem Homeserver). Ist sie gesetzt, gibt der Agent genau dieses Profil bei jedem Container mit. Ist sie leer, greift das Standardprofil der Container-Engine, das bereits rund vier Dutzend gefaehrliche Syscalls sperrt. Bewusste Entscheidung: ein handgepflegtes Whitelist-Profil ist fehleranfaellig und bricht erfahrungsgemaess einzelne Spiele-Images; `seccomp=unconfined` ist an keiner Stelle vorgesehen.

### 2.4 Game-Traffic-Proxy (VPS)
- TCP/UDP-Proxy-Schicht, die öffentliche Ports auf die passenden internen Container-Adressen im Tunnel-Netz umleitet
- Zuordnung Port ↔ Zielserver liegt in der Datenbank, wird bei Erstellung/Löschung eines Servers automatisch aktualisiert
- Für Spiele mit `supportsVirtualHostRouting = true` (initial: Minecraft) läuft stattdessen ein Hostname-basierter Reverse-Proxy (z. B. Infrared) auf einem einzigen öffentlichen Port für alle Instanzen dieses Spiels

**Umsetzung im Backend (Arbeitspaket B8, `apps/backend/src/modules/admin/ports.ts`):** Der Admin pflegt ausschließlich die **Bereiche** (`port_ranges`), aus denen vergeben werden darf – Standardwerte dafür stehen als `GAME_PORT_RANGE_START`/`_END` in der zentralen `.env`. Die einzelne Zuordnung (`port_allocations`) entsteht und verschwindet mit dem Server: B3 ruft dafür `allocateForServer()` bzw. `releaseForServer()` auf. Eine Zuordnung mit noch existierendem Server lässt sich deshalb nicht von Hand freigeben, und ein Bereich, aus dem Ports vergeben sind, weder löschen noch so verkleinern, dass ein vergebener Port herausfällt (`PORT_RANGE_IN_USE`). Dass derselbe Port je Protokoll nur einmal vergeben ist, sichert zusätzlich ein Unique-Index in der Datenbank ab.

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
| `AUTH_ACCOUNT_BANNED` | 403 | Konto ist gesperrt (Lastenheft §3.1) |
| `AUTH_RATE_LIMITED` | 429 | IP-Rate-Limit auf Anmeldung/Registrierung greift (§7) |
| `AUTH_TWO_FACTOR_INVALID` | 401 | Falscher TOTP- oder Backup-Code im zweiten Anmeldeschritt (§7) |
| `AUTH_TWO_FACTOR_EXPIRED` | 401 | Zwischen-Token des zweiten Anmeldeschritts abgelaufen (§7) |
| `AUTH_CAPTCHA_INVALID` | 400 | ALTCHA-Prüfung von Registrierung oder Login fehlgeschlagen – fehlender, ungültiger, abgelaufener oder bereits eingelöster Nachweis (§3, §7) |
| `AUTH_USERNAME_TAKEN` | 409 | Benutzername bei der Registrierung bereits vergeben (§7) |
| `AUTH_PASSWORD_TOO_WEAK` | 400 | Passwort erfüllt die Mindestanforderungen aus §7 nicht |
| `AUTH_PROVIDER_ERROR` | 502 | Anmeldung über Discord/Twitch/Steam fehlgeschlagen (Lastenheft §3.1) |
| `PERMISSION_DENIED` | 403 | Angemeldet, aber die nötige Permission fehlt (§8) |
| `RESOURCE_LIMIT_EXCEEDED` | 403 | Nutzer-Kontingent oder freie Node-Kapazität reicht nicht (§10) |
| `ROLE_PROTECTED` | 403 | Änderung an einer geschützten Systemrolle („Gast", §8) |
| `USER_NOT_FOUND` | 404 | Konto existiert nicht (§6, §10) |
| `AUTH_CSRF_INVALID` | 403 | Zustandsändernder Request ohne gültiges CSRF-Token (§7) |
| `AUTH_SESSION_EXPIRED` | 401 | Refresh-Token abgelaufen, widerrufen oder unbekannt (§7) |
| `AUTH_SESSION_NOT_FOUND` | 404 | Sitzung existiert nicht oder gehört zu einem anderen Konto (§7) |
| `AUTH_TWO_FACTOR_ALREADY_ENABLED` | 409 | 2FA ist für dieses Konto bereits aktiv (§7) |
| `AUTH_TWO_FACTOR_NOT_ENABLED` | 409 | Vorgang setzt aktive 2FA voraus (§7) |
| `AUTH_METHOD_ALREADY_LINKED` | 409 | Anmeldeverfahren ist bereits mit einem Konto verknüpft (§7) |
| `AUTH_METHOD_NOT_FOUND` | 404 | Anmeldeverfahren ist mit diesem Konto nicht verknüpft (§7) |
| `AUTH_METHOD_LAST_REMAINING` | 409 | Letztes verbliebenes Anmeldeverfahren soll getrennt werden (§7) |
| `AUTH_OAUTH_STATE_INVALID` | 400 | Rückkehr vom Provider ohne gültigen `state` (§7) |
| `AUTH_PROVIDER_NOT_CONFIGURED` | 501 | Für diesen Provider fehlen die Zugangsdaten in der `.env` (§12.1) |
| `AUTH_PASSWORD_CHANGE_REQUIRED` | 403 | Admin hat das Passwort zurückgesetzt, Änderung steht aus (Lastenheft §3.1) |
| `AUTH_OWNER_PROTECTED` | 403 | Vorgang würde den Owner aussperren, z. B. Selbst-Löschung (Lastenheft §2) |
| `NODE_NOT_FOUND` | 404 | Node existiert nicht (§6, §10) |
| `ROLE_NOT_FOUND` | 404 | Rolle existiert nicht (§8) |
| `ROLE_NAME_TAKEN` | 409 | Rollenname bereits vergeben (§8) |
| `SUBDOMAIN_TAKEN` | 409 | Subdomain belegt oder reserviert (§13) |
| `SUBDOMAIN_INVALID` | 400 | Subdomain verletzt das erlaubte Format (§13) |
| `SERVER_STATE_CONFLICT` | 409 | Lifecycle-Befehl passt nicht zum aktuellen Zustand (§9) |
| `FILE_TOO_LARGE` | 413 | Upload überschreitet `MAX_UPLOAD_SIZE_BYTES` (§12.1) |
| `VALIDATION_FAILED` | 400 | Pfad-, Query- oder Körperwert verletzt das vereinbarte Schema (§5.2) |
| `SERVER_NOT_FOUND` | 404 | Gameserver existiert nicht oder ist für den Aufrufer nicht sichtbar (§6) |
| `BACKUP_NOT_FOUND` | 404 | Backup existiert nicht oder ist für den Aufrufer nicht sichtbar (§6) |
| `BACKUP_NOT_READY` | 409 | Vorgang setzt ein abgeschlossenes Backup voraus (Restore, Download, Löschen) |
| `BACKUP_ALREADY_RUNNING` | 409 | Für diesen Server läuft bereits ein Backup |
| `SCHEDULE_INVALID_CRON` | 400 | Cron-Ausdruck einer geplanten Aufgabe ist ungültig (§6) |
| `AGENT_UNAUTHORIZED` | 401 | Pre-Shared-Token des Agents fehlt oder ist falsch (§2.2) |
| `AGENT_PROTOCOL_VERSION_MISMATCH` | 400 | Agent und Backend sprechen unterschiedliche Protokollversionen (§2.2) |
| `AGENT_COMMAND_INVALID` | 400 | Befehls-Frame verletzt das vereinbarte Format (§5.3) |
| `AGENT_COMMAND_FAILED` | 500 | Ausführung des Befehls in der Container-Runtime fehlgeschlagen (§5.3) |
| `AGENT_COMMAND_NOT_IMPLEMENTED` | 501 | Befehl steht im Protokoll, ist auf dem Agent aber noch nicht gebaut (§5.3) |
| `AGENT_CONTAINER_NOT_FOUND` | 404 | Container existiert auf dem Homeserver nicht (mehr) |
| `AGENT_CONTAINER_NOT_RUNNING` | 409 | Vorgang setzt einen laufenden Container voraus (Konsole, Dateizugriff) |
| `AGENT_CONTAINER_STATE_CONFLICT` | 409 | Container ist für den Vorgang im falschen Zustand |
| `AGENT_CONTAINER_NAME_CONFLICT` | 409 | Container mit diesem Namen existiert bereits |
| `AGENT_IMAGE_NOT_FOUND` | 404 | Container-Image liegt auf dem Homeserver nicht vor |
| `AGENT_INVALID_PATH` | 400 | Pfad ungültig oder außerhalb des erlaubten Bereichs |
| `AGENT_FILE_NOT_FOUND` | 404 | Datei im Container nicht gefunden |
| `AGENT_FILE_TOO_LARGE` | 413 | Datei überschreitet das Größenlimit (§12.1) |
| `AGENT_RUNTIME_UNAVAILABLE` | 503 | Container-Engine bzw. Docker-Socket-Proxy nicht erreichbar |
| `NODE_ADDRESS_TAKEN` | 409 | Node-Name oder WireGuard-Adresse bereits vergeben (§2.1) |
| `NODE_IN_USE` | 409 | Node trägt noch Gameserver und kann nicht entfernt werden |
| `PORT_RANGE_NOT_FOUND` | 404 | Port-Bereich existiert nicht (§2.4) |
| `PORT_RANGE_INVALID` | 400 | Bereichsgrenzen unzulässig (§2.4) |
| `PORT_RANGE_OVERLAP` | 409 | Bereich überschneidet einen bestehenden Bereich desselben Protokolls |
| `PORT_RANGE_IN_USE` | 409 | Aus dem Bereich sind noch Ports vergeben |
| `PORT_POOL_EXHAUSTED` | 409 | Kein freier öffentlicher Port mehr im Pool (§2.4) |
| `PORT_ALLOCATION_NOT_FOUND` | 404 | Port-Zuordnung existiert nicht |
| `STORAGE_SCAN_MISSING` | 409 | Für die Node liegt noch keine Speicherübersicht vor (§16) |
| `STORAGE_ENTRY_NOT_FOUND` | 404 | Eintrag steht nicht in der zwischengespeicherten Übersicht (§16) |
| `STORAGE_ENTRY_NOT_DELETABLE` | 403 | Eintrag ist über den Storage-Explorer nicht löschbar, insbesondere aktive Server-Datenordner (§16) |
| `AUDIT_ENTRY_IMMUTABLE` | 403 | Versuch, einen Audit-Eintrag zu ändern oder zu löschen (§6) |
| `AUDIT_ARCHIVE_FAILED` | 500 | Archivdatei des Audit-Logs konnte nicht geschrieben werden (§6) |
| `OWNER_PROTECTED` | 403 | Aktion würde das Owner-Konto aussperren (§8) |
| `OWNER_ALREADY_EXISTS` | 409 | Owner-Status soll vergeben werden, obwohl bereits ein Owner existiert (Lastenheft §2, §12.3) |
| `REGISTRATION_REQUEST_INVALID_STATE` | 409 | Wartelisten-Aktion passt nicht zum Zustand des Kontos (§7) |
| `SERVER_NOT_FOUND` | 404 | Gameserver existiert nicht oder ist nicht sichtbar (§9) |
| `SERVER_STATE_CONFLICT` | 409 | Lifecycle-Übergang im aktuellen Zustand unzulässig (§9) |
| `SERVER_CRASH_LOOP` | 409 | Crash-Loop-Schutz hat abgeschaltet (§9) |
| `SERVER_HEALTH_CHECK_FAILED` | 504 | Server war nach dem Start nicht erreichbar (§9) |
| `GAME_TYPE_NOT_FOUND` | 404 | Spiele-Definition existiert nicht (§11) |
| `GAME_TYPE_NOT_AVAILABLE` | 409 | Spiele-Definition existiert, ist in dieser Phase aber nicht nutzbar (§11) |
| `SUBDOMAIN_INVALID` | 400 | Subdomain verletzt die Formatregel (§13) |
| `DNS_UPDATE_FAILED` | 502 | DNS-Eintrag konnte bei Cloudflare nicht gesetzt werden (§13) |
| `AGENT_NOT_CONNECTED` | 503 | Für die Ziel-Node ist kein Agent verbunden (§2.2) |
| `AGENT_COMMAND_TIMEOUT` | 504 | Agent hat den Befehl nicht innerhalb der Frist beantwortet (§5.3) |
| `NOTIFICATION_CHANNEL_NOT_FOUND` | 404 | Benachrichtigungskanal existiert nicht (§14) |
| `NOTIFICATION_CHANNEL_NAME_TAKEN` | 409 | Kanalname bereits vergeben (§14) |
| `NOTIFICATION_CHANNEL_NOT_CONFIGURED` | 409 | Kanal nutzt die `.env`-Vorgabe, `DISCORD_WEBHOOK_URL` ist nicht gesetzt (§12.1, §14) |
| `NOTIFICATION_CHANNEL_IN_USE` | 409 | Kanal wird noch von mindestens einer Regel genutzt (§14) |
| `NOTIFICATION_RULE_NOT_FOUND` | 404 | Benachrichtigungsregel existiert nicht (§14) |
| `NOTIFICATION_RULE_DUPLICATE` | 409 | Regel mit identischem Ereignis, Kanal und Empfängerkreis existiert bereits (§14) |
| `NOTIFICATION_EVENT_NOT_NOTIFIABLE` | 400 | Regel auf ein reines Live-Ereignis, das keine Benachrichtigung auslöst (§14) |
| `NOTIFICATION_NOT_FOUND` | 404 | Meldung existiert nicht oder gehört zu einem anderen Konto (§14) |
| `NOTIFICATION_DELIVERY_FAILED` | 502 | Zustellung an den externen Kanal gescheitert – nur bei der vom Admin ausgelösten Testnachricht (§14) |
| `ANNOUNCEMENT_NOT_FOUND` | 404 | Systemweite Ankündigung existiert nicht (Lastenheft §3.6) |
| `CONVERSATION_NOT_FOUND` | 404 | Konversation existiert nicht oder der Aufrufer nimmt nicht an ihr teil (§15) |
| `CONVERSATION_RECIPIENT_INVALID` | 400 | Empfänger einer Direktnachricht unzulässig, etwa das eigene Konto (§15) |
| `CONVERSATION_RECIPIENT_NOT_ALLOWED` | 403 | Empfänger ist nicht freigeschaltet oder gesperrt (Lastenheft §3.6) |
| `MESSAGE_NOT_FOUND` | 404 | Nachricht existiert nicht oder liegt in einer fremden Konversation (§15) |
| `MESSAGE_ALREADY_DELETED` | 409 | Nachricht ist bereits gelöscht (§15) |
| `MESSAGE_REPORT_NOT_FOUND` | 404 | Meldung existiert nicht (§15) |
| `MESSAGE_REPORT_DUPLICATE` | 409 | Dieselbe Nachricht wurde von demselben Konto bereits gemeldet (§15) |
| `MESSAGE_REPORT_NOT_ALLOWED` | 403 | Melden an dieser Stelle nicht vorgesehen, etwa beim eigenen Beitrag (§15) |
| `MESSAGE_REPORT_ALREADY_RESOLVED` | 409 | Über die Meldung wurde bereits entschieden (§15) |

Die `AGENT_*`-Codes gelten für den WebSocket-Kanal zum Agent, der kein REST-Endpunkt ist. Die HTTP-Status-Zuordnung greift dort beim Handshake und dient dem Backend als Vorlage, wenn es einen Agent-Fehler an eine REST-Antwort weiterreicht.

Die Container-Runtime des Agents führt zusätzlich einen eigenen, agent-internen Katalog ohne HTTP-Status (`RUNTIME_ERROR_CATALOG` in `apps/agent/src/runtime/errors.ts`). Die Übersetzung dieser Codes auf die `AGENT_*`-Codes oben passiert an genau einer Stelle: `apps/agent/src/connection/runtime-adapter.ts`. Ein Test dort hält die Zuordnung vollständig.

Die Hilfsfunktionen `ok()` und `fail()` aus `@palantir/contracts` erzeugen den Envelope – Backend-Routen formen ihn nicht selbst.

**Agent-interner Fehlerkatalog:** Der Agent liefert keine HTTP-Antworten und fuehrt deshalb einen eigenen, ebenfalls benannten Katalog in `apps/agent/src/runtime/errors.ts` (`RUNTIME_ERROR_CATALOG`, z. B. `CONTAINER_NOT_FOUND`, `IMAGE_NOT_FOUND`, `INVALID_PATH`, `RUNTIME_UNAVAILABLE`). Auch dort gilt: kein Freitext-Fehler. Die Zuordnung dieser Codes auf Codes des HTTP-Katalogs oben erfolgt in der Server-Orchestrierung (B3), nicht im Agent.

### 5.2 DTO-Prinzip
- Jede Ressource wird **immer vollständig** ausgeliefert (kein Zuschneiden auf einzelne Frontend-Ansichten); das Frontend entscheidet, was angezeigt wird
- Jedes DTO enthält ein serverseitig berechnetes `permissions`-Objekt (z. B. `{ canStart, canDelete, canManageMembers }`), damit Berechtigungslogik ausschließlich im Backend lebt

### 5.3 Kommunikationskanäle
- REST für klassische CRUD-Operationen
- WebSocket-Kanäle für Live-Daten: Konsole/Logs, Live-Stats, Chat, Benachrichtigungen
- Agent-Protokoll: Befehle mit Korrelations-ID (`CREATE`, `START`, `STOP`, `RESTART`, `DELETE`, `GET_STATS`, `GET_LOGS`, `EXEC_CONSOLE`, `FILE_LIST/READ/WRITE`, `CREATE_BACKUP`, `RESTORE_BACKUP`, `DOWNLOAD_BACKUP`, `DELETE_BACKUP`, `GET_STORAGE_BREAKDOWN`, `SET_SERVER_QUERY`, `REMOVE_STORAGE_ENTRY`); Events vom Agent zurück (`STATUS_CHANGED`, `STATS_UPDATE`, `LOG_LINE`, `CRASHED`)

**Live-Kanal Browser ↔ Backend:** Die Frames dieses Kanals legt das Pflichtenheft nicht fest; sie stehen als `LiveClientFrame` und `LiveServerEventFrame` in `packages/contracts/src/server-live.ts`. Der Browser abonniert eine Ressource (`{ resource: 'server', id }`) und empfängt darauf die Ereignisse `server.statusChanged`, `server.statsUpdated`, `server.consoleLineAppended`, `serverClone.progressed` (§14). Konsolenbefehle laufen als `consoleCommand`-Frame über dieselbe Verbindung. Nicht zu verwechseln mit dem Agent-Protokoll unten: das verbindet Backend und Homeserver.

**Ort des Agent-Protokolls:** `packages/contracts/src/agent-protocol.ts` (`AGENT_COMMANDS`, `AGENT_EVENTS`, Frame-Typen, `AGENT_PROTOCOL_VERSION`), Zod-Gegenstück in `packages/validation/src/agent-protocol.ts`. Befehle und Ereignisse werden ausschließlich dort additiv ergänzt.

Über dieselbe Verbindung laufen neben Befehl (`command`) und Ergebnis (`commandResult`) auch der Handshake (`hello`/`welcome`), der vollständige Ist-Zustands-Bericht (`stateReport`, angefordert über `stateRequest`) und unaufgeforderte Ereignisse (`event`). Festlegungen dieser Sitzung, die das Pflichtenheft offen ließ:

- **Korrelations-ID-Format:** UUID (Version 4), erzeugt vom Backend – dasselbe Format wie alle Entitäts-IDs
- **Token-Übergabe:** Das Pre-Shared-Token wird im `Authorization: Bearer …`-Header des WebSocket-Handshakes übergeben, nicht als Feld in einem Frame; so taucht es nicht in Nachrichten-Logs auf und die Verbindung wird abgelehnt, bevor ein Frame fließt
- **Duplikat-Antwort:** Ein Befehl mit bereits verarbeiteter Korrelations-ID wird nicht erneut ausgeführt; das gespeicherte Ergebnis wird mit `duplicate: true` erneut geschickt, da der Retry meist gerade deshalb entsteht, weil das erste Ergebnis das Backend nicht erreicht hat
- **Befehlsergebnisse** nutzen den Response-Envelope aus §5.1, Fehler also benannte Codes aus dem Katalog statt Freitext

**Nutzdaten und Ergebnisse je Befehl:** `packages/contracts/src/agent-commands.ts` (`AgentCommandPayloads`, `AgentCommandResults`), Zod-Gegenstück in `packages/validation/src/agent-commands.ts`. Container-bezogene Befehle tragen die `containerId` in den Nutzdaten – das Backend kennt sie als `GameServer.dockerContainerId` (§6); einzige Ausnahme ist `CREATE`, dort entsteht sie erst und kommt im Ergebnis zurück. `CREATE_BACKUP`, `RESTORE_BACKUP`, `DOWNLOAD_BACKUP`, `DELETE_BACKUP` und `GET_STORAGE_BREAKDOWN` sind Dateisystem- und Job-Aufgaben (Arbeitspaket A3) und werden bis dahin mit `AGENT_COMMAND_NOT_IMPLEMENTED` beantwortet.

**`DOWNLOAD_BACKUP` (Ergänzung aus B5):** Der vollständige Export der Serverdaten (Lastenheft §3.3) verlangt, dass das Archiv eines Backups vom Homeserver zum Nutzer gelangt. Der Agent öffnet grundsätzlich keinen eigenen Listener (§18), es gibt also keinen zweiten Weg für diese Bytes. Der Befehl liest deshalb **blockweise**: das Backend fragt `{ offset, maxBytes }` an, bekommt `{ contentBase64, bytesRead, totalBytes, eof }` zurück und schreibt jeden Block sofort in die HTTP-Antwort. Damit braucht es weder einen neuen Frame-Typ noch ein mehrere Gigabyte großes Archiv im Speicher. Die Base64-Kodierung kostet rund ein Drittel Übertragungsvolumen; das ist bei einem selten genutzten Vorgang innerhalb des WireGuard-Tunnels vertretbar und wiegt leichter als ein zweiter Transportweg mit eigener Authentifizierung.

**`DELETE_BACKUP` (Ergänzung aus B5):** Die Aufbewahrungsregel aus Lastenheft §3.3 und das Löschen über den Storage-Explorer (§16) müssen das Archiv tatsächlich von der Platte bekommen; ohne diesen Befehl gäbe die Regel keinen Speicher frei. Der Befehl ist bewusst **idempotent** – ein bereits fehlendes Archiv wird als `removed: false` gemeldet, nicht als Fehler. Sonst bliebe nach einem Abbruch mitten in der Aufbewahrungsprüfung ein Datensatz zurück, der sich nie wieder löschen ließe.

`GET_STORAGE_BREAKDOWN` hat seit Arbeitspaket B8 bereits ein festgelegtes Wire-Format (`GetStorageBreakdownCommandPayload`/`-Result`, Zod-Gegenstück `getStorageBreakdownResultSchema` in `packages/validation/src/storage.ts`), weil das Backend die Antwort entgegennehmen, zwischenspeichern und ausliefern muss (§16). Ausgeführt wird der Befehl weiterhin von niemandem: Er steht unverändert **nicht** in `IMPLEMENTED_AGENT_COMMANDS`, der Agent antwortet also weiter mit `AGENT_COMMAND_NOT_IMPLEMENTED`, bis A3 den Scanner baut.

**`SET_SERVER_QUERY` (Ergänzung aus A3):** §9 verlangt eine „periodische Spielerabfrage durch den Agent" und einen bestandenen Health-Check vor `starting → running`. Beides braucht die Abfrage **auf dem Homeserver**: Nur dort ist der Spiel-Port ohne Umweg erreichbar, und eine spätere `gamedig`-Abfrage läuft je nach Spiel über UDP. Was abgefragt wird – Host-Port und Abfrageart – weiß dagegen ausschließlich das Backend (`GameTypeDefinition.query` aus §11, Portvergabe aus §2.4); der Agent kennt keine Spiele. Dieser Befehl übergibt diese Angaben je Server und ist **idempotent**: `target: null` beendet die Abfrage, ein erneuter Aufruf ersetzt das bestehende Ziel. Bewusst ein eigener Befehl und kein Anhängsel an `START`, damit das Backend die Ziele nach einem Verbindungsabriss ohne Serverneustart wieder setzen kann. Das Ergebnis meldet der Agent als `STATS_UPDATE` mit der Nutzlast `AgentServerQueryPayload` (`source: 'serverQuery'`) – kein eigenes Ereignis, weil das Backend den Aktivitätszeitpunkt für den Auto-Shutdown bereits aus `STATS_UPDATE` nachzieht.

**`REMOVE_STORAGE_ENTRY` (Ergänzung aus A3):** `GET_STORAGE_BREAKDOWN` meldet nur, was belegt ist. Ohne einen Befehl zum Entfernen gäbe es keinen Weg, ungenutzte Images oder verwaiste Daten wieder freizugeben – der Storage-Explorer aus §16 könnte nur zusehen. **Ob** ein Posten gelöscht werden darf, entscheidet unverändert allein das Backend (`classifyEntry()` in B8); der Agent führt aus. Datenordner von Servern sind hierüber grundsätzlich nicht löschbar (Lastenheft §3.8) – die Kategorie `serverData` fehlt schon im Nutzdaten-Typ. Der Befehl ist wie `DELETE_BACKUP` **idempotent**: Ein bereits verschwundener Posten wird als `removed: false` gemeldet, nicht als Fehler.

---

## 6. Datenmodell (Kernentitäten)

| Entität | Wesentliche Felder |
|---|---|
| `User` | id, displayName, isOwner, banned, createdAt |
| `AuthMethod` | userId, type (password/discord/steam/twitch), providerUserId, passwordHash, *(ergänzt in B1:)* providerDisplayName, providerAvatarUrl, mustChangePassword, totpSecret, totpConfirmedAt, createdAt, lastUsedAt |
| `Session` | userId, refreshTokenHash, deviceInfo, ipHint, createdAt, lastUsedAt, revokedAt, *(ergänzt in B1:)* previousRefreshTokenHash, expiresAt |
| `Role` | id, name, permissions[], isProtected |
| `UserRole` | userId, roleId |
| `GameServer` | id, ownerId, gameType, name, status, dockerContainerId, hostId, subdomain, assignedPorts, resourceLimits, configJson, autoShutdownEnabled, createdAt |
| `ServerMember` | serverId, userId, permissionLevel *(`viewer` / `operator` / `manager`, siehe §8)* |
| `Backup` | id, serverId, createdAt, sizeBytes, storagePath, type |
| `Schedule` | serverId, cronExpression, action, payload *(Backup-Zeitplan als `BackupScheduleDto`, allgemeine Aufgabenliste als `ServerTaskDto` – siehe §6-Hinweis unten)* |
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

**Owner-Eindeutigkeit:** „Genau ein Konto trägt diesen Status" (Lastenheft §2) ist nicht nur eine Anwendungsregel, sondern über einen partiellen Unique-Index in der Datenbank abgesichert (`users_single_owner_idx` auf `users(is_owner) WHERE is_owner`). Ein zweiter Owner wird dadurch bereits beim Schreiben abgelehnt.

**Fremdschlüssel `user_roles`:** Beide Spalten löschen mit (`ON DELETE CASCADE`) – wird ein Konto oder eine Rolle entfernt, verschwindet die Zuordnung mit; ein verwaister Eintrag hätte keine Bedeutung.

**Zwei Sichten auf `Schedule`:** Die Entität trägt beide Fälle aus Lastenheft §3.3. B5 führt den **Backup-Zeitplan** als `BackupScheduleDto` (`packages/contracts/src/schedule.ts`) – genau ein Datensatz je Server, ohne Namen, weil die Backup-Verwaltung nur diesen einen kennt. F3 zeigt im Reiter „Aufgaben" die **allgemeine Liste** benannter Aufgaben (nächtlicher Neustart, Konsolenbefehl) als `ServerTaskDto` (`packages/contracts/src/server-task.ts`). Beide nutzen denselben Aktionssatz `SCHEDULE_ACTIONS` und dasselbe `cronExpressionSchema`. Ob die beiden Sichten später zu einer zusammengeführt werden, entscheidet B3 beim Anschluss der Orchestrierung – bis dahin ist die Trennung bewusst und dokumentiert.

**Audit-Log-Aufbewahrung:** Einträge werden nie durch Admin-Aktionen verändert oder gelöscht (append-only). Ein separater, rein additiver Archivierungsprozess exportiert Einträge, die älter als 24 Monate sind, in eine komprimierte Archivdatei und entfernt sie anschließend aus der aktiven Tabelle – so bleibt das Datenbankwachstum kontrollierbar, ohne dass die Unveränderlichkeit während laufender Vorgänge aufgeweicht wird.

**Umsetzung im Backend (Arbeitspaket B8, `apps/backend/src/modules/admin`):** Die Unveränderlichkeit ist dreifach abgesichert. `AuditLogRepository` und `AuditService` kennen weder eine Update- noch eine allgemeine Delete-Operation – auch nicht für den Owner. Zusätzlich lehnt der Trigger `audit_log_append_only` (Migration `0005_admin_ports_audit_storage`) UPDATE, DELETE und TRUNCATE auf `audit_log` **in der Datenbank** ab; auch ein direkter `psql`-Zugriff kommt daran nicht vorbei. Einzige Ausnahme ist der Archivierungsprozess: Er weist sich über die Sitzungsvariable `palantir.audit_archive` aus (per `SET LOCAL`, gilt also nur innerhalb seiner Transaktion) und darf auch dann ausschließlich Einträge älter als 24 Monate entfernen – nachdem die Archivdatei geschrieben ist. Schlägt der Export fehl, bleibt die aktive Tabelle unverändert (`AUDIT_ARCHIVE_FAILED`). Angestoßen wird der Lauf über die Admin-Oberfläche oder `pnpm --filter @palantir/backend audit:archive`; der Ablageort steht in `AUDIT_ARCHIVE_DIR`.

**Handelnder eines Eintrags (festgelegt in R1):** `AuditLog.userId` und der mitgeschriebene Anzeigename kommen aus der Sitzung. Der `PermissionActor` aus §8 trägt bewusst keine Identität – für die Rechteberechnung braucht er sie nicht –, deshalb setzt das Auth-Modul die Identität beim Auflösen der Sitzung als `request.adminIdentity` und `contextFrom()` in `modules/admin/routes.ts` liest sie dort. Der Anzeigename wird als **Kopie** zum Zeitpunkt der Aktion festgehalten, damit der Eintrag lesbar bleibt, wenn das Konto später umbenannt wird oder verschwindet. Aufrufe ohne Sitzung – die Wartungs-Kommandos auf der VPS, die bereits Systemzugang voraussetzen – bleiben Systemeinträge mit `actorId: null`.

**Katalog der protokollierten Aktionen:** `packages/contracts/src/audit.ts` (`AUDIT_ACTIONS`), Benennungsschema wie bei den Events (`<domäne>.<vorgang>`, §14). Jedes Arbeitspaket ergänzt dort additiv die sicherheitsrelevanten Aktionen, die es selbst protokolliert – nie als Freitext am Aufrufort.

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

**Ort der Auth-DTOs:** `packages/contracts/src/auth.ts` (`AccountDto`, `LoginResult`, `AltchaChallenge`, `AUTH_METHOD_TYPES`, `OAUTH_PROVIDERS`), Zod-Gegenstück in `packages/validation/src/auth.ts` (Eingabe-Schemas für Login, Registrierung und 2FA sowie die Antwort-Schemas). Festlegungen dieser Sitzung, die das Pflichtenheft offen ließ:

- **2FA als Zwischenschritt, nicht als Fehler:** Der Login antwortet mit `status: 'two_factor_required'` und einem kurzlebigen `twoFactorToken` (kein Access-Token). Erst der zweite Schritt legt die Sitzung an. Ein *falscher* Code ist dagegen ein Fehler (`AUTH_TWO_FACTOR_INVALID`), ein abgelaufener Zwischen-Token ebenfalls (`AUTH_TWO_FACTOR_EXPIRED`).
- **Wartezustand als eigenes Feld:** `AccountDto.awaitingApproval` sagt, ob das Konto noch auf die Freischaltung durch einen Admin wartet (Lastenheft §3.1). Bewusst ein serverseitig gesetztes Feld statt eines Rückschlusses aus Rollenname oder leerem `permissions`-Objekt – sonst läge die Auslegung im Frontend (§5.2).
- **Passwortlänge:** Mindestens 12 Zeichen (siehe oben), höchstens 200 – die Obergrenze begrenzt nur die Rechenzeit von Argon2id und ist kein Sicherheitsmerkmal.

Festlegungen des Backend-Arbeitspakets B1, die darauf aufbauen (Modul `apps/backend/src/modules/auth`):

- **Benutzername und Anzeigename getrennt:** `users.username` ist die Anmeldekennung des Passwort-Verfahrens und über einen partiellen Unique-Index auf `lower(username)` eindeutig; bei reinen Provider-Konten ist sie `null`. `users.display_name` bleibt frei wählbar und muss nicht eindeutig sein. Kollidiert ein vom Provider gelieferter Anzeigename, bleibt er trotzdem stehen – eindeutig sein muss nur der Benutzername.
- **Token-Lebensdauern:** aus der zentralen `.env` (`JWT_ACCESS_TOKEN_TTL`, Standard 15 Minuten; `REFRESH_TOKEN_TTL`, Standard 30 Tage). Das Access-JWT wird mit HS256 gegen `JWT_SECRET` signiert und trägt nur `sub`, `sid` (Sitzung), `iat` und `exp` – keine Rollen oder Permissions, damit ein Rechteentzug nicht bis zum Ablauf des Tokens nachwirkt. Jeder Request prüft die Sitzung zusätzlich gegen die Datenbank; erst dadurch wirkt ein Remote-Logout sofort.
- **2FA-Zwischen-Token:** derselbe HS256-Schlüssel, aber ein eigener Verwendungszweck im Token (`purpose`) und eine Lebensdauer von 5 Minuten. Er erlaubt ausschließlich den zweiten Anmeldeschritt und taugt an keiner anderen Route als Nachweis.
- **Refresh-Token:** 32 zufällige Bytes, Base64url-kodiert, in der `Session`-Tabelle ausschließlich als SHA-256-Hash. Bewusst SHA-256 statt Argon2id: der Token hat volle Zufalls-Entropie, dort schützt ein langsamer Hash vor nichts, und die Prüfung liegt auf jedem Refresh-Request. Bei jedem Refresh wird der Token ersetzt (Rotation); der ersetzte Hash bleibt als `previousRefreshTokenHash` stehen, damit ein bereits ersetzter Token wiedererkennbar bleibt. Taucht er erneut auf, werden **alle** Sitzungen des Kontos widerrufen – das ist das typische Bild eines gestohlenen Tokens.
- **Cookies:** `palantir_access` (httpOnly, Pfad `/`), `palantir_refresh` (httpOnly, Pfad `/auth` – außerhalb der Anmelde-Routen wird er gar nicht erst mitgeschickt) und `palantir_csrf` (lesbar, Pfad `/`). Alle drei `Secure` und `SameSite=Lax`; das `Secure`-Flag ist über `COOKIE_SECURE` abschaltbar, ausschließlich für lokale Entwicklung ohne TLS.
- **CSRF-Verfahren:** Double-Submit. Der Wert aus `palantir_csrf` muss bei jedem zustandsändernden Request im Header `x-csrf-token` stehen; verglichen wird in konstanter Zeit. Ausgenommen sind `/auth/register` und `/auth/login` – dort existiert noch keine Sitzung, die sich missbrauchen ließe. Die Namen stehen als `CSRF_COOKIE_NAME`/`CSRF_HEADER_NAME` im Vertrag.
- **OAuth-`state`:** vom Backend erzeugter Zufallswert, abgelegt in einem kurzlebigen, signierten httpOnly-Cookie (10 Minuten) und beim Rückkehr-Aufruf gegen den Parameter verglichen; danach wird das Cookie gelöscht. Der Zwischenzustand gilt nur für den Provider, für den er gesetzt wurde. Für Discord und Twitch kommt PKCE (S256) dazu, der Verifier liegt im selben Cookie. Steam nutzt OpenID 2.0 und kennt kein PKCE – dort hängt der `state` am `openid.return_to`, wird von Steam mitsigniert und die Rückkehr zusätzlich über `check_authentication` bestätigt.
- **Minimale Scopes:** Discord bekommt ausschließlich `identify` (Id, Name, Avatar – keine E-Mail, keine Gilden), Twitch wird ohne Scope angefragt (`/helix/users` liefert das eigene Konto auch dann), Steam kennt über OpenID gar keine Scopes; Profilname und Avatar holt ein rein lesender Aufruf mit dem Web-API-Key.
- **2FA-Wiederherstellung:** bewusst **keine** Einmal-Wiederherstellungscodes. Verliert ein Nutzer seinen Authenticator, schaltet ein Konto mit `user.manage` die 2FA im Nutzerpanel ab – derselbe Weg wie beim Passwort-Reset (Lastenheft §3.1, bewusst ohne E-Mail-Versand). Das erspart einen zweiten Weg an der 2FA vorbei und Codes, die verloren gehen können. Das Zod-Schema `twoFactorCodeSchema` lässt längere Codes bereits zu; das Backend nimmt in Version 1 ausschließlich sechsstellige TOTP-Codes an (`totpCodeSchema`).
- **Passwort-Reset durch den Admin:** das Backend erzeugt ein kryptografisch zufälliges Einmal-Passwort, liefert es genau einmal in der Antwort an den Admin aus und speichert es nirgends im Klartext. Das Konto steht danach auf `mustChangePassword`; bis zur Änderung lehnt das Backend zustandsändernde Requests mit `AUTH_PASSWORD_CHANGE_REQUIRED` ab. Alle Sitzungen des Kontos werden dabei widerrufen.
- **TOTP-Geheimnis:** liegt unverschlüsselt an der Passwort-`AuthMethod`. Es ist kein zweiter Passwort-Ersatz: Wer Lesezugriff auf die Datenbank hat, kommt damit an den zweiten Faktor, aber nicht am Argon2id-Passwort-Hash vorbei. Eine zusätzliche Verschlüsselung mit einem Schlüssel aus derselben `.env` würde denselben Angreifer nicht aufhalten und nur Komplexität hinzufügen.
- **Konto-Löschung:** löscht den Datensatz samt `AuthMethod`-, `Session`- und `UserRole`-Einträgen (`ON DELETE CASCADE`). Das Owner-Konto kann sich nicht selbst löschen (`AUTH_OWNER_PROTECTED`, Lastenheft §2).

Nachgezogen im Arbeitspaket R5 (ALTCHA beim Login):

- **ALTCHA auch am Login-Formular:** `LoginView` bindet dasselbe `AltchaWidget` ein wie die Registrierung; `loginInputSchema` verlangt das Feld `altcha` seither verpflichtend (Breaking Change an `packages/validation`, zuvor `optional()`). Fehlt es, antwortet der Login mit `AUTH_CAPTCHA_INVALID` statt mit `AUTH_INVALID_CREDENTIALS` – die Meldung soll auf das richtige Feld zeigen.
- **Jeder Nachweis zählt genau einmal:** Der Server führt über eingelöste Lösungen ein Verzeichnis im Arbeitsspeicher (`AltchaSolutionLedger`), Schlüssel ist die Challenge, Ablage bis zum Ablauf der Challenge. Ohne diese Sperre könnte eine einmal geleistete Rechenarbeit bis zum Ablauf an beliebig viele weitere Anmeldeversuche gehängt werden – der Proof-of-Work würde dann nur den ersten Versuch verteuern. Registrierung und Login teilen sich ein Verzeichnis. Wie beim IP-Rate-Limit bewusst ohne Datenbank/Redis: eine Backend-Instanz auf einer VPS (§1); ein Neustart verliert die Einträge, die offenen Challenges laufen ohnehin binnen `ALTCHA_EXPIRY_SECONDS` ab.
- **Kein ALTCHA am zweiten Anmeldeschritt:** `/auth/login/2fa` bleibt beim IP-Rate-Limit. Dorthin kommt nur, wer im ersten Schritt bereits einen Nachweis eingelöst **und** gültige Zugangsdaten gezeigt hat; eine zweite Aufgabe würde dort nichts zusätzlich absichern.

---

## 8. RBAC / Permission-System

- Permissions als feste String-Konstanten (Auszug): `server.create`, `server.view.own`, `server.view.any`, `server.manage.own`, `server.manage.any`, `server.delete.own`, `server.delete.any`, `backup.manage.own`, `backup.manage.any`, `user.manage`, `role.manage`, `notification.manage`, `node.view`, `node.manage`, `address.manage`, `audit.view`, `message.moderate`, `gametype.manage`
- Hinweis: `gametype.manage` ist bereits Teil des Katalogs, bleibt in Version 1 aber ungenutzt (kein UI-Pfad davorgeschaltet, siehe Abgrenzung im Lastenheft) – vorbereitet für die Admin-Oberfläche zur Spiele-Verwaltung in Phase 3
- Rollen sind frei definierbare Bündel dieser Permissions; ein Nutzer kann mehrere Rollen haben, effektive Rechte = Vereinigung
- Seed-Rollen bei Ersteinrichtung: **Admin**, **Moderator**, **Nutzer** (vollständig editierbar); **Gast** als geschützte Systemrolle ohne jede Permission. Angelegt werden sie einmalig über `pnpm --filter @palantir/backend db:seed` direkt nach den Migrationen (siehe SETUP.md §2.4) – bewusst als eigenes Kommando statt beim Backend-Start, damit der Zeitpunkt für den Betreiber sichtbar bleibt. Der Lauf ist idempotent und verändert vorhandene Rollen nie.
- `User.isOwner`-Flag: unabhängig vom Rollensystem immer alle Permissions – verhindert Selbst-Aussperrung

**Vergabe des Owner-Status (Ersteinrichtung, festgelegt in R1):** Der Betreiber registriert sich über die reguläre Oberfläche und hebt dieses Konto anschließend einmalig über das Kommando `db:owner` zum Owner – auf der VPS als Compose-Dienst, lokal über pnpm (SETUP.md §2.5). Bewusst **nicht** „das erste registrierte Konto gewinnt": Die Registrierung ist offen (Lastenheft §3.1) und das Panel ab dem ersten Start erreichbar – ein Sicherheitsmerkmal, das an der Reihenfolge zweier HTTP-Requests hängt, ist keines. Bewusst auch kein Owner-Konto im Seed-Lauf: der bräuchte ein Passwort aus der `.env` oder aus der Konsolenausgabe und wäre ein zweiter Weg, ein Konto anzulegen, der an Registrierung, Passwortregeln und `AuthMethod` vorbeiliefe. Der Nachweis ist stattdessen der Systemzugang zur Maschine, auf der das Backend läuft – dasselbe Muster wie bei `db:migrate`, `db:seed` und `audit:archive`. Der Lauf ist idempotent, protokolliert `user.ownerGranted` im Audit-Log und lehnt ein zweites Owner-Konto mit `OWNER_ALREADY_EXISTS` ab; die eigentliche Zusicherung hält der partielle Unique-Index `users_single_owner_idx` (§6). Ein Weg, den Status wieder zu entziehen oder zu übertragen, existiert in Version 1 bewusst nicht.

**Ort des Katalogs:** `packages/contracts/src/permissions.ts` (`PERMISSION_CATALOG`) – dort steht jede Permission zusammen mit Beschreibung (für den Rollen-Editor) und Geltungsbereich (`own` / `any` / `global`). Neue Permissions werden ausschließlich dort additiv ergänzt und zusätzlich in der obigen Aufzählung nachgetragen.

**REST-Oberfläche der Rollenverwaltung (festgelegt in R6):** Die Routen liegen unter `/admin/roles` im Admin-Modul (B8), die Regeln bleiben im `RoleService` (B2):

| Route | Methode | Verlangt |
|---|---|---|
| `/admin/roles` | `GET` | `role.manage` **oder** `user.manage` |
| `/admin/roles/:roleId` | `GET` | `role.manage` **oder** `user.manage` |
| `/admin/roles` | `POST` | `role.manage` |
| `/admin/roles/:roleId` | `PATCH` | `role.manage` |
| `/admin/roles/:roleId` | `DELETE` | `role.manage` |
| `/admin/roles/:roleId/members/:userId` | `PUT` | `role.manage` **oder** `user.manage` |
| `/admin/roles/:roleId/members/:userId` | `DELETE` | `role.manage` **oder** `user.manage` |

Lesen und Zuweisen erlauben bewusst auch `user.manage`: Wer Konten freischaltet, muss die Rollen zur Auswahl auflisten und vergeben können, ohne sie bearbeiten zu dürfen. `PUT` statt `POST` beim Zuweisen, weil der Vorgang idempotent ist – eine bestehende Zuweisung führt zum selben Zielzustand, nicht zu einem Fehler; beide Mitglieder-Routen antworten mit der Rolle samt aktualisierter Mitgliederzahl (§5.2).

Rollenänderungen sind sicherheitsrelevant und landen im Audit-Log (§6): `role.created`, `role.updated` (mit dem Stand vor und nach der Änderung), `role.deleted` (mit Name, Rechtebündel und Mitgliederzahl – der Datensatz ist danach weg), `user.roleAssigned` und `user.roleRemoved`. Geschrieben werden sie im Admin-Modul und nicht im `RoleService`: Das Audit-Log gehört zu B8, und die Gegenrichtung B2 → B8 gäbe es sonst nirgends. Dieselbe Aufteilung nutzt die Freischalt-Warteliste.

**Auswertung von `.own`/`.any`:** Wer `<basis>.any` besitzt, darf den Vorgang bei jeder Ressource; wer nur `<basis>.own` besitzt, ausschließlich bei eigenen (bzw. solchen, bei denen er Mitglied ist). Die Paare sind in `SCOPED_PERMISSION_BASES` festgehalten, die Auswertung liegt an genau einer Stelle im Backend-Modul `apps/backend/src/modules/rbac`.

**Feldbenennung im Rollen-DTO (Abweichung von §6):** §6 nennt das Permission-Bündel der Entität `Role` schlicht `permissions`. Im DTO ist `permissions` jedoch durchgängig für das serverseitig berechnete Flags-Objekt aus §5.2 reserviert, damit sich das Frontend über alle DTOs hinweg darauf verlassen kann. Das Bündel heißt im `RoleDto` deshalb `grantedPermissions`; die Datenbankspalte bleibt `permissions`.

**Stufen der Mitgliederverwaltung (`ServerMember.permissionLevel`, §6):** Das Rollensystem gilt instanzweit; zusätzlich kann der Besitzer eines Servers einzelne Nutzer als Mitverwalter freigeben (Lastenheft §3.3). Die Stufen stehen als `SERVER_MEMBER_LEVELS` in `packages/contracts/src/server-member.ts` und sind bewusst grob geschnitten:

| Stufe | Bedeutung |
|---|---|
| `viewer` | Server sehen, Adresse sehen, Konsolenausgabe lesen – keine Aktionen |
| `operator` | zusätzlich starten, stoppen, neu starten und Konsolenbefehle senden |
| `manager` | zusätzlich Einstellungen, Dateien, Backups und Aufgaben – nicht löschen, klonen oder Mitglieder verwalten |

Löschen, Klonen, Exportieren und die Mitgliederverwaltung bleiben dem Besitzer und Konten mit der passenden `.any`-Permission vorbehalten. Die Stufe wird nie ins Frontend durchgereicht, um dort Rechte abzuleiten – das Backend übersetzt sie zusammen mit den Rollen-Permissions in die Flags aus `GameServerPermissions` (§5.2).

**Kontobezogenes `permissions`-Objekt:** Neben den ressourcenbezogenen Flags gibt es `GlobalPermissions` (`packages/contracts/src/permissions.ts`) für die instanzweiten Rechte des angemeldeten Nutzers (Navigation, Admin-Bereiche). Es hängt am Session-/Konto-DTO aus §7; das Frontend leitet nie selbst etwas aus Rollen ab.

---

## 9. Server-Lifecycle

**Zustände:** `creating → stopped → starting → running → stopping → stopped`, zusätzlich `error` und `crashed`

**Ort der Zustände und Übergänge:** `packages/contracts/src/server-lifecycle.ts` (`SERVER_STATUSES`, `SERVER_STATUS_TRANSITIONS`). Die Tabelle der erlaubten Übergänge steht bewusst in den Contracts, damit Backend (State Machine in B3) und Frontend (Bedienelemente ausgrauen, F3) dieselbe Auslegung sehen; verboten ist alles, was dort nicht steht. Der Agent meldet demgegenüber die beobachtbaren **Container**-Zustände (`AGENT_CONTAINER_STATUSES`) – die Zuordnung auf den Lifecycle-Zustand macht der Soll/Ist-Abgleich in B3.

**Mitgliedsstufen je Server** (Lastenheft §3.3, Entität `ServerMember`): `viewer` (sehen), `operator` (starten/stoppen/neu starten, Konsolenbefehle), `manager` (zusätzlich Einstellungen, Dateien, Backups, geplante Aufgaben). Löschen und Mitgliederverwaltung bleiben beim Besitzer. Festgehalten in `packages/contracts/src/server-member.ts`; die Stufe ergänzt das Rollensystem aus §8, ersetzt es nicht.

- `starting → running` erfolgt erst nach erfolgreichem Health-Check (Query via `gamedig` bzw. generischer Port-Connect-Test beim Test-Typ) – ein gestarteter Prozess allein reicht nicht
- Bei `crashed`: automatischer Neustart-Versuch mit begrenzter Anzahl an Wiederholungen innerhalb eines Zeitfensters (Crash-Loop-Schutz), danach `error` mit Benachrichtigung
- Auto-Shutdown: periodische Spielerabfrage durch den Agent; Schonfrist nach Start, konfigurierbarer Inaktivitäts-Timeout, pro Server deaktivierbar
- Ein automatischer Neustart nach Absturz zählt im Sinne der Auto-Shutdown-Schonfrist als regulärer Serverstart – verhindert, dass ein gerade wiederhergestellter Server sofort fälschlich als inaktiv erkannt und erneut abgeschaltet wird
- Klonen: erzeugt einen neuen `GameServer`-Datensatz mit kopierter Konfiguration und zwingend neuer, eigener Subdomain (gleiche Prüf-/Formatregeln wie bei Neuerstellung); Weltdaten werden optional synchron mitkopiert, Fortschritt wird im Frontend angezeigt

**Zeitgeber des Backends (Ergänzung aus R2):** Der Auto-Shutdown-Sweep und die fälligen Backup-Zeitpläne (Lastenheft §3.3) brauchen einen Takt. Beide Module bringen bewusst **keinen** eigenen Timer mit – sie bleiben dadurch ohne Wartezeit prüfbar, und ein Wartungs-Kommando kann denselben Ablauf anstoßen. Der Takt steht deshalb an genau einer Stelle: `apps/backend/src/scheduler.ts`. Intervall `SCHEDULER_INTERVAL_MS` (Vorgabe 60 Sekunden), weil beide Fälligkeiten minutengenau sind: Ein Cron-Ausdruck löst frühestens jede Minute aus, Inaktivitäts- und Schonfrist sind in Minuten konfiguriert. Dauert ein Durchlauf länger als das Intervall, wird der nächste **übersprungen** und nicht eingereiht – beide Aufgaben arbeiten nach Fälligkeitszeitpunkt, eingereihte Läufe würden sich bei einem hängenden Homeserver aufstauen und danach dieselben Befehle mehrfach schicken. Der Sweep läuft nur über Nodes mit offener Agent-Verbindung; ohne Verbindung ließe sich ohnehin kein Container stoppen.

---

## 10. Ressourcen- & Kapazitätsmanagement

- `UserResourceLimit` optional pro Nutzer (nullable = kein Limit)
- Vor jedem Start: harte Prüfung der tatsächlich freien Ressourcen der Ziel-VM gegen die angeforderten Limits des Servers – unabhängig vom Nutzer-Kontingent
- Ressourcen-Warnungen (Event `resource.low`) bei konfigurierbaren Schwellwerten (Server- und Node-Ebene)

**Eine Quelle für die Belegung (Ergänzung aus R2):** Die Belegung einer Node wird an genau einer Stelle gezählt – `ServerUsageRepository` (Schnittstelle in `modules/resources/ports.ts`, Umsetzung über `game_servers` in `modules/server-orchestration/usage-repository.ts`). Aus derselben Zählung wird auch `HostNodeDto.usage` der Node-Übersicht gefüllt (`modules/resources/node-usage.ts`), damit Anzeige und Startprüfung nicht auseinanderlaufen können. **Abweichung, bewusst:** `HostNodeUsage` ist in Lastenheft §3.7 als *gemessene* Auslastung beschrieben; geliefert wird die *reservierte*. Ein echter Messwert müsste vom Agent kommen, und §5.3 kennt bislang nur `GET_STATS` je Container, keinen node-weiten Wert. Bis zu einer Protokoll-Erweiterung gilt die Reservierung als obere Schranke – sie überschätzt eher, und das ist bei einer Auslastungsanzeige die richtige Richtung. Vermerkt in WORK_STATUS.md unter „Gefundene Punkte" (68).

---

## 11. Spiele-Registry

- `GameTypeDefinition` kapselt alles Spielspezifische: Docker-Image, Standard-Umgebungsvariablen, editierbares Config-Schema fürs Frontend, Standard-Ports, Ressourcen-Empfehlung, Query-Typ (für `gamedig`), Icon, Flag für Hostname-Routing-Fähigkeit
- **Ort des Typs:** `packages/contracts/src/game-type.ts` (`GameTypeDefinition`, `GameTypeDto`, `GameQuerySpec`, `GameConfigField`). Die konkreten Definitionen liegen als Registry im Backend (`apps/backend/src/modules/server-orchestration/game-registry.ts`) – neue Spiele werden dort per Code ergänzt. `GameTypeDto` liefert dem Frontend bewusst nicht `dockerImage`, `defaultCommand`, `defaultEnv` und `dataVolumeContainerPath`: das sind Betriebsinterna des Homeservers.
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
- `SETUP.md`: Schritt-für-Schritt-Anleitung – VPS vorbereiten, `.env` ausfüllen, OAuth-Apps bei Discord/Twitch/Steam anlegen (inkl. Redirect-URI-Konfiguration passend zur Domain), WireGuard zwischen VPS und Homeserver einrichten, Homeserver-VM vorbereiten, `docker compose up` auf beiden Seiten, Ersteinrichtung des Owner-Accounts (§8, umgesetzt in SETUP.md §2.5)

---

## 13. Domain- & Subdomain-Routing

- Nutzer wählt beim Erstellen eines Servers eine eigene Subdomain (Verfügbarkeitsprüfung, Formatvalidierung, gesperrte reservierte Namen wie `www`, `api`, `admin`, `vpn`, `mail`)
- **Ort der Regeln:** `packages/contracts/src/subdomain.ts` (`SUBDOMAIN_PATTERN`, Längengrenzen, `RESERVED_SUBDOMAINS`), Zod-Gegenstück `subdomainSchema` in `packages/validation/src/server.ts`. Format und Sperrliste prüfen Frontend und Backend mit demselben Schema; die Verfügbarkeit gegen die Datenbank prüft ausschließlich das Backend (`SUBDOMAIN_TAKEN`). Die Sperrliste geht über die fünf im Absatz genannten Namen hinaus und enthält zusätzlich die von dieser Installation selbst belegten Namen sowie die Namen, die Mail- und Zertifikatsprüfungen erwarten (`autodiscover`, `mx`, `ns1`, …) – ein Nutzer, der sich einen davon sichert, würde sonst den Mailversand der Domain stören.
- Backend legt automatisch den passenden DNS-Eintrag über die Cloudflare-API an (Token beschränkt auf DNS-Bearbeitungsrecht)
- Minecraft: DNS-Eintrag zeigt auf den Hostname-Routing-Proxy (ein öffentlicher Port für alle Instanzen)
- Andere Spiele: DNS-Eintrag zeigt auf die VPS-IP, Port bleibt für den Spieler sichtbar/einzugeben
- Web-Domain (Frontend/API) kann zusätzlich hinter Cloudflare als CDN/WAF laufen; Spiele-Subdomains müssen auf "DNS only" stehen, da Cloudflares Standardprodukt kein rohes TCP/UDP-Spieleprotokoll proxied

---

## 14. Notification-Engine

- Internes Event-System (`server.started`, `server.stopped`, `server.crashed`, `backup.failed`, `autoShutdown.triggered`, `resource.low`, `user.registered`, `message.reported`, ...)
- Reine Live-Ereignisse des Browser-Kanals (§5.3), die **keine** Benachrichtigung auslösen, sondern nur eine offene Ansicht aktuell halten: `server.statusChanged`, `server.statsUpdated`, `server.consoleLineAppended`, `serverClone.progressed`. Sie stehen im selben Katalog `WEBSOCKET_EVENTS`, sind aber bewusst kein Anlass für eine `NotificationRule`.
- **Ergaenzungen aus B3 (Server-Orchestrierung, §9):** `server.created`, `server.deleted`, `server.restarted`, `server.failed` (Zustand `error` erreicht - im Gegensatz zu `server.crashed`, das ein automatisch behebbarer Einzelabsturz ist) und `server.cloned`. Den Zustandswechsel meldet weiterhin `server.statusChanged`, den Fortschritt beim Klonen `serverClone.progressed` - beide aus F3.
- **Ergänzungen aus B7 (Chat & Moderation, §15):** `message.sent`, `message.deleted` und `conversation.created`. Sie fließen ausschließlich über den Chat-Kanal des Browsers (`packages/contracts/src/chat.ts`) und halten eine offene Ansicht aktuell – wie die Live-Ereignisse der Server-Ansicht sind sie bewusst **kein** Anlass für eine `NotificationRule`. Anlass für eine Benachrichtigung bleibt allein `message.reported`.
- **Benennungsschema:** `<domäne>.<vorgang>`, beide Segmente lowerCamelCase, genau ein Punkt als Trenner. Als Typ festgehalten in `packages/contracts/src/events.ts` (`WEBSOCKET_EVENTS`, `WebSocketEventName`); neue Events werden dort und in dieser Liste additiv ergänzt.
- `NotificationChannel` (aktuell: Discord-Webhook) getrennt von `NotificationRule` (Event → Kanal → Empfängerkreis), beides über Admin-Oberfläche konfigurierbar

**Ergänzungen aus B6 (Notification-Engine):** `announcement.published` (systemweite Ankündigung durch einen Admin, Lastenheft §3.6) als auslösendes Ereignis und `notification.created` als reines Live-Ereignis des Inbox-Kanals. Letzteres ist bewusst **kein** Anlass für eine `NotificationRule` – sonst löste jede Zustellung die nächste aus.

**Dringlichkeit:** `NotificationRuleDto.severity` ist `null`-fähig und bedeutet dann „die des Ereignisses" (`backup.failed` → `error`, `server.started` → `info`). Ein fester Vorgabewert an der Regel würde ein fehlgeschlagenes Backup still auf „Information" herabstufen; eine gesetzte Dringlichkeit ist deshalb ein bewusstes Überschreiben.

**Auslösende Ereignisse gegen reine Live-Ereignisse:** Welche Namen des Katalogs eine Regel auslösen dürfen, steht als Liste `NOTIFIABLE_EVENTS` in `packages/contracts/src/notifications.ts`. Ein Test dort hält beide Mengen überschneidungsfrei; das Backend lehnt eine Regel auf ein Live-Ereignis mit `NOTIFICATION_EVENT_NOT_NOTIFIABLE` ab.

**Umsetzung im Backend (Arbeitspaket B6, `apps/backend/src/modules/notifications`).** Festlegungen dieser Sitzung, die das Pflichtenheft offen ließ:

- **Kanal ist Ergänzung, nicht Voraussetzung:** Die Zustellung in die Inbox des Panels hängt nicht am Kanal. Eine Regel mit `channelId: null` schreibt ausschließlich in die Inbox, eine Regel mit Kanal zusätzlich nach außen. Ohne diese Trennung erreichte ein Ereignis niemanden, solange kein Discord-Webhook eingerichtet ist.
- **Empfängerkreis** als feste Aufzählung `NOTIFICATION_RECIPIENT_SCOPES`: `resourceOwner` (Besitzer der betroffenen Ressource), `serverMembers` (Besitzer und Mitverwalter aus `ServerMember`), `role` (alle Träger einer Rolle – so entsteht „alle Admins“ ohne einen zweiten Admin-Begriff neben §8) und `allUsers`.
- **Webhook-URL bleibt Geheimnis:** Der Standardkanal einer Instanz nutzt `DISCORD_WEBHOOK_URL` aus der zentralen `.env` (§12.1) und speichert nichts in der Datenbank. Trägt ein Admin für einen weiteren Kanal eine eigene URL ein, wird sie gespeichert, aber **nie** in einem DTO ausgeliefert – ausgeliefert wird nur eine gekürzte, nicht wiederherstellbare Kurzform (`NotificationChannelTarget.hint`).
- **Fehlgeschlagene Zustellung ist ein Endzustand, kein Fehler:** Ein nicht erreichbarer Webhook lässt den auslösenden Vorgang (Serverstart, Backup) nie scheitern. Der Versuch wird stattdessen in `notification_deliveries` protokolliert (`NotificationDeliveryDto`), damit die Fehlzustellung nicht still bleibt. `NOTIFICATION_DELIVERY_FAILED` erscheint ausschließlich dort, wo jemand die Zustellung selbst angestoßen hat: bei der Testnachricht eines Admins.
- **Live-Kanal der Inbox:** eigener WebSocket-Kanal (§5.3 nennt „Kanäle“ im Plural), Frames als `NotificationClientFrame`/`NotificationServerFrame` in `packages/contracts/src/notifications.ts`. Bewusst getrennt vom Server-Kanal aus `server-live.ts`: Der abonniert eine einzelne Ressource, die Inbox hängt am angemeldeten Konto und soll unabhängig von der angezeigten Seite offen sein. Der Empfänger kommt aus der Sitzung, nicht aus einem Frame-Feld – eine fremde Inbox lässt sich damit nicht abonnieren.
- **Systemweite Ankündigungen erreichen jedes Konto ohne Regel:** `publishAnnouncement()` schreibt direkt in die Inbox aller freigeschalteten Konten. Eine Wartungsmeldung, die niemanden erreicht, weil ein Admin keine Regel angelegt hat, wäre genau der stille Ausfall, den Lastenheft §3.6 nicht meint. Regeln auf `announcement.published` laufen zusätzlich und tragen den externen Kanal; doppelte Inbox-Meldungen verhindert der Unique-Index `notifications_announcement_user_idx`.
- **Die Inbox gehört dem Empfänger.** Ihre Routen (`GET /notifications`, `POST /notifications/read`, `DELETE /notifications/:id`) verlangen eine Sitzung, aber keine Permission; die Zuordnung macht die Konto-Id. Auch ein Admin markiert oder löscht keine fremde Meldung – dieselbe Zurückhaltung wie bei privaten Nachrichten (Lastenheft §3.6). Die Verwaltung (`/admin/notification-channels`, `/admin/notification-rules`, `/admin/announcements`, `/admin/notification-deliveries`) hängt dagegen an `notification.manage` (§8).
- **Live-Kanal:** `GET /live/notifications` (WebSocket). Eine Verbindung ohne gültige Sitzung wird mit Close-Code 4401 beendet – wie beim Agent-Kanal (§2.2), damit das Frontend „nicht angemeldet" von „Backend gerade weg" unterscheiden kann.
- **Neue Tabellen:** `notification_channels`, `notification_rules`, `notifications`, `announcements`, `notification_deliveries` (Migration `0010_notifications`).
- **Neue Konfigurationswerte** (.env.example Abschnitt 10): `DISCORD_WEBHOOK_URL` (bereits vorhanden, jetzt vom Backend gelesen) und `NOTIFICATION_DELIVERY_TIMEOUT_MS`.

---

## 15. Chat & Moderation

- `Conversation` (DM oder Server-Chat), `Message`, `MessageReport`
- Server-Chat entsteht automatisch mit dem Server, Teilnehmerkreis folgt `ServerMember`
- Moderation ausschließlich reaktiv über Meldungen, kein genereller Admin-Zugriff auf private Nachrichteninhalte
- Moderationsaktionen werden im Audit-Log erfasst

**Vertrag (Arbeitspaket B7, `packages/contracts/src/chat.ts`):** DTOs für Konversation, Nachricht und Meldung, die Grenzwerte (`MESSAGE_MAX_LENGTH`), die beiden Moderationsentscheidungen (`MESSAGE_MODERATION_ACTIONS`) und die Frames des Chat-Kanals; Zod-Gegenstück in `packages/validation/src/chat.ts`.

Festlegungen dieser Sitzung, die das Pflichtenheft offen ließ:

- **Was ein Moderator sieht,** steht abschließend in `ReportedMessageDto`: genau die gemeldete Nachricht mit Absender und Zeitstempel, dazu Art der Konversation (`dm`/`server_chat`) und – nur beim Server-Chat – die `serverId`. Kein Verlauf davor oder danach, keine Teilnehmerliste einer DM, keine Suche über Nachrichten. Es gibt bewusst keinen DTO und keinen Endpunkt, über den mehr erreichbar wäre.
- **Moderationsentscheidungen** sind `dismiss` (Meldung verwerfen) und `deleteMessage` (Nachricht entfernen). Eine Kontosperre gehört nicht dazu: Sie ist Nutzerverwaltung und läuft über `user.manage` (§8), sonst käme `message.moderate` an das Rechtekonzept heran.
- **Gelöschte Nachrichten** bleiben mit `deletedAt` im Verlauf stehen und werden mit leerem Inhalt ausgeliefert; der Inhalt zum Zeitpunkt der Meldung bleibt allein an der Meldung erhalten, damit eine getroffene Entscheidung nachvollziehbar bleibt.
- **Live-Kanal:** eigener WebSocket-Endpunkt je angemeldetem Konto, ohne `subscribe`-Frame – das Backend stellt die Ereignisse aller Konversationen zu, an denen das Konto teilnimmt. Ein Abonnement je Konversation ginge nicht: Eine neu entstandene DM ließe sich nicht abonnieren, bevor man von ihr weiß.
- **Gesendet wird über REST**, zugestellt über den Kanal. Zwei Wege für denselben zustandsändernden Vorgang hätten zwangsläufig zwei Regelsätze.
- **Der Server-Chat entsteht beim ersten Zugriff** auf den Server-Chat eines Servers, nicht beim Anlegen des Servers – fachlich derselbe Effekt („entsteht automatisch mit dem Server"), aber ohne Eingriff in die Server-Orchestrierung (B3). `ChatService.ensureServerConversation()` steht bereit, falls B3 ihn später beim Anlegen aufrufen will.

---

## 16. Speicherverwaltung (Storage-Explorer)

- Agent-Befehl `GET_STORAGE_BREAKDOWN`: liefert Größen von Server-Datenordnern, Backups, Docker-Images (inkl. Nutzungsstatus) und nicht zuordenbaren Daten
- Scan erfolgt on-demand (nicht dauerhaft im Hintergrund), Ergebnis wird mit Zeitstempel zwischengespeichert
- Löschbar über die Oberfläche: Backups, ungenutzte Docker-Images, eindeutig verwaiste Daten
- Aktive Server-Datenordner sind hierüber nicht löschbar (nur über den dedizierten Server-Löschen-Vorgang)

**Umsetzung im Backend (Arbeitspaket B8, `apps/backend/src/modules/admin/storage.ts`):** Der Agent meldet nur, was auf der Platte liegt und ob es benutzt wird; ob ein Posten gelöscht werden darf, entscheidet ausschließlich das Backend – an genau einer Stelle (`classifyEntry()`) – und liefert das Ergebnis als `permissions.canDelete` samt benanntem `deleteBlockedReason` mit. Der zwischengespeicherte Scan enthält bewusst die **rohe** Antwort des Agents: Die Bewertung passiert bei jedem Abruf neu, weil sie vom aktuellen Datenbestand abhängt und nicht vom Zeitpunkt des Scans.

Die Regel ist restriktiv ausgelegt: Ein Datenordner, dessen Server das Backend nicht kennt, gilt **nicht** automatisch als verwaist, sondern landet in der Kategorie `other` und bleibt gesperrt (`notClearlyOrphaned`). Verwaist ist nur, was der Agent selbst als verwaist meldet. Ohne diese Auslegung wäre bei unvollständiger Serverliste jeder Datenordner löschbar.

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
