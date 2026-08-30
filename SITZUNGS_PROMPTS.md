# Sitzungs-Prompts für die parallelen Arbeitspakete

Für jedes Arbeitspaket aus [STRUKTUR.md](STRUKTUR.md) steht hier ein fertiger Start-Prompt.
**Nutzung:** Den Block des gewünschten Pakets vollständig kopieren und unverändert in eine
neue Claude-Code-Sitzung im Repo-Root einfügen.

Jeder Prompt ist eigenständig – es muss nichts ergänzt werden.

**Inhalt**

- Vorarbeit: [F0 – Fundament](#f0--fundament-contracts-basis--drizzle)
- Backend: [B1](#b1--auth--identity) · [B2](#b2--rbac--permissions) · [B3](#b3--server-orchestrierung) · [B4](#b4--ressourcen--kapazität) · [B5](#b5--backup-verwaltung) · [B6](#b6--notification-engine) · [B7](#b7--chat--moderation) · [B8](#b8--admin-funktionen)
- Agent: [A1](#a1--core-verbindung) · [A2](#a2--container-runtime) · [A3](#a3--jobs--scheduler)
- Frontend: [F1](#f1--auth--onboarding) · [F2](#f2--shared-ui--design-system) · [F3](#f3--server-übersicht--lifecycle) · [F4](#f4--meine-backups) · [F5](#f5--nachrichtenchat) · [F6](#f6--benachrichtigungen) · [F7](#f7--nodes-nutzeransicht) · [F8](#f8--arcade) · [F9](#f9--skins) · [F10](#f10--admin-kernbereich) · [F11](#f11--admin-spiele-verwaltung)
- Integration (Welle 2.5): [R1](#r1--ersteinrichtung--identität) · [R2](#r2--verdrahtung-im-backend) · [R3](#r3--datenbank-integrität) · [R4](#r4--frontend-fundament) · [R5](#r5--altcha-beim-login)

---

## Reihenfolge und Parallelität

Abgeleitet aus den Abhängigkeiten in [STRUKTUR.md](STRUKTUR.md).

| Welle                   | Sitzungen (parallel)                                                           | Voraussetzung                                       |
| ----------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| **0 – Fundament**       | **F0** ‖ **F2**                                                                | –                                                   |
| **1 – Verträge & Kern** | **B2** ‖ **A1** ‖ **A2**                                                       | F0 gemergt                                          |
| **2 – Backend-Breite**  | **B1** ‖ **B3** ‖ **B4** ‖ **B5** ‖ **B8** (+ **F1**, **F3**, sobald F2 steht) | Welle 1 gemergt                                     |
| **2.5 – Integration**   | **R1** ‖ **R2** ‖ **R3** ‖ **R4** ‖ **R5**                                     | Welle 2 gemergt                                     |
| **3 – Rest**            | **B6** ‖ **B7** ‖ **A3** ‖ **F4** ‖ **F5** ‖ **F6** ‖ **F7** ‖ **F10**         | A3 braucht A1 + A2; **F4–F11 brauchen R4**          |
| **4 – Nachzügler**      | **F8** ‖ **F9** ‖ **F11**                                                      | F9 und F11 brauchen `PhaseLockedPlaceholder` aus F2 |

**F2 startet in Welle 0 und läuft weiter**, weil es zehn Frontend-Pakete blockiert und das
längste Frontend-Paket ist. **F8 (Arcade)** ist unabhängig und kann jederzeit dazwischen
laufen, wenn eine Sitzung frei ist.

**Nicht gleichzeitig:**

- **Zwei PRs an `packages/contracts`.** Die müssen nacheinander gemergt werden, sonst
  kollidieren B2, A1 und A2 in derselben Datei.
- **Die Backend↔Agent-Protokolländerung** gehört genau einer Sitzung – Vorschlag: A1.
  B3 und A2 arbeiten parallel, aber gegen den von A1 gemergten Vertrag.
- Praktisch: **mehr als 3–4 Sitzungen gleichzeitig** lohnt selten, weil der Engpass das
  eigene PR-Review wird, nicht die Entwicklung.

**Dateien mit garantierten Konflikten:** `WORK_STATUS.md` und `.env.example` fasst jede
Sitzung an, bei Backend-Paketen zusätzlich `apps/backend/src/server.ts`
(Routen-Registrierung). Konflikte sind trivial lösbar – vor jedem Push
`git pull --rebase`, und immer nur die eigene Zeile bzw. den eigenen Block anfassen.

---

# Vorarbeit

## F0 – Fundament (Contracts-Basis & Drizzle)

> Dieses Paket steht **nicht** in STRUKTUR.md. Es schließt die zwei Lücken, die das
> Grundgerüst offen gelassen hat (Punkte 1 und 3 unter „Gefundene Punkte" in
> `WORK_STATUS.md`): `packages/contracts` ist leer, und es gibt noch kein Drizzle-Setup.
> Ohne diese Vorarbeit erfindet jede Backend-Sitzung eigene Parallelstrukturen – genau das,
> was CLAUDE.md §3 verbietet. Umfang: eine kurze Sitzung.

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung, besonders §3 und §6)
- PFLICHTENHEFT.md (technisches Umsetzungskonzept, besonders §4, §5, §6, §12.1)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (fachliche Anforderungen, zur Einordnung)

Dein Arbeitspaket: F0 – Fundament (Contracts-Basis & Drizzle)
Dieses Paket steht bewusst nicht in STRUKTUR.md. Es legt die gemeinsame Grundlage, auf der
alle Backend-, Agent- und Frontend-Pakete aufbauen, und ist absichtlich klein gehalten.

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob F0 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter.
2. Lege einen eigenen Branch an: git checkout -b f0/fundament (ausgehend vom aktuellen
   main). Niemals direkt auf main arbeiten.
3. Setze die Zeile "F0 – Fundament" in WORK_STATUS.md auf Status "in Bearbeitung", trage
   den Branch und das heutige Datum ein, und committe das als eigenen ersten Commit.

Halte WORK_STATUS.md danach laufend aktuell und setze die Zeile am Ende auf "fertig".
Setze außerdem die Punkte 1 und 3 unter "Gefundene Punkte" auf "erledigt", sobald sie
erledigt sind.

Inhalt des Arbeitspakets:

A) packages/contracts – nur die Basis, keine fachlichen DTOs:
   - Response-Envelope exakt nach Pflichtenheft §5.1:
     { success: boolean, data: T | null, error: { code: string, message: string } | null }
     inklusive kleiner Hilfsfunktionen zum Erzeugen von Erfolgs- und Fehlerantworten.
   - Fehlercode-Katalog als typisierte Konstanten mit HTTP-Status-Zuordnung. Startsatz aus
     dem Pflichtenheft: AUTH_INVALID_CREDENTIALS, RESOURCE_LIMIT_EXCEEDED, SUBDOMAIN_TAKEN.
     Der Katalog ist bewusst wachsend – lege ihn so an, dass spätere Pakete ihre Codes
     additiv ergänzen können.
   - Benennungsschema für WebSocket-Events als Typ festhalten, passend zu den bereits
     definierten Events (server.started, server.stopped, server.crashed, backup.failed,
     autoShutdown.triggered, resource.low, user.registered, message.reported).
     Nur das Schema und die bereits im Pflichtenheft genannten Namen – keine neuen erfinden.
   - Den Typ des permissions-Objekts NICHT hier festlegen: der gehört zu B2 (RBAC) und
     kommt in einem eigenen, kleinen PR aus dieser Sitzung.

B) packages/validation:
   - Nur die Grundstruktur und ggf. gemeinsame Basis-Schemas (z. B. ID-Format), die alle
     Pakete brauchen. Keine fachlichen Schemas.

C) Drizzle-ORM-Setup:
   - Drizzle ORM und Drizzle Kit als Abhängigkeiten im Backend aufnehmen
   - drizzle.config.ts, Migrationsverzeichnis, Datenbank-Client, der DATABASE_URL aus der
     zentralen .env liest
   - pnpm-Skripte für Migration erzeugen und anwenden
   - KEINE fachlichen Tabellen anlegen. Jedes Arbeitspaket bringt seine eigenen Entitäten
     als eigene Migration mit. Lege höchstens eine leere Initial-Migration an, damit die
     Kette startet.
   - Prüfe, dass eine Migration tatsächlich gegen die konfigurierte Datenbank durchläuft –
     nicht nur, dass der Code kompiliert.

D) Health-Endpunkt umstellen:
   - apps/backend/src/routes/health.ts formt den Envelope aktuell lokal (inline). Stelle
     ihn auf den Typ aus @palantir/contracts um und entferne den TODO(contracts)-Kommentar.

Verbindliche Vorgaben:
- Halte den Umfang klein. Alles, was fachlich zu einem der Pakete B1–B8, A1–A3 oder F1–F11
  gehört, gehört NICHT in diese Sitzung (CLAUDE.md §1, kein Scope-Creep).
- Änderungen an packages/contracts laufen laut CLAUDE.md §6 über einen eigenen, kleinen PR.
  Da diese Sitzung ausschließlich aus solchen Grundlagen besteht: mach daraus zwei getrennte
  PRs – einen für contracts/validation, einen für das Drizzle-Setup –, damit die
  nachfolgenden Sitzungen den Contracts-Teil sofort nutzen können.
- Datenbank-Schema-Änderungen ausschließlich über Migrationen, nie manuell an der laufenden
  Datenbank.
- Jede neue Konfigurationsvariable mit erklärendem Kommentar in .env.example.
- Neue Abhängigkeiten benennen und begründen, nicht stillschweigend einbauen.
- Tests: mindestens die Envelope-Hilfsfunktionen und die Fehlercode-Status-Zuordnung.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test tatsächlich ausführen.
Zum Abschluss den aktuellen Stand von main holen (pull/rebase), Konflikte lokal lösen,
dann pushen und über Pull Request zusammenführen.
```

---

# Backend

## B1 – Auth & Identity

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (technisches Umsetzungskonzept, besonders §5, §6, §7, §18)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (fachliche Anforderungen, besonders §3.1)

Dein Arbeitspaket: B1 – Auth & Identity
Vorgeschlagener Pfad: apps/backend/src/modules/auth

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob B1 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter.
2. Lege einen eigenen Branch an: git checkout -b b1/auth (ausgehend vom aktuellen main).
   Niemals direkt auf main arbeiten.
3. Setze die Zeile "B1 – Auth & Identity" in WORK_STATUS.md auf Status "in Bearbeitung",
   trage den Branch und das heutige Datum ein, und committe das als eigenen ersten Commit.
4. Bring packages/contracts und packages/validation auf den neuesten Stand (git pull) und
   prüfe, welche Typen/Schemas dort bereits existieren, bevor du eigene anlegst.

Halte WORK_STATUS.md danach laufend aktuell: bei jedem nennenswerten Fortschritt, bei
jedem Blocker und am Ende mit Status "fertig".

Inhalt des Arbeitspakets:
- Registrierung und Login per Benutzername + Passwort (Argon2id, Mindestlänge 12 Zeichen)
- OAuth2-Login über Discord und Twitch, OpenID über Steam; minimale Scopes
- Account-Linking: weitere Login-Methoden nur im eingeloggten Zustand verknüpfbar
- Session-Handling: kurzlebiges Access-JWT, opakes Refresh-Token gehasht in der
  Session-Tabelle, httpOnly-Secure-Cookie mit SameSite=Lax (bewusst nicht Strict –
  Begründung in Pflichtenheft §7), CSRF-Token für zustandsändernde Requests
- Sitzungsübersicht und einzelner Remote-Logout
- 2FA (TOTP) optional für Passwort-Konten
- ALTCHA-Verifikation (selbstgehostet) und IP-basiertes Rate-Limiting auf Registrierung
  und Login
- Passwort-Reset ohne E-Mail-Versand (wird durch einen Admin ausgelöst)
- Selbstständige Account-Löschung
- Jeder neu registrierte Account bekommt automatisch die Rolle "Gast" (Zusammenspiel mit B2)

Verbindliche Vorgaben:
- Keine Secrets im Code – ausschließlich über die zentrale .env / .env.example.
  Jede neue Variable kommt mit Kommentar in .env.example (Pflichtenheft §12.1).
- Keine "temporären" Auth-Bypässe oder Debug-Hintertüren.
- Response-Envelope aus Pflichtenheft §5.1 einhalten; neue Fehlerfälle als benannter
  Fehlercode im Katalog (z. B. AUTH_INVALID_CREDENTIALS), nicht als Freitext.
- Datenbank-Schema-Änderungen ausschließlich über Drizzle-Migrationen. Falls das
  Drizzle-Setup noch nicht existiert, lege es in einem eigenen, kleinen PR an, bevor du
  mit dem Feature-Code weitermachst.
- Brauchst du Änderungen an packages/contracts, die über dein Paket hinausgehen: eigener,
  kleiner PR nur dafür, erst mergen, dann weiterarbeiten.
- Tests sind für Auth-Flows zwingend (CLAUDE.md §4).

Bei sicherheitsrelevanten Unsicherheiten (Token-Lebensdauer, Cookie-Flags, OAuth-State,
2FA-Recovery): nachfragen statt raten.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test tatsächlich ausführen.
Zum Abschluss den aktuellen Stand von main holen (pull/rebase), Konflikte lokal lösen,
dann pushen und über Pull Request zusammenführen.
```

---

## B2 – RBAC / Permissions

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (technisches Umsetzungskonzept, besonders §5.2, §6, §8)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (fachliche Anforderungen, besonders §2 und §3.2)

Dein Arbeitspaket: B2 – RBAC / Permissions
Vorgeschlagener Pfad: apps/backend/src/modules/rbac

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob B2 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter.
2. Lege einen eigenen Branch an: git checkout -b b2/rbac (ausgehend vom aktuellen main).
   Niemals direkt auf main arbeiten.
3. Setze die Zeile "B2 – RBAC / Permissions" in WORK_STATUS.md auf Status "in Bearbeitung",
   trage den Branch und das heutige Datum ein, und committe das als eigenen ersten Commit.
4. Bring packages/contracts und packages/validation auf den neuesten Stand (git pull) und
   prüfe, welche Typen/Schemas dort bereits existieren, bevor du eigene anlegst.

Halte WORK_STATUS.md danach laufend aktuell: bei jedem nennenswerten Fortschritt, bei
jedem Blocker und am Ende mit Status "fertig".

Wichtig: Dieses Paket hat hohe Priorität. Das serverseitig berechnete permissions-Objekt
steckt laut Pflichtenheft §5.2 in praktisch jedem DTO – andere Backend-Pakete bauen darauf
auf.

Inhalt des Arbeitspakets:
- Permission-Katalog als feste String-Konstanten (vollständige Liste in Pflichtenheft §8:
  server.create, server.view.own, server.view.any, server.manage.own, server.manage.any,
  server.delete.own, server.delete.any, backup.manage.own, backup.manage.any, user.manage,
  role.manage, notification.manage, node.view, node.manage, address.manage, audit.view,
  message.moderate, gametype.manage)
- Frei definierbare Rollen als Bündel dieser Permissions; ein Nutzer kann mehrere Rollen
  haben, effektive Rechte = Vereinigung
- Owner-Flag (User.isOwner) außerhalb des Rollensystems: garantiert immer alle Permissions,
  Schutz vor Selbst-Aussperrung
- Geschützte Systemrolle "Gast" (isProtected, keine Permissions, nicht editier-/löschbar)
- Seed-Rollen bei Ersteinrichtung: Admin, Moderator, Nutzer (vollständig editierbar)
- Middleware/Guard zur Permission-Prüfung für Fastify-Routen
- Wiederverwendbare Funktion zur Berechnung des permissions-Objekts für DTOs

Verbindliche Vorgaben:
- Der Permission-Katalog und der Typ des permissions-Objekts gehören nach
  packages/contracts – dafür einen eigenen, kleinen PR anlegen und zuerst mergen, bevor
  du im Feature-Branch weiterarbeitest (CLAUDE.md §6).
- gametype.manage bleibt in Version 1 ungenutzt, gehört aber bereits in den Katalog.
- Response-Envelope aus Pflichtenheft §5.1 einhalten; neue Fehlerfälle als benannter
  Fehlercode im Katalog, nicht als Freitext.
- Datenbank-Schema-Änderungen ausschließlich über Drizzle-Migrationen.
- Tests für die Permission-Berechnung sind zwingend (CLAUDE.md §4) – inklusive der Fälle
  "Owner hat alles", "Gast hat nichts", "mehrere Rollen vereinigen sich".

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test tatsächlich ausführen.
Zum Abschluss den aktuellen Stand von main holen (pull/rebase), Konflikte lokal lösen,
dann pushen und über Pull Request zusammenführen.
```

---

## B3 – Server-Orchestrierung

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (technisches Umsetzungskonzept, besonders §2.2, §5.3, §9, §11, §13)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (fachliche Anforderungen, besonders §3.3 und §3.5)

Dein Arbeitspaket: B3 – Server-Orchestrierung
Vorgeschlagener Pfad: apps/backend/src/modules/server-orchestration

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob B3 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter.
2. Lege einen eigenen Branch an: git checkout -b b3/server-orchestration (ausgehend vom
   aktuellen main). Niemals direkt auf main arbeiten.
3. Setze die Zeile "B3 – Server-Orchestrierung" in WORK_STATUS.md auf Status
   "in Bearbeitung", trage den Branch und das heutige Datum ein, und committe das als
   eigenen ersten Commit.
4. Bring packages/contracts und packages/validation auf den neuesten Stand (git pull) und
   prüfe, welche Typen/Schemas dort bereits existieren, bevor du eigene anlegst.

Halte WORK_STATUS.md danach laufend aktuell: bei jedem nennenswerten Fortschritt, bei
jedem Blocker und am Ende mit Status "fertig".

Inhalt des Arbeitspakets:
- State Machine für den Server-Lifecycle:
  creating → stopped → starting → running → stopping → stopped, zusätzlich error und crashed
- starting → running erst nach erfolgreichem Health-Check (gamedig bzw. generischer
  Port-Connect-Test beim Test-Typ) – ein gestarteter Prozess allein reicht nicht
- Lifecycle-Befehle an den Agent: CREATE, START, STOP, RESTART, DELETE, GET_STATS,
  GET_LOGS, EXEC_CONSOLE, FILE_LIST/READ/WRITE, CREATE_BACKUP, RESTORE_BACKUP,
  GET_STORAGE_BREAKDOWN – jeweils mit Korrelations-ID
- Verarbeitung der Agent-Events: STATUS_CHANGED, STATS_UPDATE, LOG_LINE, CRASHED
- Soll/Ist-Abgleich nach Reconnect des Agents (Pflichtenheft §2.2)
- Crash-Loop-Schutz: begrenzte Neustart-Versuche im Zeitfenster, danach error + Benachrichtigung
- Auto-Shutdown-Steuerung inkl. Schonfrist; ein automatischer Neustart nach Absturz zählt
  als regulärer Serverstart
- Klonen: neuer GameServer-Datensatz mit kopierter Konfiguration und zwingend neuer,
  eigener Subdomain; Weltdaten optional mitkopieren, Fortschritt meldbar
- Subdomain-Vergabe: Formatprüfung, Verfügbarkeitsprüfung, gesperrte Namen (www, api,
  admin, vpn, mail); DNS-Eintrag über die Cloudflare-API
- Spiele-Registry (GameTypeDefinition) inkl. minimalem Test-Typ für Phase 1

Verbindliche Vorgaben:
- Die Schnittstelle zum Agent läuft AUSSCHLIESSLICH über packages/contracts – keine
  Absprachen am Code vorbei. Änderungen daran: eigener, kleiner PR, zuerst mergen.
  Dieses Paket ist eng mit A2 (Container-Runtime) gekoppelt; prüfe in WORK_STATUS.md,
  ob dort parallel gearbeitet wird.
- Ressourcenprüfung vor jedem Start läuft über B4 – keine eigene Parallelimplementierung.
- Response-Envelope aus Pflichtenheft §5.1 einhalten; neue Fehlerfälle als benannter
  Fehlercode im Katalog (z. B. SUBDOMAIN_TAKEN), nicht als Freitext.
- WebSocket-Events folgen dem bestehenden Benennungsschema (server.started, ...).
- Datenbank-Schema-Änderungen ausschließlich über Drizzle-Migrationen.
- Tests für die State Machine sind zwingend (CLAUDE.md §4) – inklusive unzulässiger
  Übergänge und Crash-Loop-Schutz.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test tatsächlich ausführen.
Zum Abschluss den aktuellen Stand von main holen (pull/rebase), Konflikte lokal lösen,
dann pushen und über Pull Request zusammenführen.
```

---

## B4 – Ressourcen & Kapazität

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (technisches Umsetzungskonzept, besonders §6, §10, §14)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (fachliche Anforderungen, besonders §3.4 und §5)

Dein Arbeitspaket: B4 – Ressourcen & Kapazität
Vorgeschlagener Pfad: apps/backend/src/modules/resources

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob B4 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter.
2. Lege einen eigenen Branch an: git checkout -b b4/resources (ausgehend vom aktuellen
   main). Niemals direkt auf main arbeiten.
3. Setze die Zeile "B4 – Ressourcen & Kapazität" in WORK_STATUS.md auf Status
   "in Bearbeitung", trage den Branch und das heutige Datum ein, und committe das als
   eigenen ersten Commit.
4. Bring packages/contracts und packages/validation auf den neuesten Stand (git pull) und
   prüfe, welche Typen/Schemas dort bereits existieren, bevor du eigene anlegst.

Halte WORK_STATUS.md danach laufend aktuell: bei jedem nennenswerten Fortschritt, bei
jedem Blocker und am Ende mit Status "fertig".

Inhalt des Arbeitspakets:
- UserResourceLimit: optionale Kontingente pro Nutzer (maxRamMb, maxCpuCores, maxDiskMb,
  maxConcurrentServers – alle nullable; nicht gesetzt bedeutet kein Limit)
- Nachträgliches Setzen/Ändern durch einen Admin
- Harte, globale Kapazitätsprüfung vor JEDEM Serverstart: tatsächlich freie Ressourcen der
  Ziel-VM gegen die angeforderten Limits des Servers – unabhängig vom Nutzer-Kontingent
  (Pflichtenheft §10). Beide Prüfungen greifen, nicht nur eine.
- Ressourcen-Warnungen bei konfigurierbaren Schwellwerten auf Server- und Node-Ebene,
  ausgelöst als Event resource.low (Konsument ist B6)
- Bereitstellung der Prüf-Funktion für B3, damit dort keine Parallelimplementierung entsteht

Verbindliche Vorgaben:
- Rahmenbedingung Hardware: Ryzen 7 5800X, 32 GB RAM, 2 TB nutzbar für die Gameserver-VM
  (Lastenheft §5). Werte gehören nicht hartkodiert in den Code, sondern kommen aus der
  HostNode-Entität.
- Response-Envelope aus Pflichtenheft §5.1 einhalten; Fehlerfall RESOURCE_LIMIT_EXCEEDED
  als benannter Fehlercode im Katalog.
- Jede neue Konfigurationsvariable (z. B. Schwellwerte) mit Kommentar in .env.example.
- Datenbank-Schema-Änderungen ausschließlich über Drizzle-Migrationen.
- Tests für die Kapazitätsprüfung sind zwingend (CLAUDE.md §4) – inklusive
  "kein Limit gesetzt", "Limit exakt erreicht" und "Node voll trotz freiem Nutzer-Kontingent".

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test tatsächlich ausführen.
Zum Abschluss den aktuellen Stand von main holen (pull/rebase), Konflikte lokal lösen,
dann pushen und über Pull Request zusammenführen.
```

---

## B5 – Backup-Verwaltung

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (technisches Umsetzungskonzept, besonders §5, §6, §14, §16)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (fachliche Anforderungen, besonders §3.3)

Dein Arbeitspaket: B5 – Backup-Verwaltung
Vorgeschlagener Pfad: apps/backend/src/modules/backups

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob B5 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter.
2. Lege einen eigenen Branch an: git checkout -b b5/backups (ausgehend vom aktuellen main).
   Niemals direkt auf main arbeiten.
3. Setze die Zeile "B5 – Backup-Verwaltung" in WORK_STATUS.md auf Status "in Bearbeitung",
   trage den Branch und das heutige Datum ein, und committe das als eigenen ersten Commit.
4. Bring packages/contracts und packages/validation auf den neuesten Stand (git pull) und
   prüfe, welche Typen/Schemas dort bereits existieren, bevor du eigene anlegst.

Halte WORK_STATUS.md danach laufend aktuell: bei jedem nennenswerten Fortschritt, bei
jedem Blocker und am Ende mit Status "fertig".

Inhalt des Arbeitspakets:
- Manuelle Backups auf Knopfdruck
- Geplante, automatische Backups (Zusammenspiel mit Schedule-Entität)
- Retention-Regel (Lastenheft §3.3, wörtlich einzuhalten):
  * AUTOMATISCHE Backups älter als 7 Tage werden gelöscht
  * das NEUESTE automatische Backup bleibt immer erhalten, auch wenn es älter ist
  * MANUELL erstellte Backups sind von der automatischen Löschung ausgenommen und müssen
    aktiv entfernt werden
- Restore eines Backups
- Vollständiger Export/Download aller Serverdaten (Datenmitnahme ohne Abhängigkeit)
- Globale Backup-Übersicht inkl. Speicherverbrauch (API für die Admin-Ansicht in F10;
  Abgrenzung zu B8 vorher klären, falls unklar)
- Event backup.failed auslösen (Konsument ist B6)

Verbindliche Vorgaben:
- Die eigentliche Ausführung passiert im Agent (CREATE_BACKUP / RESTORE_BACKUP über
  packages/contracts) – das Backend orchestriert nur, es greift nicht selbst auf
  Dateien des Homeservers zu.
- Backup-Berechtigungen laufen über backup.manage.own / backup.manage.any aus B2.
- Response-Envelope aus Pflichtenheft §5.1 einhalten; neue Fehlerfälle als benannter
  Fehlercode im Katalog, nicht als Freitext.
- Datenbank-Schema-Änderungen ausschließlich über Drizzle-Migrationen.
- Tests für die Retention-Logik sind zwingend – besonders die drei Sonderfälle oben.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test tatsächlich ausführen.
Zum Abschluss den aktuellen Stand von main holen (pull/rebase), Konflikte lokal lösen,
dann pushen und über Pull Request zusammenführen.
```

---

## B6 – Notification-Engine

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (technisches Umsetzungskonzept, besonders §5.3, §6, §14)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (fachliche Anforderungen, besonders §3.6)

Dein Arbeitspaket: B6 – Notification-Engine
Vorgeschlagener Pfad: apps/backend/src/modules/notifications

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob B6 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter.
2. Lege einen eigenen Branch an: git checkout -b b6/notifications (ausgehend vom aktuellen
   main). Niemals direkt auf main arbeiten.
3. Setze die Zeile "B6 – Notification-Engine" in WORK_STATUS.md auf Status
   "in Bearbeitung", trage den Branch und das heutige Datum ein, und committe das als
   eigenen ersten Commit.
4. Bring packages/contracts und packages/validation auf den neuesten Stand (git pull) und
   prüfe, welche Typen/Schemas dort bereits existieren, bevor du eigene anlegst.

Halte WORK_STATUS.md danach laufend aktuell: bei jedem nennenswerten Fortschritt, bei
jedem Blocker und am Ende mit Status "fertig".

Inhalt des Arbeitspakets:
- Internes Event-System mit dem Katalog aus Pflichtenheft §14: server.started,
  server.stopped, server.crashed, backup.failed, autoShutdown.triggered, resource.low,
  user.registered, message.reported, ...
- NotificationChannel (Version 1: Discord-Webhook) – getrennt von der Regel
- NotificationRule: Event → Kanal → Empfängerkreis, über die Admin-Oberfläche konfigurierbar
- Zustellung an die Inbox im Frontend (WebSocket-Kanal) und an den externen Kanal
- Systemweite Ankündigungen durch den Admin (z. B. Wartungshinweise)

Verbindliche Vorgaben:
- Event-Namen folgen exakt dem bestehenden Benennungsschema. Neue Events werden nach
  diesem Muster ergänzt und im Pflichtenheft §14 im Katalog nachgetragen (CLAUDE.md §8).
- Die Event-Namen und die zugehörigen Payload-Typen gehören nach packages/contracts –
  dafür einen eigenen, kleinen PR, zuerst mergen.
- Die Discord-Webhook-URL kommt aus der zentralen .env (DISCORD_WEBHOOK_URL), niemals
  hartkodiert. Jede neue Variable mit Kommentar in .env.example.
- Fehlgeschlagene Zustellung darf nie den auslösenden Vorgang (Serverstart, Backup)
  scheitern lassen.
- Response-Envelope aus Pflichtenheft §5.1 einhalten.
- Datenbank-Schema-Änderungen ausschließlich über Drizzle-Migrationen.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test tatsächlich ausführen.
Zum Abschluss den aktuellen Stand von main holen (pull/rebase), Konflikte lokal lösen,
dann pushen und über Pull Request zusammenführen.
```

---

## B7 – Chat & Moderation

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (technisches Umsetzungskonzept, besonders §5.3, §6, §15)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (fachliche Anforderungen, besonders §3.6)

Dein Arbeitspaket: B7 – Chat & Moderation
Vorgeschlagener Pfad: apps/backend/src/modules/chat

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob B7 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter.
2. Lege einen eigenen Branch an: git checkout -b b7/chat (ausgehend vom aktuellen main).
   Niemals direkt auf main arbeiten.
3. Setze die Zeile "B7 – Chat & Moderation" in WORK_STATUS.md auf Status "in Bearbeitung",
   trage den Branch und das heutige Datum ein, und committe das als eigenen ersten Commit.
4. Bring packages/contracts und packages/validation auf den neuesten Stand (git pull) und
   prüfe, welche Typen/Schemas dort bereits existieren, bevor du eigene anlegst.

Halte WORK_STATUS.md danach laufend aktuell: bei jedem nennenswerten Fortschritt, bei
jedem Blocker und am Ende mit Status "fertig".

Inhalt des Arbeitspakets:
- Conversation (Typ dm oder server_chat), Message, MessageReport
- Direktnachrichten (1:1) zwischen freigeschalteten Nutzern
- Server-Chat: entsteht automatisch mit dem Server, Teilnehmerkreis folgt ServerMember
- Live-Zustellung über WebSocket
- Melde-Funktion für einzelne Nachrichten
- Moderationsansicht: Admin/Moderator sehen ausschließlich GEMELDETE Nachrichten
- Moderationsaktionen landen im Audit-Log

Verbindliche Vorgaben (Datenschutz-Prinzip, nicht verhandelbar):
- Moderation ist ausschließlich REAKTIV. Es gibt keinen generellen Admin-Zugriff auf
  private Nachrichteninhalte – auch nicht über einen Umweg wie einen "Debug"-Endpunkt
  oder eine Admin-Suche über alle Nachrichten.
- Berechtigung zur Moderation läuft über message.moderate aus B2.
- Response-Envelope aus Pflichtenheft §5.1 einhalten; neue Fehlerfälle als benannter
  Fehlercode im Katalog, nicht als Freitext.
- WebSocket-Events folgen dem bestehenden Benennungsschema.
- Datenbank-Schema-Änderungen ausschließlich über Drizzle-Migrationen.
- Tests für die Sichtbarkeitsregeln sind zwingend: wer darf welche Konversation lesen,
  und was genau sieht ein Moderator bei einer Meldung.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test tatsächlich ausführen.
Zum Abschluss den aktuellen Stand von main holen (pull/rebase), Konflikte lokal lösen,
dann pushen und über Pull Request zusammenführen.
```

---

## B8 – Admin-Funktionen

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (technisches Umsetzungskonzept, besonders §2.4, §6, §13, §16)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (fachliche Anforderungen, besonders §3.7 und §3.8)

Dein Arbeitspaket: B8 – Admin-Funktionen
Vorgeschlagener Pfad: apps/backend/src/modules/admin

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob B8 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter.
2. Lege einen eigenen Branch an: git checkout -b b8/admin (ausgehend vom aktuellen main).
   Niemals direkt auf main arbeiten.
3. Setze die Zeile "B8 – Admin-Funktionen" in WORK_STATUS.md auf Status "in Bearbeitung",
   trage den Branch und das heutige Datum ein, und committe das als eigenen ersten Commit.
4. Bring packages/contracts und packages/validation auf den neuesten Stand (git pull) und
   prüfe, welche Typen/Schemas dort bereits existieren, bevor du eigene anlegst.

Halte WORK_STATUS.md danach laufend aktuell: bei jedem nennenswerten Fortschritt, bei
jedem Blocker und am Ende mit Status "fertig".

Inhalt des Arbeitspakets:
- HostNode-Verwaltung: Übersicht der Nodes inkl. Auslastung, Kapazität und Status
- Verwaltung des öffentlichen Port-Bereichs auf der VPS (Port-Pool, Zuordnung
  Port ↔ Zielserver, automatische Aktualisierung bei Server-Erstellung/-Löschung)
- Audit-Log: APPEND-ONLY. Es darf keine Update- oder Delete-Operation auf dieser Tabelle
  geben – auch nicht für Admins, auch nicht "temporär". Erfasst werden alle
  sicherheitsrelevanten Aktionen.
- Archivierungsprozess für Audit-Einträge älter als 24 Monate: rein additiver Export in
  eine komprimierte Archivdatei, danach Entfernen aus der aktiven Tabelle
  (Pflichtenheft §6)
- Storage-Explorer-API: Ergebnis des Agent-Befehls GET_STORAGE_BREAKDOWN entgegennehmen,
  mit Zeitstempel zwischenspeichern (Scan on-demand, nicht dauerhaft im Hintergrund),
  ausliefern
- Löschbar über die Oberfläche: Backups, ungenutzte Docker-Images, eindeutig verwaiste
  Daten. Aktive Server-Datenordner sind hierüber NICHT löschbar – nur über den dedizierten
  Server-Löschen-Vorgang.
- Freischalt-Warteliste ("Anfragen") für neue Registrierungen inkl. verfügbarer
  Profilinformationen (Discord-Tag/Avatar, Steam-Profilname, Twitch-Name); Aktionen
  freigeben oder sperren. Abgrenzung zu B1 vorher klären, falls unklar.

Verbindliche Vorgaben:
- Berechtigungen laufen über node.view, node.manage, address.manage, audit.view,
  user.manage aus B2.
- Response-Envelope aus Pflichtenheft §5.1 einhalten; neue Fehlerfälle als benannter
  Fehlercode im Katalog, nicht als Freitext.
- Datenbank-Schema-Änderungen ausschließlich über Drizzle-Migrationen.
- Tests: Unveränderlichkeit des Audit-Logs und die Nicht-Löschbarkeit aktiver
  Server-Datenordner sind zwingend zu testen.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test tatsächlich ausführen.
Zum Abschluss den aktuellen Stand von main holen (pull/rebase), Konflikte lokal lösen,
dann pushen und über Pull Request zusammenführen.
```

---

# Agent

## A1 – Core-Verbindung

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (technisches Umsetzungskonzept, besonders §1, §2.1, §2.2, §5.3, §18)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (fachliche Anforderungen, besonders §4 "Erreichbarkeit")

Dein Arbeitspaket: A1 – Core-Verbindung
Vorgeschlagener Pfad: apps/agent/src/connection

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob A1 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter.
2. Lege einen eigenen Branch an: git checkout -b a1/connection (ausgehend vom aktuellen
   main). Niemals direkt auf main arbeiten.
3. Setze die Zeile "A1 – Core-Verbindung" in WORK_STATUS.md auf Status "in Bearbeitung",
   trage den Branch und das heutige Datum ein, und committe das als eigenen ersten Commit.
4. Bring packages/contracts und packages/validation auf den neuesten Stand (git pull) und
   prüfe, welche Typen/Schemas dort bereits existieren, bevor du eigene anlegst.

Halte WORK_STATUS.md danach laufend aktuell: bei jedem nennenswerten Fortschritt, bei
jedem Blocker und am Ende mit Status "fertig".

Inhalt des Arbeitspakets:
- Persistente WebSocket-Verbindung zum Backend, IMMER vom Agent ausgehend aufgebaut
  (durch den WireGuard-Tunnel). Der Agent öffnet niemals selbst einen Listener und nimmt
  keine eingehenden Verbindungen an – das ist das Grundprinzip der Architektur.
- Authentifizierung gegenüber dem Backend per Pre-Shared-Token aus der zentralen .env
  (AGENT_TOKEN), zusätzlich zur WireGuard-Verschlüsselung (Defense in Depth)
- Reconnect-Strategie mit exponentiellem Backoff
- Nach Wiederverbindung: vollständigen Ist-Zustand aller bekannten Container an das
  Backend melden, damit dort der Soll/Ist-Abgleich laufen kann
- Korrelations-IDs: jeder Befehl trägt eine ID; bereits verarbeitete IDs werden verworfen
  (Schutz vor Doppelausführung bei Netzwerk-Retries)
- Sauberes Weiterreichen von Befehlen an die Runtime (A2) und von Events zurück ans Backend

Verbindliche Vorgaben:
- Das Protokoll (Befehle, Events, Envelope, Korrelations-ID-Format) lebt ausschließlich in
  packages/contracts. Änderungen daran: eigener, kleiner PR, zuerst mergen, dann hier
  weiterarbeiten. Prüfe in WORK_STATUS.md, ob B3 parallel daran arbeitet.
- Token und URLs kommen ausschließlich aus der zentralen .env; jede neue Variable mit
  Kommentar in .env.example (Pflichtenheft §12.1).
- Kein Auth-Bypass, auch nicht für lokale Tests – stattdessen mit Testdoubles arbeiten.
- Tests für Backoff-Verhalten und Korrelations-ID-Deduplizierung sind zwingend.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test tatsächlich ausführen.
Zum Abschluss den aktuellen Stand von main holen (pull/rebase), Konflikte lokal lösen,
dann pushen und über Pull Request zusammenführen.
```

---

## A2 – Container-Runtime

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (technisches Umsetzungskonzept, besonders §2.3, §2.5, §5.3, §18)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (fachliche Anforderungen, besonders §3.3 und §4 "Sicherheit")

Dein Arbeitspaket: A2 – Container-Runtime
Vorgeschlagener Pfad: apps/agent/src/runtime

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob A2 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter.
2. Lege einen eigenen Branch an: git checkout -b a2/container-runtime (ausgehend vom
   aktuellen main). Niemals direkt auf main arbeiten.
3. Setze die Zeile "A2 – Container-Runtime" in WORK_STATUS.md auf Status "in Bearbeitung",
   trage den Branch und das heutige Datum ein, und committe das als eigenen ersten Commit.
4. Bring packages/contracts und packages/validation auf den neuesten Stand (git pull) und
   prüfe, welche Typen/Schemas dort bereits existieren, bevor du eigene anlegst.

Halte WORK_STATUS.md danach laufend aktuell: bei jedem nennenswerten Fortschritt, bei
jedem Blocker und am Ende mit Status "fertig".

Inhalt des Arbeitspakets:
- ContainerRuntime-Interface als Abstraktion über die Container-Ansteuerung
- Docker-Implementierung dieses Interfaces
- Fake-Implementierung für Unit-/Integrationstests ohne echten Docker-Host
  (Pflichtenheft §2.5)
- Umsetzung der Befehle: CREATE, START, STOP, RESTART, DELETE, GET_STATS, GET_LOGS,
  EXEC_CONSOLE, FILE_LIST/READ/WRITE
- Ausgehende Events: STATUS_CHANGED, STATS_UPDATE, LOG_LINE, CRASHED

Verbindliche Vorgaben (Sicherheit, nicht verhandelbar):
- Der Agent spricht NIEMALS direkt mit dem Docker-Socket, sondern ausschließlich über den
  vorgeschalteten Docker-Socket-Proxy (DOCKER_SOCKET_PROXY_URL aus der .env).
- Aller übrige Agent-Code spricht ausschließlich über das ContainerRuntime-Interface mit
  Docker – nie direkt gegen die Docker-API oder den Proxy (CLAUDE.md §4).
- Container-Hardening ist Standard für JEDE neue Container-Ansteuerung, nicht nur für die
  erste Implementierung (Pflichtenheft §2.3):
  * no-new-privileges gesetzt
  * wo vom Spiel unterstützt: Read-only-Root-Filesystem, beschreibbare Daten nur im
    gemounteten Volume
  * restriktives Seccomp-Profil
  * feste CPU-/RAM-Limits je Container
- Die Befehls-/Event-Typen kommen aus packages/contracts. Änderungen daran: eigener,
  kleiner PR, zuerst mergen. Dieses Paket ist eng mit B3 gekoppelt – prüfe in
  WORK_STATUS.md, ob dort parallel gearbeitet wird.
- Jede neue Konfigurationsvariable mit Kommentar in .env.example.
- Tests laufen gegen die Fake-Implementierung und sind zwingend.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test tatsächlich ausführen.
Zum Abschluss den aktuellen Stand von main holen (pull/rebase), Konflikte lokal lösen,
dann pushen und über Pull Request zusammenführen.
```

---

## A3 – Jobs & Scheduler

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (technisches Umsetzungskonzept, besonders §5.3, §9, §16)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (fachliche Anforderungen, besonders §3.3 und §3.8)

Dein Arbeitspaket: A3 – Jobs & Scheduler
Vorgeschlagener Pfad: apps/agent/src/jobs

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob A3 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter. Prüfe außerdem den Stand von A1 und A2 – dieses Paket setzt beide
   voraus.
2. Lege einen eigenen Branch an: git checkout -b a3/jobs (ausgehend vom aktuellen main).
   Niemals direkt auf main arbeiten.
3. Setze die Zeile "A3 – Jobs & Scheduler" in WORK_STATUS.md auf Status "in Bearbeitung",
   trage den Branch und das heutige Datum ein, und committe das als eigenen ersten Commit.
4. Bring packages/contracts und packages/validation auf den neuesten Stand (git pull) und
   prüfe, welche Typen/Schemas dort bereits existieren, bevor du eigene anlegst.

Halte WORK_STATUS.md danach laufend aktuell: bei jedem nennenswerten Fortschritt, bei
jedem Blocker und am Ende mit Status "fertig".

Inhalt des Arbeitspakets:
- Health-Check-Job: Erreichbarkeitsprüfung eines gestarteten Servers per gamedig bzw.
  generischem Port-Connect-Test beim Test-Typ. Erst ein erfolgreicher Check erlaubt den
  Übergang starting → running – ein gestarteter Prozess allein reicht nicht.
- Auto-Shutdown-Job: periodische Spielerabfrage, Schonfrist nach Start, konfigurierbarer
  Inaktivitäts-Timeout, pro Server deaktivierbar. Ein automatischer Neustart nach Absturz
  zählt als regulärer Serverstart (verhindert sofortiges erneutes Abschalten).
- Auto-Restart bei Absturz, mit Crash-Loop-Schutz (begrenzte Versuche im Zeitfenster)
- Backup-Job: Ausführung von CREATE_BACKUP / RESTORE_BACKUP auf Dateiebene
- Storage-Scanner: GET_STORAGE_BREAKDOWN – Größen von Server-Datenordnern, Backups,
  Docker-Images (inkl. Nutzungsstatus) und nicht zuordenbaren Daten. Scan läuft
  on-demand, nicht dauerhaft im Hintergrund.

Verbindliche Vorgaben:
- Alle Container-Zugriffe laufen ausschließlich über das ContainerRuntime-Interface aus A2
  – nie direkt gegen die Docker-API oder den Docker-Socket-Proxy (CLAUDE.md §4).
- Befehle und Events kommen aus packages/contracts. Änderungen daran: eigener, kleiner PR,
  zuerst mergen.
- Verzeichnisse und Timeouts kommen aus der zentralen .env (AGENT_DATA_DIR,
  AGENT_BACKUP_DIR, ...); jede neue Variable mit Kommentar in .env.example.
- Tests für Crash-Loop-Schutz und Auto-Shutdown-Schonfrist sind zwingend – inklusive des
  Sonderfalls "Neustart nach Absturz darf die Schonfrist neu starten".

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test tatsächlich ausführen.
Zum Abschluss den aktuellen Stand von main holen (pull/rebase), Konflikte lokal lösen,
dann pushen und über Pull Request zusammenführen.
```

---

# Frontend

## F1 – Auth & Onboarding

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (technisches Umsetzungskonzept, besonders §3, §5, §7)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (fachliche Anforderungen, besonders §2, §3.1 und §4)

Dein Arbeitspaket: F1 – Auth & Onboarding
Vorgeschlagener Pfad: apps/frontend/src/app/(auth)

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob F1 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter.
2. Lege einen eigenen Branch an: git checkout -b f1/auth-onboarding (ausgehend vom
   aktuellen main). Niemals direkt auf main arbeiten.
3. Setze die Zeile "F1 – Auth & Onboarding" in WORK_STATUS.md auf Status "in Bearbeitung",
   trage den Branch und das heutige Datum ein, und committe das als eigenen ersten Commit.
4. Bring packages/contracts und packages/validation auf den neuesten Stand (git pull) und
   prüfe, welche Typen/Schemas dort bereits existieren, bevor du eigene anlegst.
5. Sieh in apps/frontend/src/components/shared nach, welche Komponenten aus F2 bereits
   existieren, bevor du eine eigene Variante baust.

Halte WORK_STATUS.md danach laufend aktuell: bei jedem nennenswerten Fortschritt, bei
jedem Blocker und am Ende mit Status "fertig".

Inhalt des Arbeitspakets:
- Login-Seite: Benutzername + Passwort sowie Buttons für Discord, Twitch und Steam
- Registrierungsseite inkl. ALTCHA-Widget (selbstgehostet, Proof-of-Work)
- 2FA-Eingabe (TOTP) für Passwort-Konten
- Gast-Wartebildschirm: Ansicht für frisch registrierte Konten, die noch keine
  Berechtigungen haben und auf Freischaltung durch einen Admin warten
- Fehlerzustände sauber darstellen (falsche Zugangsdaten, gesperrtes Konto, Rate-Limit)

Verbindliche Vorgaben:
- Oberflächensprache ist ausschließlich Deutsch (Lastenheft §4).
- Mobile-First: die Oberfläche muss auf Smartphone-Browsern gut nutzbar sein.
- Alle gemeinsamen Bausteine (Buttons, Inputs, Modals, Toasts, Tokens) kommen aus F2 –
  keine Parallelvarianten bauen. Fehlt eine Komponente in F2, notiere das unter
  "Gefundene Punkte" in WORK_STATUS.md, statt sie doppelt anzulegen.
- Berechtigungslogik lebt im Backend. Das Frontend zeigt/versteckt nur anhand des
  permissions-Objekts aus dem DTO (Pflichtenheft §5.2) – keine eigene Rechteberechnung.
- Antworten der API folgen dem Response-Envelope aus Pflichtenheft §5.1; Fehlermeldungen
  anhand des Fehlercodes übersetzen, nicht anhand des Freitexts.
- Typen und Schemas ausschließlich aus packages/contracts und packages/validation.
- Ein Mockup liegt entpackt unter `docs/mockup/` – daran orientieren.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test tatsächlich ausführen.
Zum Abschluss den aktuellen Stand von main holen (pull/rebase), Konflikte lokal lösen,
dann pushen und über Pull Request zusammenführen.
```

---

## F2 – Shared UI / Design-System

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (technisches Umsetzungskonzept, besonders §3, §5, §9)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (fachliche Anforderungen, besonders §3.3, §3.5 und §4)

Dein Arbeitspaket: F2 – Shared UI / Design-System
Vorgeschlagener Pfad: apps/frontend/src/components/shared

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob F2 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter.
2. Lege einen eigenen Branch an: git checkout -b f2/shared-ui (ausgehend vom aktuellen
   main). Niemals direkt auf main arbeiten.
3. Setze die Zeile "F2 – Shared UI / Design-System" in WORK_STATUS.md auf Status
   "in Bearbeitung", trage den Branch und das heutige Datum ein, und committe das als
   eigenen ersten Commit.
4. Bring packages/contracts und packages/validation auf den neuesten Stand (git pull) und
   prüfe, welche Typen/Schemas dort bereits existieren, bevor du eigene anlegst.

Halte WORK_STATUS.md danach laufend aktuell: bei jedem nennenswerten Fortschritt, bei
jedem Blocker und am Ende mit Status "fertig".

WICHTIG: Dieses Paket hat laut STRUKTUR.md und CLAUDE.md §6 Priorität – F3 bis F11 bauen
darauf auf. Arbeite so, dass andere Sitzungen früh etwas nutzen können: liefere die
Basis-Komponenten zuerst und aktualisiere WORK_STATUS.md, sobald sie verfügbar sind,
damit die anderen Sitzungen nicht blockiert bleiben.

Inhalt des Arbeitspakets:
- Design-Tokens (Farben, Abstände, Typografie, Radien) in apps/frontend/tailwind.config.ts
  und den globalen Styles
- ServerCard (zentrale Komponente der Serverübersicht, inkl. Statusdarstellung für alle
  Lifecycle-Zustände aus Pflichtenheft §9: creating, stopped, starting, running, stopping,
  error, crashed)
- Gemeinsame Modals (Bestätigung, Formular, Gefahren-/Löschbestätigung)
- Toasts / Benachrichtigungs-Einblendungen
- Icon-Set
- PhaseLockedPlaceholder: einheitlicher "Kommt später"-Zustand für Inhalte, die erst in
  Phase 2/3 fachlich existieren (Skins, Templates, Bilder, Sticker, Arcade-Musik).
  Wird von F9 und F11 genutzt.
- Layout-Bausteine (Seitenrahmen, Navigation, Tabs), soweit sie mehrfach gebraucht werden

Verbindliche Vorgaben:
- Oberflächensprache ist ausschließlich Deutsch (Lastenheft §4).
- Mobile-First: die Oberfläche muss auf Smartphone-Browsern gut nutzbar sein.
- Komponenten sind rein darstellend und bekommen ihre Daten per Props. Keine
  Berechtigungslogik im Frontend – gezeigt/versteckt wird anhand des permissions-Objekts
  aus dem DTO (Pflichtenheft §5.2).
- Typen ausschließlich aus packages/contracts. Fehlt dort ein Typ, den du brauchst:
  eigener, kleiner PR an packages/contracts, zuerst mergen.
- Ein Mockup liegt entpackt unter `docs/mockup/` – daran orientieren.
- Dokumentiere kurz (z. B. als README im Ordner shared), welche Komponenten es gibt und
  wie sie zu verwenden sind, damit F3–F11 nicht doppelt bauen.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test tatsächlich ausführen.
Zum Abschluss den aktuellen Stand von main holen (pull/rebase), Konflikte lokal lösen,
dann pushen und über Pull Request zusammenführen.
```

---

## F3 – Server-Übersicht & Lifecycle

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (technisches Umsetzungskonzept, besonders §5, §9, §11, §13)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (fachliche Anforderungen, besonders §3.3)

Dein Arbeitspaket: F3 – Server-Übersicht & Lifecycle
Vorgeschlagener Pfad: apps/frontend/src/app/(dashboard)/servers

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob F3 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter. Prüfe außerdem den Stand von F2 – dieses Paket baut darauf auf.
2. Lege einen eigenen Branch an: git checkout -b f3/servers (ausgehend vom aktuellen main).
   Niemals direkt auf main arbeiten.
3. Setze die Zeile "F3 – Server-Übersicht & Lifecycle" in WORK_STATUS.md auf Status
   "in Bearbeitung", trage den Branch und das heutige Datum ein, und committe das als
   eigenen ersten Commit.
4. Bring packages/contracts und packages/validation auf den neuesten Stand (git pull) und
   prüfe, welche Typen/Schemas dort bereits existieren, bevor du eigene anlegst.
5. Sieh in apps/frontend/src/components/shared nach, welche Komponenten aus F2 bereits
   existieren, bevor du eine eigene Variante baust.

Halte WORK_STATUS.md danach laufend aktuell: bei jedem nennenswerten Fortschritt, bei
jedem Blocker und am Ende mit Status "fertig".

Inhalt des Arbeitspakets:
- Serverübersicht / Serverliste (nutzt ServerCard aus F2)
- "Server erstellen"-Wizard: Spiel wählen, Name, Ressourcen-Konfiguration, Startparameter,
  Subdomain-Wahl mit Verfügbarkeits- und Formatprüfung, optionaler Import bestehender
  Weltdaten
- Server-Detailansicht mit den Tabs:
  * Übersicht (Status, Live-Monitoring: CPU, RAM, Speicher, Netzwerk, Spieleranzahl,
    Verlaufsdarstellung; Adresse/Subdomain)
  * Konsole (Live-Ausgabe + Befehlseingabe)
  * Dateien (Datei-Manager: Upload/Download/Bearbeiten; Upload-Größe pro Datei ist
    begrenzt – Limit kommt vom Backend, nicht im Frontend hartkodieren)
  * Backups (Liste, manuell erstellen, wiederherstellen, löschen)
  * Aufgaben (Schedules, z. B. täglicher Neustart oder Konsolenbefehl zu fester Uhrzeit)
  * Einstellungen (Auto-Shutdown an/aus, Mitgliederverwaltung, Klonen, Löschen, Export)
- Aktionen: Start, Stop, Restart, Löschen, Klonen (mit/ohne Weltdaten), vollständiger Export
- Fortschrittsanzeige beim Klonen mit Weltdaten

Verbindliche Vorgaben:
- Oberflächensprache ist ausschließlich Deutsch (Lastenheft §4).
- Mobile-First: die Oberfläche muss auf Smartphone-Browsern gut nutzbar sein.
- Alle gemeinsamen Bausteine kommen aus F2 – keine Parallelvarianten. Fehlt etwas,
  unter "Gefundene Punkte" in WORK_STATUS.md notieren.
- Buttons werden anhand des permissions-Objekts aus dem DTO ein-/ausgeblendet
  (Pflichtenheft §5.2) – keine eigene Rechteberechnung im Frontend.
- Live-Daten (Konsole, Stats) laufen über die WebSocket-Kanäle, nicht über Polling.
- Typen und Schemas ausschließlich aus packages/contracts und packages/validation.
- Ein Mockup liegt entpackt unter `docs/mockup/` – daran orientieren.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test tatsächlich ausführen.
Zum Abschluss den aktuellen Stand von main holen (pull/rebase), Konflikte lokal lösen,
dann pushen und über Pull Request zusammenführen.
```

---

## F4 – Meine Backups

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (technisches Umsetzungskonzept, besonders §5, §6)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (fachliche Anforderungen, besonders §3.3)

Dein Arbeitspaket: F4 – Meine Backups
Vorgeschlagener Pfad: apps/frontend/src/app/(dashboard)/my-backups

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob F4 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter. Prüfe außerdem den Stand von F2 – dieses Paket baut darauf auf.
2. Lege einen eigenen Branch an: git checkout -b f4/my-backups (ausgehend vom aktuellen
   main). Niemals direkt auf main arbeiten.
3. Setze die Zeile "F4 – Meine Backups" in WORK_STATUS.md auf Status "in Bearbeitung",
   trage den Branch und das heutige Datum ein, und committe das als eigenen ersten Commit.
4. Bring packages/contracts und packages/validation auf den neuesten Stand (git pull) und
   prüfe, welche Typen/Schemas dort bereits existieren, bevor du eigene anlegst.
5. Sieh in apps/frontend/src/components/shared nach, welche Komponenten aus F2 bereits
   existieren, bevor du eine eigene Variante baust.

Halte WORK_STATUS.md danach laufend aktuell: bei jedem nennenswerten Fortschritt, bei
jedem Blocker und am Ende mit Status "fertig".

Inhalt des Arbeitspakets:
- Globale Ansicht aller eigenen Backups über alle eigenen Server hinweg
- Anzeige von Server, Zeitpunkt, Größe und Typ (manuell / automatisch)
- Sichtbarer Hinweis auf die Retention-Regel: automatische Backups älter als 7 Tage werden
  gelöscht (das neueste bleibt immer erhalten), manuelle Backups sind davon ausgenommen
  und müssen aktiv entfernt werden
- Aktionen: wiederherstellen, herunterladen, löschen
- Anzeige des gesamten eigenen Speicherverbrauchs

Verbindliche Vorgaben:
- Oberflächensprache ist ausschließlich Deutsch (Lastenheft §4).
- Mobile-First: die Oberfläche muss auf Smartphone-Browsern gut nutzbar sein.
- Alle gemeinsamen Bausteine kommen aus F2 – keine Parallelvarianten. Fehlt etwas,
  unter "Gefundene Punkte" in WORK_STATUS.md notieren.
- Aktionen werden anhand des permissions-Objekts aus dem DTO ein-/ausgeblendet
  (Pflichtenheft §5.2) – keine eigene Rechteberechnung im Frontend.
- Löschen ist irreversibel: immer über die Bestätigungs-Modal-Variante aus F2.
- Typen und Schemas ausschließlich aus packages/contracts und packages/validation.
- Ein Mockup liegt entpackt unter `docs/mockup/` – daran orientieren.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test tatsächlich ausführen.
Zum Abschluss den aktuellen Stand von main holen (pull/rebase), Konflikte lokal lösen,
dann pushen und über Pull Request zusammenführen.
```

---

## F5 – Nachrichten/Chat

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (technisches Umsetzungskonzept, besonders §5.3, §15)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (fachliche Anforderungen, besonders §3.6)

Dein Arbeitspaket: F5 – Nachrichten/Chat
Vorgeschlagener Pfad: apps/frontend/src/app/(dashboard)/messages

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob F5 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter. Prüfe außerdem den Stand von F2 – dieses Paket baut darauf auf.
2. Lege einen eigenen Branch an: git checkout -b f5/messages (ausgehend vom aktuellen
   main). Niemals direkt auf main arbeiten.
3. Setze die Zeile "F5 – Nachrichten/Chat" in WORK_STATUS.md auf Status "in Bearbeitung",
   trage den Branch und das heutige Datum ein, und committe das als eigenen ersten Commit.
4. Bring packages/contracts und packages/validation auf den neuesten Stand (git pull) und
   prüfe, welche Typen/Schemas dort bereits existieren, bevor du eigene anlegst.
5. Sieh in apps/frontend/src/components/shared nach, welche Komponenten aus F2 bereits
   existieren, bevor du eine eigene Variante baust.

Halte WORK_STATUS.md danach laufend aktuell: bei jedem nennenswerten Fortschritt, bei
jedem Blocker und am Ende mit Status "fertig".

Inhalt des Arbeitspakets:
- Übersicht der Konversationen (Direktnachrichten und Server-Chats)
- Direktnachrichten (1:1) zwischen freigeschalteten Nutzern
- Server-Chat je Gameserver – entsteht automatisch, Teilnehmerkreis sind alle Personen mit
  Zugriff auf diesen Server
- Nachrichtenansicht mit Live-Aktualisierung über WebSocket
- Melde-Funktion für einzelne Nachrichten inkl. Grundangabe

Verbindliche Vorgaben:
- Oberflächensprache ist ausschließlich Deutsch (Lastenheft §4).
- Mobile-First: Chat muss auf dem Smartphone gut bedienbar sein (Tastatur, Scrollverhalten).
- Alle gemeinsamen Bausteine kommen aus F2 – keine Parallelvarianten. Fehlt etwas,
  unter "Gefundene Punkte" in WORK_STATUS.md notieren.
- Die Moderationsansicht für gemeldete Nachrichten gehört NICHT hierher, sondern in den
  Admin-Bereich (F10). Es darf keinen Frontend-Pfad geben, über den Admins allgemein in
  private Chats sehen können – Moderation ist ausschließlich reaktiv (Pflichtenheft §15).
- Live-Daten laufen über die WebSocket-Kanäle, nicht über Polling.
- Typen und Schemas ausschließlich aus packages/contracts und packages/validation.
- Ein Mockup liegt entpackt unter `docs/mockup/` – daran orientieren.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test tatsächlich ausführen.
Zum Abschluss den aktuellen Stand von main holen (pull/rebase), Konflikte lokal lösen,
dann pushen und über Pull Request zusammenführen.
```

---

## F6 – Benachrichtigungen

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (technisches Umsetzungskonzept, besonders §5.3, §14)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (fachliche Anforderungen, besonders §3.6)

Dein Arbeitspaket: F6 – Benachrichtigungen
Vorgeschlagener Pfad: apps/frontend/src/app/(dashboard)/notifications

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob F6 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter. Prüfe außerdem den Stand von F2 – dieses Paket baut darauf auf.
2. Lege einen eigenen Branch an: git checkout -b f6/notifications (ausgehend vom aktuellen
   main). Niemals direkt auf main arbeiten.
3. Setze die Zeile "F6 – Benachrichtigungen" in WORK_STATUS.md auf Status
   "in Bearbeitung", trage den Branch und das heutige Datum ein, und committe das als
   eigenen ersten Commit.
4. Bring packages/contracts und packages/validation auf den neuesten Stand (git pull) und
   prüfe, welche Typen/Schemas dort bereits existieren, bevor du eigene anlegst.
5. Sieh in apps/frontend/src/components/shared nach, welche Komponenten aus F2 bereits
   existieren, bevor du eine eigene Variante baust.

Halte WORK_STATUS.md danach laufend aktuell: bei jedem nennenswerten Fortschritt, bei
jedem Blocker und am Ende mit Status "fertig".

Inhalt des Arbeitspakets:
- Tab "Inbox": Liste der eigenen Benachrichtigungen (Serverstatus, Backup-Fehler,
  automatisches Abschalten, Ressourcen-Warnungen, Ankündigungen, ...), gelesen/ungelesen,
  Live-Zugang über WebSocket
- Tab "Einstellungen": persönliche Einstellungen, welche Ereignisse man erhalten möchte
- Darstellung systemweiter Ankündigungen des Admins

Verbindliche Vorgaben:
- Oberflächensprache ist ausschließlich Deutsch (Lastenheft §4).
- Mobile-First: die Oberfläche muss auf Smartphone-Browsern gut nutzbar sein.
- Alle gemeinsamen Bausteine (insbesondere Toasts) kommen aus F2 – keine Parallelvarianten.
  Fehlt etwas, unter "Gefundene Punkte" in WORK_STATUS.md notieren.
- Die ADMIN-Verwaltung der Benachrichtigungs-Regeln (Event → Kanal → Empfängerkreis)
  gehört NICHT hierher, sondern nach F10.
- Event-Namen und Payloads kommen aus packages/contracts – keine eigenen Strings erfinden.
- Live-Daten laufen über die WebSocket-Kanäle, nicht über Polling.
- Ein Mockup liegt entpackt unter `docs/mockup/` – daran orientieren.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test tatsächlich ausführen.
Zum Abschluss den aktuellen Stand von main holen (pull/rebase), Konflikte lokal lösen,
dann pushen und über Pull Request zusammenführen.
```

---

## F7 – Nodes (Nutzeransicht)

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (technisches Umsetzungskonzept, besonders §1, §2, §6, §10)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (fachliche Anforderungen, besonders §3.7 und §5)

Dein Arbeitspaket: F7 – Nodes (Nutzeransicht)
Vorgeschlagener Pfad: apps/frontend/src/app/(dashboard)/nodes

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob F7 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter. Prüfe außerdem den Stand von F2 – dieses Paket baut darauf auf.
2. Lege einen eigenen Branch an: git checkout -b f7/nodes (ausgehend vom aktuellen main).
   Niemals direkt auf main arbeiten.
3. Setze die Zeile "F7 – Nodes (Nutzeransicht)" in WORK_STATUS.md auf Status
   "in Bearbeitung", trage den Branch und das heutige Datum ein, und committe das als
   eigenen ersten Commit.
4. Bring packages/contracts und packages/validation auf den neuesten Stand (git pull) und
   prüfe, welche Typen/Schemas dort bereits existieren, bevor du eigene anlegst.
5. Sieh in apps/frontend/src/components/shared nach, welche Komponenten aus F2 bereits
   existieren, bevor du eine eigene Variante baust.

Halte WORK_STATUS.md danach laufend aktuell: bei jedem nennenswerten Fortschritt, bei
jedem Blocker und am Ende mit Status "fertig".

Inhalt des Arbeitspakets:
- Node-Status aus Nutzersicht: online/offline, Auslastung (CPU, RAM, Speicher), freie
  Kapazität
- Verständliche Einrichtungs-/Erklärhinweise für Nutzer, was ein Node ist und was der
  Status bedeutet
- Hinweis, wenn ein Serverstart wegen fehlender Node-Kapazität nicht möglich wäre

Verbindliche Vorgaben:
- Oberflächensprache ist ausschließlich Deutsch (Lastenheft §4).
- Mobile-First: die Oberfläche muss auf Smartphone-Browsern gut nutzbar sein.
- Alle gemeinsamen Bausteine kommen aus F2 – keine Parallelvarianten. Fehlt etwas,
  unter "Gefundene Punkte" in WORK_STATUS.md notieren.
- Dies ist die NUTZERANSICHT. Node-Verwaltung, Port-Pool und Storage-Explorer gehören
  nach F10 (Admin). Sichtbarkeit richtet sich nach node.view aus dem permissions-Objekt.
- Es werden keine sicherheitsrelevanten Interna angezeigt (keine WireGuard-Schlüssel,
  keine internen Tunnel-Adressen, keine Agent-Tokens).
- Typen ausschließlich aus packages/contracts.
- Ein Mockup liegt entpackt unter `docs/mockup/` – daran orientieren.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test tatsächlich ausführen.
Zum Abschluss den aktuellen Stand von main holen (pull/rebase), Konflikte lokal lösen,
dann pushen und über Pull Request zusammenführen.
```

---

## F8 – Arcade

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (technisches Umsetzungskonzept, besonders §6 und §17)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (fachliche Anforderungen, besonders §3.9 und Anhang A)

Dein Arbeitspaket: F8 – Arcade
Vorgeschlagener Pfad: apps/frontend/src/app/(dashboard)/arcade

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob F8 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter. Prüfe außerdem den Stand von F2 – dieses Paket baut darauf auf.
2. Lege einen eigenen Branch an: git checkout -b f8/arcade (ausgehend vom aktuellen main).
   Niemals direkt auf main arbeiten.
3. Setze die Zeile "F8 – Arcade" in WORK_STATUS.md auf Status "in Bearbeitung", trage den
   Branch und das heutige Datum ein, und committe das als eigenen ersten Commit.
4. Bring packages/contracts und packages/validation auf den neuesten Stand (git pull) und
   prüfe, welche Typen/Schemas dort bereits existieren, bevor du eigene anlegst.
5. Sieh in apps/frontend/src/components/shared nach, welche Komponenten aus F2 bereits
   existieren, bevor du eine eigene Variante baust.

Halte WORK_STATUS.md danach laufend aktuell: bei jedem nennenswerten Fortschritt, bei
jedem Blocker und am Ende mit Status "fertig".

Hinweis: Dies ist eine ECHTE Umsetzung, kein Platzhalter (STRUKTUR.md).

Inhalt des Arbeitspakets:
- Arcade-Startseite mit Auswahl der Minispiele
- Eigenständig entwickelte, rein clientseitige Browser-Minispiele im Stil von:
  Snake, Pong, Breakout, Tetris-artig, Pac-Man-artig
- Bestenliste je Spiel, nutzerbezogen (ArcadeScore)

Verbindliche Vorgaben (rechtlich, nicht verhandelbar):
- Alle Spiele werden eigenständig entwickelt. Es dürfen KEINE geschützten
  Original-Assets, Grafiken, Sounds, Level-Layouts oder Markennamen verwendet werden
  (Lastenheft §3.9). Die Spiele heißen also nicht wie die Originale und sehen ihnen
  nicht nachempfunden-identisch aus.
- Kein Einbinden fremder Spiel-Bibliotheken mit unklarer Lizenz. Neue Abhängigkeiten
  werden laut CLAUDE.md §1 benannt und begründet, nicht einfach eingebaut.
- Arcade-Musik ist Phase 2 und bekommt hier keinen Platz – die zugehörige Verwaltung
  liegt als Platzhalter in F11.

Weitere Vorgaben:
- Oberflächensprache ist ausschließlich Deutsch (Lastenheft §4).
- Mobile-First: die Spiele müssen auf dem Smartphone mit Touch bedienbar sein.
- Score-Übermittlung läuft über die API; das Backend ist die Instanz, die den Score
  speichert – keine Bestenliste ausschließlich im Browser.
- Alle gemeinsamen Bausteine kommen aus F2 – keine Parallelvarianten.
- Ein Mockup liegt entpackt unter `docs/mockup/` – daran orientieren.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test tatsächlich ausführen.
Zum Abschluss den aktuellen Stand von main holen (pull/rebase), Konflikte lokal lösen,
dann pushen und über Pull Request zusammenführen.
```

---

## F9 – Skins

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (technisches Umsetzungskonzept)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (fachliche Anforderungen, besonders §7 Phasenplan)

Dein Arbeitspaket: F9 – Skins
Vorgeschlagener Pfad: apps/frontend/src/app/(dashboard)/skins

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob F9 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter. Prüfe außerdem den Stand von F2 – dieses Paket braucht die
   Komponente PhaseLockedPlaceholder von dort.
2. Lege einen eigenen Branch an: git checkout -b f9/skins (ausgehend vom aktuellen main).
   Niemals direkt auf main arbeiten.
3. Setze die Zeile "F9 – Skins" in WORK_STATUS.md auf Status "in Bearbeitung", trage den
   Branch und das heutige Datum ein, und committe das als eigenen ersten Commit.
4. Bring packages/contracts und packages/validation auf den neuesten Stand (git pull) und
   prüfe, welche Typen/Schemas dort bereits existieren, bevor du eigene anlegst.
5. Sieh in apps/frontend/src/components/shared nach, ob PhaseLockedPlaceholder aus F2
   bereits existiert. Falls nicht: setze deine Zeile in WORK_STATUS.md auf "blockiert",
   notiere die Abhängigkeit und arbeite nicht mit einer eigenen Ersatzkomponente weiter.

Halte WORK_STATUS.md danach laufend aktuell: bei jedem nennenswerten Fortschritt, bei
jedem Blocker und am Ende mit Status "fertig".

Inhalt des Arbeitspakets:
- Die Seite wird gebaut und ist über die Navigation erreichbar.
- Inhalt ist in Phase 1 bewusst ein einheitlicher "Kommt später"-Zustand über die
  gemeinsame Komponente PhaseLockedPlaceholder aus F2 (STRUKTUR.md).
- Die echte Umsetzung folgt in Phase 2 – hier wird also KEINE Skin-Logik gebaut.

Verbindliche Vorgaben:
- Kein Scope-Creep: keine vorweggenommene Skin-Verwaltung, kein Upload, kein Backend-Aufruf
  für Skins (CLAUDE.md §1).
- Oberflächensprache ist ausschließlich Deutsch (Lastenheft §4).
- Mobile-First: die Oberfläche muss auf Smartphone-Browsern gut nutzbar sein.
- Der Platzhalter wird NICHT selbst gebaut, sondern aus F2 verwendet – so sehen alle
  Phase-2-Seiten identisch aus.
- Ein Mockup liegt entpackt unter `docs/mockup/` – daran orientieren.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test tatsächlich ausführen.
Zum Abschluss den aktuellen Stand von main holen (pull/rebase), Konflikte lokal lösen,
dann pushen und über Pull Request zusammenführen.
```

---

## F10 – Admin-Kernbereich

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (technisches Umsetzungskonzept, besonders §5, §6, §8, §13, §14, §15, §16)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (fachliche Anforderungen, besonders §2, §3.7 und §3.8)

Dein Arbeitspaket: F10 – Admin-Kernbereich
Vorgeschlagener Pfad: apps/frontend/src/app/admin/(core)

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob F10 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter. Prüfe außerdem den Stand von F2 – dieses Paket baut darauf auf.
2. Lege einen eigenen Branch an: git checkout -b f10/admin-core (ausgehend vom aktuellen
   main). Niemals direkt auf main arbeiten.
3. Setze die Zeile "F10 – Admin-Kernbereich" in WORK_STATUS.md auf Status
   "in Bearbeitung", trage den Branch und das heutige Datum ein, und committe das als
   eigenen ersten Commit.
4. Bring packages/contracts und packages/validation auf den neuesten Stand (git pull) und
   prüfe, welche Typen/Schemas dort bereits existieren, bevor du eigene anlegst.
5. Sieh in apps/frontend/src/components/shared nach, welche Komponenten aus F2 bereits
   existieren, bevor du eine eigene Variante baust.

Halte WORK_STATUS.md danach laufend aktuell: bei jedem nennenswerten Fortschritt, bei
jedem Blocker und am Ende mit Status "fertig".

Inhalt des Arbeitspakets (alle Ansichten des Admin-Kernbereichs):
- Nutzerverwaltung: Rollen zuweisen, Kontingente (RAM/CPU/Speicher/Serveranzahl) setzen,
  sperren, Server des Nutzers einsehen, Passwort zurücksetzen
- Anfragen: Freischalt-Warteliste neuer Registrierungen inkl. verfügbarer
  Profilinformationen (Discord-Tag/Avatar, Steam-Profilname, Twitch-Name) zur
  Wiedererkennung; Aktionen freigeben oder sperren
- Rollen- und Berechtigungsverwaltung: frei definierbare Rollen über den Permission-Katalog.
  Die Systemrolle "Gast" ist geschützt und darf in der UI weder bearbeitbar noch löschbar
  sein. Der Owner-Status ist ein Konto-Flag und keine Rolle – er taucht nicht als
  vergebbare Rolle auf.
- Audit-Log: Ansicht mit Filtern. Rein lesend – es gibt keine Bearbeiten- oder
  Löschen-Aktion, auch nicht ausgegraut.
- Backups global: Übersicht über alle Nutzer inkl. Speicherverbrauch
- Node-Platz / Storage-Explorer: Server-Datenordner, Backups, Docker-Images (inkl.
  Kennzeichnung ungenutzter Images), sonstige/verwaiste Daten. Scan wird on-demand
  ausgelöst, Ergebnis mit Zeitstempel angezeigt. Löschbar sind Backups, ungenutzte
  Docker-Images und eindeutig verwaiste Daten – aktive Server-Datenordner sind hier
  bewusst NICHT löschbar.
- Adressen: Verwaltung des öffentlichen Port-Bereichs auf der VPS
- Benachrichtigungs-Regeln: Event → Kanal → Empfängerkreis
- Systemweite Ankündigungen erstellen

Verbindliche Vorgaben:
- Oberflächensprache ist ausschließlich Deutsch (Lastenheft §4).
- Mobile-First: die Oberfläche muss auf Smartphone-Browsern gut nutzbar sein.
- Alle gemeinsamen Bausteine kommen aus F2 – keine Parallelvarianten. Fehlt etwas,
  unter "Gefundene Punkte" in WORK_STATUS.md notieren.
- Sichtbarkeit jedes Bereichs richtet sich nach dem permissions-Objekt aus dem DTO
  (user.manage, role.manage, audit.view, node.view/node.manage, address.manage,
  notification.manage, message.moderate) – keine eigene Rechteberechnung im Frontend.
  Das Ausblenden im UI ersetzt keine Backend-Prüfung, es ergänzt sie nur.
- Die Moderationsansicht zeigt ausschließlich GEMELDETE Nachrichten. Es darf keinen
  Frontend-Pfad geben, über den Admins allgemein in private Chats sehen können
  (Pflichtenheft §15).
- Irreversible Aktionen (Löschen, Sperren) immer über die Bestätigungs-Modal-Variante aus F2.
- Typen und Schemas ausschließlich aus packages/contracts und packages/validation.
- Ein Mockup liegt entpackt unter `docs/mockup/` – daran orientieren.
- Das Paket ist groß: arbeite in kleinen, nachvollziehbaren Commits pro Ansicht und
  aktualisiere WORK_STATUS.md entsprechend häufig.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test tatsächlich ausführen.
Zum Abschluss den aktuellen Stand von main holen (pull/rebase), Konflikte lokal lösen,
dann pushen und über Pull Request zusammenführen.
```

---

## F11 – Admin-Spiele-Verwaltung

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (technisches Umsetzungskonzept, besonders §11)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (fachliche Anforderungen, besonders §6 Abgrenzung und §7 Phasenplan)

Dein Arbeitspaket: F11 – Admin-Spiele-Verwaltung
Vorgeschlagener Pfad: apps/frontend/src/app/admin/(games)

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob F11 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter. Prüfe außerdem den Stand von F2 – dieses Paket braucht die
   Komponente PhaseLockedPlaceholder von dort.
2. Lege einen eigenen Branch an: git checkout -b f11/admin-games (ausgehend vom aktuellen
   main). Niemals direkt auf main arbeiten.
3. Setze die Zeile "F11 – Admin-Spiele-Verwaltung" in WORK_STATUS.md auf Status
   "in Bearbeitung", trage den Branch und das heutige Datum ein, und committe das als
   eigenen ersten Commit.
4. Bring packages/contracts und packages/validation auf den neuesten Stand (git pull) und
   prüfe, welche Typen/Schemas dort bereits existieren, bevor du eigene anlegst.
5. Sieh in apps/frontend/src/components/shared nach, ob PhaseLockedPlaceholder aus F2
   bereits existiert. Falls nicht: setze deine Zeile in WORK_STATUS.md auf "blockiert",
   notiere die Abhängigkeit und arbeite nicht mit einer eigenen Ersatzkomponente weiter.

Halte WORK_STATUS.md danach laufend aktuell: bei jedem nennenswerten Fortschritt, bei
jedem Blocker und am Ende mit Status "fertig".

Inhalt des Arbeitspakets:
- Die Seiten werden gebaut und sind über die Admin-Navigation erreichbar:
  Templates, Bilder, Sticker, Arcade-Musik
- ALLE vier Bereiche bekommen in Phase 1 den einheitlichen "Kommt später"-Zustand über
  die gemeinsame Komponente PhaseLockedPlaceholder aus F2 (STRUKTUR.md).

Verbindliche Vorgaben:
- Kein Scope-Creep: In Version 1 gibt es laut Lastenheft §6 ausdrücklich KEINE
  Admin-Oberfläche zum Hinzufügen neuer Spiele-Typen – neue Spiele kommen über
  Code/Deployment. Hier wird also keine Spiele-Verwaltungslogik gebaut, kein Upload und
  kein Backend-Aufruf dafür.
- Die Permission gametype.manage existiert bereits im Katalog, bleibt in Version 1 aber
  ungenutzt (Pflichtenheft §8). Sie wird hier nicht als aktiver UI-Pfad verdrahtet.
- Oberflächensprache ist ausschließlich Deutsch (Lastenheft §4).
- Mobile-First: die Oberfläche muss auf Smartphone-Browsern gut nutzbar sein.
- Der Platzhalter wird NICHT selbst gebaut, sondern aus F2 verwendet – so sehen alle
  Phase-2/3-Seiten identisch aus.
- Ein Mockup liegt entpackt unter `docs/mockup/` – daran orientieren.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test tatsächlich ausführen.
Zum Abschluss den aktuellen Stand von main holen (pull/rebase), Konflikte lokal lösen,
dann pushen und über Pull Request zusammenführen.
```

---

# Integration (Welle 2.5)

> Diese fünf Pakete stehen **nicht** in STRUKTUR.md. Sie sind das Ergebnis der Sichtung
> aller „Gefundenen Punkte" am 2026-08-26: Zwölf Einträge waren Nachlass von
> Arbeitspaketen, die auf `fertig` stehen. Sie hatten ihre Anschlussstellen offen
> gelassen, weil das Gegenstück damals nicht existierte – inzwischen existiert es, aber
> niemand ist mehr zuständig. Die Teile sind gebaut, nur nicht verbunden.
>
> **R1 und R4 sind die dringenden:** ohne R1 lässt sich die Instanz nicht in Betrieb
> nehmen, ohne R4 baut jedes der Pakete F4–F11 dieselben Formularteile erneut.
> Alle fünf können parallel laufen.

## R1 – Ersteinrichtung & Identität

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (besonders §7 Auth, §8 RBAC, §12.3 Ersteinrichtung)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (besonders §2 Rollenkonzept und §3.1)

Dein Arbeitspaket: R1 - Ersteinrichtung & Identität
Dieses Paket steht nicht in STRUKTUR.md. Es schließt die Gefundenen Punkte 13, 45 und 39
aus WORK_STATUS.md - Nachlass der Pakete B1 und B8, die beide auf "fertig" stehen.

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob R1 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter.
2. Lege einen eigenen Branch an: git checkout -b r1/ersteinrichtung (vom aktuellen main).
   Niemals direkt auf main arbeiten - main ist geschützt, ein Direkt-Push wird abgelehnt.
3. Setze die Zeile "R1 - Ersteinrichtung & Identität" in WORK_STATUS.md auf
   "in Bearbeitung", trage Branch und Datum ein, und committe das als ersten Commit.

Halte WORK_STATUS.md laufend aktuell und setze die drei genannten Punkte am Ende auf
"erledigt", nicht nur deine eigene Zeile.

Inhalt des Arbeitspakets:

A) Owner-Konto (Punkt 13, Lastenheft §2, Pflichtenheft §8 und §12.3)
   Aktuell setzt NICHTS im Code User.isOwner auf true - der Wert wird ausschließlich
   gelesen. Damit gibt es keinen Weg, die Instanz überhaupt in Betrieb zu nehmen: ohne
   Owner hat niemand die Rechte, den ersten Admin freizuschalten.
   - Genau ein Konto trägt das Flag. Das ist im Schema bereits über einen Unique-Index
     abgesichert (apps/backend/src/db/schema/users.ts) - prüfe das und verlasse dich
     nicht allein auf Anwendungslogik.
   - Entscheide begründet, wie der Owner entsteht: erstes registriertes Konto, eigener
     Aufruf in db:seed, oder ein einmaliger Einrichtungsschritt. Der Weg gehört in
     SETUP.md dokumentiert - Pflichtenheft §12.3 verlangt die "Ersteinrichtung des
     Owner-Accounts" ausdrücklich als Schritt.
   - Der Owner steht laut Lastenheft §2 AUSSERHALB des Rollensystems und hat immer alle
     Rechte. Die Berechnung dafür existiert schon in B2 - keine zweite Stelle bauen.

B) Sitzungsauflösung für geschützte Routen (Punkt 45)
   buildServer({ resolveActor }) ist der vorgesehene Platz. Ohne ihn antwortet jede
   Admin-Route mit AUTH_REQUIRED - das ist die sichere Vorgabe von B8 und wird jetzt
   aufgelöst, nicht umgangen.
   - request.adminIdentity ({ userId, displayName }) wird in modules/admin/routes.ts
     gelesen, aber von niemandem gesetzt. Ohne das bleiben Audit-Einträge namenlos - und
     ein Audit-Log ohne Handelnden ist wertlos (Pflichtenheft §6: append-only, alle
     sicherheitsrelevanten Aktionen).
   - Die Auflösung nutzt die vorhandene Sitzungsprüfung aus B1, keine zweite Variante.

C) Profilangaben in der Freischalt-Warteliste (Punkt 39)
   createDrizzleRegistrationRequestRepository() liefert das Feld profiles derzeit leer,
   weil auth_methods bei Entstehung von B8 noch nicht existierte. Die Tabelle gibt es
   inzwischen. Je verknüpfter Login-Methode ein LinkedAccountProfileDto füllen
   (Discord-Tag/Avatar, Steam-Profilname, Twitch-Name - Lastenheft §3.1). Der DTO ändert
   sich dadurch nicht.

Verbindliche Vorgaben:
- Keine Secrets im Code, keine Auth-Bypässe, keine Standardwerte für Geheimnisse.
- Response-Envelope aus Pflichtenheft §5.1; neue Fehlerfälle als benannter Code im
  Katalog, nicht als Freitext.
- Datenbank-Schema-Änderungen ausschließlich über Drizzle-Migrationen.
- Tests sind für Auth-Flows zwingend (CLAUDE.md §4). Besonders: dass genau ein Owner
  existieren kann, und dass ein Audit-Eintrag den Handelnden trägt.
- Bei sicherheitsrelevanten Unsicherheiten nachfragen statt raten.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test ausführen.
Zum Abschluss main holen (pull/rebase), Konflikte lösen, pushen, Pull Request öffnen und
den grünen CI-Lauf abwarten - ohne ihn lässt sich nicht mergen.
```

## R2 – Verdrahtung im Backend

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (besonders §5.3, §9 Lifecycle, §10 Kapazität, §16 Storage)
- STRUKTUR.md      (Aufteilung der Arbeitspakete)
- LASTENHEFT.md    (besonders §3.3, §3.4, §3.7)

Dein Arbeitspaket: R2 - Verdrahtung im Backend
Dieses Paket steht nicht in STRUKTUR.md. Es schließt die Gefundenen Punkte 33, 40, 42
und 63 aus WORK_STATUS.md - Nachlass der Pakete B3, B4 und B5, die alle auf "fertig"
stehen. Es geht ausschließlich um das Verbinden vorhandener Teile, nicht um neue
Funktionen.

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob R2 bereits in Bearbeitung ist. Falls ja: melde das und
   arbeite nicht weiter.
2. Lege einen eigenen Branch an: git checkout -b r2/verdrahtung (vom aktuellen main).
   Niemals direkt auf main arbeiten - main ist geschützt.
3. Setze die Zeile "R2 - Verdrahtung im Backend" in WORK_STATUS.md auf "in Bearbeitung",
   trage Branch und Datum ein, und committe das als ersten Commit.

Halte WORK_STATUS.md laufend aktuell und setze die vier genannten Punkte am Ende auf
"erledigt".

Inhalt des Arbeitspakets:

A) Backup-Modul anschließen (Punkt 33)
   B5 spricht nur über Schnittstellen in modules/backups/ports.ts:
   - ServerDirectory - Server auflösen, inklusive dataHostPath und memberUserIds
   - BackupAgentGateway - die vier Backup-Befehle über den Agent-Kanal
   Beide sind deklariert, aber nirgends umgesetzt. Solange das so ist, lassen sich die
   Routen aus registerBackupRoutes() nicht registrieren - Backups sind über die API
   schlicht nicht erreichbar. Die Umsetzung gehört in die Server-Orchestrierung, weil
   dort game_servers liegt.

B) Admin-Anschlusspunkte einhängen (Punkt 40)
   modules/admin/module.ts lässt vier optionale Anschlüsse offen, jeder mit ehrlicher
   Vorgabe: nodePlacements, knownServers, serverNames, storageGateway. Solange sie leer
   bleiben, zeigt der Storage-Explorer jeden Ordner als unbekannt und die Port-Übersicht
   keine Servernamen.
   Ebenfalls hier: B3 ruft bei Server-Erstellung und -Löschung
   PortPoolService.allocateForServer() bzw. .releaseForServer() auf (Pflichtenheft §2.4).

C) Node-Auslastung liefern (Punkt 42)
   NodeUsageSource ist typisiert, emptyNodeUsageSource() liefert nichts, usage bleibt
   null. Dieselben Zahlen braucht die harte Kapazitätsprüfung vor jedem Start
   (Pflichtenheft §10) - eine Quelle, nicht zwei.

D) Zeitgeber anschließen (Punkt 63)
   Zwei fertige, getestete Abläufe werden von niemandem aufgerufen:
   - runAutoShutdownSweep() in der Server-Orchestrierung - ohne Aufruf schaltet sich kein
     Server jemals wegen Inaktivität ab (Lastenheft §3.3, Pflichtenheft §9)
   - BackupScheduleService.tick() - ohne Aufruf laufen geplante Backups nie
   Beide Module haben bewusst keinen eigenen Timer. Bau EINE Stelle, die periodisch
   auslöst, und begründe Intervall und Verhalten bei Überschneidung im Kommentar.

Verbindliche Vorgaben:
- Nichts an den bestehenden Schnittstellen ändern, ohne es zu begründen - sie sind die
  vereinbarte Grenze zwischen den Paketen.
- Die Kommunikation mit dem Agent läuft ausschließlich über packages/contracts.
- Response-Envelope aus Pflichtenheft §5.1 einhalten.
- Schema-Änderungen nur über Migrationen. Prüfe vorher, ob R3 (Fremdschlüssel) parallel
  läuft - dann stimmt euch über die Migrationsnummern ab.
- Tests: dass der Zeitgeber tatsächlich auslöst, und dass ein Server nicht versehentlich
  abgeschaltet wird, solange die Schonfrist läuft.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test ausführen.
Zum Abschluss main holen (pull/rebase), pushen, Pull Request, grünen CI-Lauf abwarten.
```

## R3 – Datenbank-Integrität

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln, besonders §4: Schema nur über Migrationen)
- PFLICHTENHEFT.md (besonders §6 Datenmodell)
- STRUKTUR.md
- LASTENHEFT.md    (besonders §3.3 zu Backups)

Dein Arbeitspaket: R3 - Datenbank-Integrität
Dieses Paket steht nicht in STRUKTUR.md. Es schließt die Gefundenen Punkte 32 und 41 aus
WORK_STATUS.md. Klein und abgegrenzt: im Kern eine Migration.

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob R3 bereits in Bearbeitung ist. Falls ja: melde das.
2. Lege einen eigenen Branch an: git checkout -b r3/fremdschluessel (vom aktuellen main).
   Niemals direkt auf main arbeiten - main ist geschützt.
3. Setze die Zeile "R3 - Datenbank-Integrität" in WORK_STATUS.md auf "in Bearbeitung",
   trage Branch und Datum ein, und committe das als ersten Commit.

Inhalt des Arbeitspakets:

Drei Spalten verweisen fachlich auf game_servers, tragen aber keinen Fremdschlüssel, weil
die Tabelle bei ihrer Entstehung noch nicht existierte. Inzwischen gibt es sie (B3).

Die Löschregeln sind in den Gefundenen Punkten bereits durchdacht - übernimm sie und
denke sie nicht neu:

- schedules.server_id -> ON DELETE CASCADE.
  Eine geplante Aufgabe ohne Server hat keine Bedeutung.

- port_allocations.server_id -> ON DELETE CASCADE.
  Bis dahin räumt nur releaseForServer() auf; ein Server-Löschen daran vorbei hinterlässt
  eine verwaiste Zuordnung, und der Port bleibt dauerhaft belegt.

- backups.server_id -> ausdrücklich KEIN Cascade.
  Ein Backup soll seinen Server überleben, damit sich ein gelöschter Server aus einer
  Sicherung wiederherstellen lässt (Lastenheft §3.3). Prüfe, ob ON DELETE SET NULL passt -
  dann muss die Spalte nullable sein und der Code damit umgehen können.
  backups.owner_id hängt bewusst am Konto, nicht am Server.

Verbindliche Vorgaben:
- Ausschließlich über eine Drizzle-Migration, nie manuell an der laufenden Datenbank.
- Prüfe, ob bereits verwaiste Datensätze existieren - eine Migration, die an bestehenden
  Daten scheitert, ist im Betrieb schlimmer als keine. Räume sie in derselben Migration
  auf oder begründe, warum es keine geben kann.
- Prüfe, ob R2 parallel läuft - dann stimmt euch über die Migrationsnummern ab, sonst
  bricht die Migrationskette (pnpm --filter @palantir/backend db:check).
- Die Migration gegen die Dev-Datenbank tatsächlich ausführen, nicht nur erzeugen.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test ausführen.
Zum Abschluss main holen (pull/rebase), pushen, Pull Request, grünen CI-Lauf abwarten.
```

## R4 – Frontend-Fundament

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln für jede Sitzung)
- PFLICHTENHEFT.md (besonders §5.2 permissions-Objekt)
- STRUKTUR.md      (F2 ist Grundlage für F3-F11)
- LASTENHEFT.md    (besonders §4: Deutsch, Mobile-First)

Dein Arbeitspaket: R4 - Frontend-Fundament
Dieses Paket steht nicht in STRUKTUR.md. Es schließt die Gefundenen Punkte 26, 47, 30
und 48 aus WORK_STATUS.md.

WICHTIG: Dieses Paket ist Voraussetzung für F4-F11. Solange es fehlt, baut jedes dieser
Pakete dieselben Formularteile erneut - F1 und F3 haben es bereits getan, jeweils lokal
und leicht unterschiedlich.

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob R4 bereits in Bearbeitung ist. Falls ja: melde das.
2. Lege einen eigenen Branch an: git checkout -b r4/frontend-fundament (vom aktuellen
   main). Niemals direkt auf main arbeiten - main ist geschützt.
3. Setze die Zeile "R4 - Frontend-Fundament" in WORK_STATUS.md auf "in Bearbeitung",
   trage Branch und Datum ein, und committe das als ersten Commit.

Inhalt des Arbeitspakets:

A) Formular-Bausteine nach F2 heben (Punkte 26 und 47)
   F3 hat sie in apps/frontend/src/components/servers/form/Fields.tsx bereits gebaut -
   ausschließlich mit Tokens, ohne literale Farb- oder Radiuswerte: FieldShell, TextField,
   NumberField, SelectField, SliderField, Toggle, ToggleRow.
   F1 hat unter src/app/(auth)/_components eigene Teile: AuthField, AuthFormMessage,
   AuthHeading.
   - Nimm die F3-Fassung als Vorlage, hebe sie nach components/shared und ergänze, was F1
     zusätzlich braucht: eine Meldungszeile im Formular (nicht Toast, nicht Modal) und
     einen Datums-Format-Helfer in utils/format.ts.
   - Stelle danach F1 UND F3 auf die gemeinsame Fassung um. Zwei Parallelvarianten stehen
     zu lassen wäre schlechter als der jetzige Zustand.
   - Prüfe vorher, was in components/shared schon existiert, statt daneben zu bauen.

B) Testumgebung für Komponenten (Punkt 30)
   vitest läuft im Frontend nur mit Node-Umgebung; jsdom und Testing Library fehlen.
   Deshalb hat F1 ausschließlich die Logik unter src/lib getestet, keine Ansicht.
   - Richte die Umgebung ein und belege sie mit mindestens einem echten Test je neuem
     Formular-Baustein - sonst ist es nur Konfiguration.
   - Neue Abhängigkeiten benennen und begründen (CLAUDE.md §1).
   - Achte darauf, dass pnpm test im Monorepo weiterhin für alle Workspaces durchläuft
     und die CI-Laufzeit nicht unnötig steigt.

C) Konvention für die Navigation festhalten (Punkt 48)
   Das Layout des eingeloggten Bereichs (layout.tsx, DashboardShell, DashboardNav,
   SessionProvider) hat F3 angelegt, weil STRUKTUR.md es keinem Paket zuweist.
   Jedes weitere Frontend-Paket ergänzt in DashboardNav.tsx nur seinen eigenen Eintrag um
   ein href; bis dahin meldet der Eintrag beim Antippen, dass die Ansicht noch entsteht,
   statt in eine 404-Seite zu laufen.
   - Halte das als kurze Anleitung fest (README im shared-Ordner oder Kommentar in
     DashboardNav.tsx), damit F4-F11 es nicht jeweils neu herausfinden.

Verbindliche Vorgaben:
- Oberflächensprache ausschließlich Deutsch (Lastenheft §4).
- Mobile-First.
- Nur Tokens, keine literalen Farb- oder Radiuswerte - das ist der Grund, warum es F2 gibt.
- Keine Berechtigungslogik im Frontend; gezeigt wird anhand des permissions-Objekts aus
  dem DTO (Pflichtenheft §5.2).
- Ein Mockup liegt entpackt unter docs/mockup - daran orientieren.
- Dokumentiere im shared-Ordner, welche Bausteine es gibt und wie sie zu verwenden sind.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test ausführen.
Zum Abschluss main holen (pull/rebase), pushen, Pull Request, grünen CI-Lauf abwarten.
```

## R5 – ALTCHA beim Login

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst vollständig und behandle sie als verbindlich:
- CLAUDE.md        (Verhaltensregeln, besonders §2: Sicherheit ist nicht verhandelbar)
- PFLICHTENHEFT.md (besonders §7 Auth und §18 Sicherheitskonzept)
- STRUKTUR.md
- LASTENHEFT.md    (besonders §3.1)

Dein Arbeitspaket: R5 - ALTCHA beim Login
Dieses Paket steht nicht in STRUKTUR.md. Es schließt den Gefundenen Punkt 52 aus
WORK_STATUS.md. Das ist keine Aufräumarbeit, sondern eine offene Sicherheitsanforderung.

Bevor du irgendetwas am Code änderst:
1. Lies WORK_STATUS.md. Prüfe, ob R5 bereits in Bearbeitung ist. Falls ja: melde das.
2. Lege einen eigenen Branch an: git checkout -b r5/altcha-login (vom aktuellen main).
   Niemals direkt auf main arbeiten - main ist geschützt.
3. Setze die Zeile "R5 - ALTCHA beim Login" in WORK_STATUS.md auf "in Bearbeitung",
   trage Branch und Datum ein, und committe das als ersten Commit.

Der Befund:

Pflichtenheft §7 verlangt "ALTCHA-Verifikation + IP-basiertes Rate-Limiting auf
Registrierung UND Login". Umgesetzt ist es nur für die Registrierung:
- packages/validation/src/auth.ts: loginInputSchema führt altcha als optional(),
  das Registrierungs-Schema verlangt es.
- LoginView.tsx enthält keinen einzigen Verweis auf ALTCHA, RegisterView.tsx elf.

Das IP-Rate-Limit auf dem Login existiert bereits (AUTH_RATE_LIMIT_LOGIN_MAX), Brute
Force ist also nicht ungeschützt - aber die zweite, vorgeschriebene Schicht fehlt.

Inhalt des Arbeitspakets:
- Frontend: das vorhandene AltchaWidget in den Login einbinden, so wie es die
  Registrierung bereits tut. Keine zweite Variante bauen.
- Validierung: altcha im loginInputSchema von optional() auf verpflichtend umstellen.
- Backend: die Prüfung im Login-Pfad tatsächlich auswerten, mit demselben Verfahren wie
  bei der Registrierung.
- Prüfe dabei, ob eine bereits eingelöste Challenge ein zweites Mal gelten würde - ein
  Proof-of-Work, der mehrfach verwendbar ist, schützt nicht.

Verbindliche Vorgaben:
- Kein Auth-Bypass, auch nicht für lokale Entwicklung oder Tests. Nutze stattdessen
  Testdoubles, wie B1 es bereits tut.
- Response-Envelope aus Pflichtenheft §5.1; der Fehlercode für eine fehlgeschlagene
  Prüfung existiert bereits im Katalog - keinen neuen erfinden.
- Die Umstellung des Schemas auf verpflichtend ist ein Breaking Change an
  packages/validation. Kennzeichne ihn im Commit und im PR ausdrücklich als solchen
  (CLAUDE.md §3) und prüfe, wer das Schema sonst noch nutzt.
- Tests: dass ein Login ohne gültigen Nachweis abgelehnt wird, und dass derselbe Nachweis
  nicht zweimal zählt.

Vor jeder "erledigt"-Meldung: pnpm build, pnpm lint und pnpm test ausführen.
Zum Abschluss main holen (pull/rebase), pushen, Pull Request, grünen CI-Lauf abwarten.
```
