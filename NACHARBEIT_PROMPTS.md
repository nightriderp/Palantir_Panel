# Nacharbeit – Sitzungs-Prompts aus den offenen Punkten

Kleine, in sich abgeschlossene Arbeitspakete, abgeleitet aus dem Abschnitt
**„Gefundene Punkte"** in [WORK_STATUS.md](WORK_STATUS.md) (Stand 2026-08-29).
Gedacht als Ergänzung zu [SITZUNGS_PROMPTS.md](SITZUNGS_PROMPTS.md) – gleiches Prinzip:
**Den Block des gewünschten Pakets vollständig kopieren und unverändert in eine neue
Claude-Code-Sitzung im Repo-Root einfügen.** Jeder Prompt ist eigenständig.

> **Wichtig – Status ist nicht verlässlich gepflegt.** Beim Erstellen dieser Liste fiel auf,
> dass Punkt **#65** („zwei 2FA-Tests schlagen fehl") längst grün ist (`service.test.ts`,
> 59/59), aber nie auf `erledigt` gesetzt wurde. Genau deshalb steht **N0 (Triage)** zuerst:
> mehrere Altpunkte (#8–#76) wurden vermutlich mit ihren Folge-Paketen miterledigt, ohne dass
> die Zeile aktualisiert wurde. **N0 vor den inhaltlichen Paketen laufen lassen**, sonst baut
> man womöglich etwas, das schon existiert.

## Reihenfolge / Priorität

| Prio                         | Pakete                           | Thema                                                           |
| ---------------------------- | -------------------------------- | --------------------------------------------------------------- |
| **0 – zuerst**               | N0                               | Triage & Status-Pflege (kein Code)                              |
| **1 – Sicherheit & Blocker** | N1, N2, N3, N4, N5, N6           | SSH, Dev-DB, Path-Traversal, Checksummen, TOCTOU, Error-Handler |
| **2 – Betrieb/Deployment**   | N7, N8                           | Compose-Dateien, setup.sh                                       |
| **3 – Feature-Verdrahtung**  | N9, N10, N11, N12, N13, N14, N15 | Ereignisse, Kontingente, Routen, DMs, Lesezustand               |

**Konfliktdateien** (wie in SITZUNGS_PROMPTS.md): `WORK_STATUS.md`, `.env.example` und bei
Backend-Paketen `apps/backend/src/server.ts` fasst fast jede Sitzung an – vor jedem Push
`git pull --rebase`, immer nur die eigene Zeile/den eigenen Block anfassen. **Nicht zwei
`packages/contracts`-PRs gleichzeitig** (betrifft N11, N14, N15).

---

## Standard-Kopf (in jedem Prompt enthalten)

Jeder Prompt beginnt mit demselben Rahmen; er ist bewusst in jeden Block hineinkopiert, damit
er allein funktioniert:

1. Verbindliche Dokumente lesen: `CLAUDE.md`, `PFLICHTENHEFT.md`, `LASTENHEFT.md`,
   `WORK_STATUS.md`.
2. **Vor Arbeitsbeginn**: `WORK_STATUS.md` **und** die offenen PRs/Remote-Branches ansehen
   (`gh pr list`, `git ls-remote --heads origin`) – ob jemand denselben Punkt schon bearbeitet.
3. Eigenen Branch von aktuellem `main` anlegen, nie direkt auf `main`.
4. Am Ende die CI-Schritte lokal ausführen: `pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm format:check` (bei Migrationen zusätzlich `pnpm --filter @palantir/backend db:check`).
5. Betroffene „Gefundene Punkte" in `WORK_STATUS.md` auf `erledigt` setzen.
6. **Token sparen (in jedem Prompt verpflichtend):** zu Beginn den **caveman-Modus**
   (`/caveman`) aktivieren (komprimierte Ausgaben, ~65 % weniger Output-Tokens) und zum
   Lokalisieren **graphify** nutzen statt breit im Repo zu lesen –
   `graphify query "<stichworte>"` gegen das bereits gebaute `graphify-out/graph.json`, dann
   nur die gefundenen Dateien/Funktionen gezielt öffnen. Achtung: Der Graph spiegelt den Stand
   vom 2026-08-29; er ist zum **Auffinden** gedacht, die Wahrheit ist immer der aktuelle Code.

---

# N0 – Triage der Altpunkte & Status-Pflege

> Kein Code. Eine kurze Sitzung. Räumt den Abschnitt „Gefundene Punkte" auf, damit die
> folgenden Pakete nicht Erledigtes doppelt bauen.

```
Du arbeitest am Projekt Palantir (Monorepo, pnpm Workspaces + Turborepo).

Lies zuerst verbindlich: CLAUDE.md (§6, §7), WORK_STATUS.md (kompletter Abschnitt
"Gefundene Punkte").

Aufgabe: TRIAGE der offenen "Gefundene Punkte" – nur Doku, kein Feature-Code.

Token sparen (Pflicht): Aktiviere zu Beginn den caveman-Modus (/caveman) für komprimierte
Ausgaben, und nutze zum Lokalisieren graphify statt das Repo breit zu lesen –
graphify query "<stichworte zum punkt>" gegen graphify-out/graph.json, um die Fundstelle
je Punkt gezielt zu prüfen (kein Voll-Scan). Der Graph liegt bereits gebaut vor.
Branch: git checkout -b n0/status-triage (von aktuellem main).

Vorgehen für JEDEN Punkt mit Status "offen" in der Nummernspanne #8 bis #76:
1. Lies die Beschreibung und die genannte Fundstelle.
2. Prüfe im aktuellen Code, ob das inzwischen durch ein fertiges Arbeitspaket erledigt ist
   (Beispiel: #65 – die 2FA-Tests in apps/backend/src/modules/auth/service.test.ts laufen
   grün, also erledigt). Belege es kurz: welche Datei/welcher Test zeigt es.
3. Ist es erledigt: Status auf "erledigt" setzen und in der Beschreibung EINEN Satz ergänzen,
   der sagt, wodurch (Datei/Commit/Paket).
4. Ist es noch offen: unverändert lassen.

Konkret bereits bekannt:
- #65: erledigt (service.test.ts 59/59 grün).
- #77: sechs Punkt-Zeilen enthalten einen UNMASKIERTEN senkrechten Strich, den Markdown als
  Zellengrenze liest (u. a. #19, #69, #77 selbst). Diese Pipes in den Beschreibungen als
  \| maskieren, damit die Tabelle wieder korrekt rendert. Danach #77 auf erledigt.
- #69: Prüfen, ob der beschriebene Textrest noch in der Datei steht; falls nein, erledigt.

Nichts anderes anfassen. Am Ende die eigene Triage-Zeile NICHT nötig – das hier ist reine
Pflege. Führe pnpm format:check aus (WORK_STATUS.md muss Prettier-konform bleiben) und
committe mit Prefix [n0].
```

---

# N1 – Homeserver-SSH im Tunnel abdichten (#85)

> Sicherheit/Deployment. Klein. **Kein Anwendungscode**, nur Deployment-Konfiguration/Doku.

```
Du arbeitest am Projekt Palantir. Lies verbindlich: CLAUDE.md (§2, §9), PFLICHTENHEFT.md
(§2.2/§2.3 Architektur & Hardening, Netzwerk/WireGuard), WORK_STATUS.md (Gefundener Punkt 85).

Vor Arbeitsbeginn: WORK_STATUS.md und gh pr list / git ls-remote --heads origin prüfen.
Token sparen (Pflicht): Aktiviere zu Beginn den caveman-Modus (/caveman) für komprimierte
Ausgaben, und nutze zum Lokalisieren graphify statt das Repo breit zu lesen –
graphify query "<stichworte zum thema>" gegen graphify-out/graph.json, dann gezielt nur die
so gefundenen Dateien/Funktionen öffnen (kein Voll-Scan). Der Graph liegt bereits gebaut vor.
Branch: git checkout -b n1/ssh-hardening (von main). Commit-Prefix [deploy].

Problem (Gefundener Punkt 85): Der Homeserver nimmt im WireGuard-Tunnel eingehende
Verbindungen an – SSH-Port 22 ist von der VPS aus offen (Nachlass der Einrichtung). Das
widerspricht dem Prinzip aus dem Pflichtenheft: vom VPS zum Homeserver soll nur der
notwendige ausgehende Agent-Kanal bestehen, keine offene Verwaltungsschnittstelle.

Aufgabe:
1. Lege im Deployment (deploy/ bzw. die entsprechende WireGuard-/Firewall-Konfiguration und
   SETUP.md) fest, dass auf dem Homeserver eingehender SSH-Zugriff aus dem Tunnel-Netz
   standardmäßig blockiert ist. Beschreibe die konkrete Regel (z. B. Host-Firewall/iptables
   oder wg-Peer AllowedIPs), mit exaktem Pfad und Zielmaschine (Homeserver).
2. Wenn Fernwartung nötig ist, dokumentiere den bewussten, eng begrenzten Ausnahmeweg
   (welche Quell-IP, welcher Port) statt "Port 22 offen für alle im Tunnel".
3. In SETUP.md den Schritt aufnehmen/korrigieren, damit eine Neu-Einrichtung nicht wieder in
   diesem Zustand endet.

WICHTIG (CLAUDE.md §9): Für jede Datei/Regel, die der Nutzer selbst auf einer Maschine
platzieren muss, den EXAKTEN Pfad und die Zielmaschine (VPS vs. Homeserver) nennen.

Kein Anwendungscode betroffen; CI-Schritte trotzdem laufen lassen, falls Dateien im Repo
verändert wurden (mind. pnpm format:check). Gefundenen Punkt 85 auf erledigt setzen.
```

---

# N2 – Dev-DB: Migrationskette reparieren (#66, dazu #64)

> Datenbank/Grundgerüst. Klein bis mittel, aber heikel – **blockiert jede weitere DB-Arbeit**.

```
Du arbeitest am Projekt Palantir. Lies verbindlich: CLAUDE.md (§4 Migrationen, §7),
PFLICHTENHEFT.md (Datenmodell/Migrationen), WORK_STATUS.md (Gefundene Punkte 66 und 64).

Vor Arbeitsbeginn: WORK_STATUS.md und gh pr list / git ls-remote --heads origin prüfen –
Migrations-Arbeit darf nicht parallel laufen.
Token sparen (Pflicht): Aktiviere zu Beginn den caveman-Modus (/caveman) für komprimierte
Ausgaben, und nutze zum Lokalisieren graphify statt das Repo breit zu lesen –
graphify query "<stichworte zum thema>" gegen graphify-out/graph.json, dann gezielt nur die
so gefundenen Dateien/Funktionen öffnen (kein Voll-Scan). Der Graph liegt bereits gebaut vor.
Branch: git checkout -b n2/db-migrationskette
(von main). Commit-Prefix [db].

Problem (Gefundener Punkt 66): Die gemeinsam genutzte Dev-Datenbank ist aus dem Tritt –
drizzle.__drizzle_migrations passt nicht mehr zur Migrationskette in main, ein db:migrate
läuft nicht sauber durch. Dadurch ist die Kette weder lokal anwendbar noch prüfbar.

Aufgabe:
1. Bestandsaufnahme: apps/backend/drizzle/ Migrationsordner + Journal vs. Stand der
   __drizzle_migrations-Tabelle. Genau benennen, wo die Kette bricht.
2. Kette in main-konformen Zustand bringen: db:check muss sauber sein, db:migrate muss auf
   einer frischen Datenbank vollständig durchlaufen (Reihenfolge 0001..NNNN vollständig).
   Keine manuellen Eingriffe an der laufenden DB (CLAUDE.md §4) – alles über Drizzle Kit.
3. Falls dabei eine verwaiste/lokal abweichende Migration existiert, sauber neu generieren
   (nicht mischen): mains Kette übernehmen, eigene .sql entfernen, neu generieren.
4. Prüfe im selben Zug Gefundenen Punkt 64: backups.server_id / schedules.server_id
   Fremdschlüssel – ob R3 (Migration 0009) das bereits abdeckt; wenn ja, #64 als erledigt
   markieren, wenn nein, hier NICHT mit erledigen, sondern nur den Status präzisieren.
5. Verifiziere gegen eine FRISCHE lokale DB (nicht nur "kompiliert").

CI-Schritte inkl. pnpm --filter @palantir/backend db:check ausführen. Punkt 66 auf erledigt,
Vorgehen in der Notiz dokumentieren.
```

---

# N3 – Agent: Dateizugriff auf den Server-Datenordner einsperren (#100)

> Agent-Sicherheit. Klein. Path-Traversal-Härtung.

```
Du arbeitest am Projekt Palantir. Lies verbindlich: CLAUDE.md (§2, §4 – Agent spricht nur
über ContainerRuntime), PFLICHTENHEFT.md (Agent/Dateimanager, Hardening), WORK_STATUS.md
(Gefundener Punkt 100).

Vor Arbeitsbeginn: WORK_STATUS.md + gh pr list / git ls-remote --heads origin prüfen.
Token sparen (Pflicht): Aktiviere zu Beginn den caveman-Modus (/caveman) für komprimierte
Ausgaben, und nutze zum Lokalisieren graphify statt das Repo breit zu lesen –
graphify query "<stichworte zum thema>" gegen graphify-out/graph.json, dann gezielt nur die
so gefundenen Dateien/Funktionen öffnen (kein Voll-Scan). Der Graph liegt bereits gebaut vor.
Branch: git checkout -b n3/agent-dateizugriff (von main). Commit-Prefix [a].

Problem (Gefundener Punkt 100): Der Datei-Manager (FILE_LIST/READ/WRITE im Agent) ist nicht
auf den Server-Datenordner beschränkt. assertAbsoluteContainerPath prüft nur "absolut und
NUL-frei", nicht "innerhalb des erlaubten Server-Datenverzeichnisses". Damit ließe sich
prinzipiell außerhalb des Servers lesen/schreiben.

Aufgabe:
1. Finde die Prüfung (apps/agent/src/... – assertAbsoluteContainerPath und die FILE_*-Jobs).
2. Ergänze eine Einsperrung: jeder aufgelöste Zielpfad MUSS innerhalb des dem Server
   zugeordneten Datenverzeichnisses liegen (nach Auflösung von .., Symlinks so weit sinnvoll,
   und ohne Ausbruch über absolute Pfade). Verstoß → definierter Fehler (bestehenden
   Fehlercode nutzen, keinen Freitext – CLAUDE.md §5).
3. Analog zur bereits vorhandenen resolveWithinDirectory-Logik der Backup-/Storage-Jobs
   arbeiten (nicht neu erfinden – prüfen, ob das dort schon existiert und wiederverwendbar ist).
4. Tests: Ausbruchsversuche (.., absoluter Fremdpfad, Symlink-Trick soweit testbar) werden
   abgelehnt; legitime Pfade im Datenordner funktionieren weiter.

CI-Schritte ausführen. Punkt 100 auf erledigt.
```

---

# N4 – Backup-Prüfsumme bei Restore/Download verifizieren (#99)

> B5/A3. Klein. Datenintegrität.

```
Du arbeitest am Projekt Palantir. Lies verbindlich: CLAUDE.md (§4, §5), PFLICHTENHEFT.md
(Backups, §14), LASTENHEFT.md (§3.3/§3.7 Backups), WORK_STATUS.md (Gefundener Punkt 99).

Vor Arbeitsbeginn: WORK_STATUS.md + gh pr list / git ls-remote --heads origin prüfen.
Token sparen (Pflicht): Aktiviere zu Beginn den caveman-Modus (/caveman) für komprimierte
Ausgaben, und nutze zum Lokalisieren graphify statt das Repo breit zu lesen –
graphify query "<stichworte zum thema>" gegen graphify-out/graph.json, dann gezielt nur die
so gefundenen Dateien/Funktionen öffnen (kein Voll-Scan). Der Graph liegt bereits gebaut vor.
Branch: git checkout -b n4/backup-checksum-verify (von main). Commit-Prefix [b5].

Problem (Gefundener Punkt 99): checksumSha256 wird beim Anlegen eines Backups gespeichert und
angezeigt, aber bei Restore und Download nie gegen das tatsächliche Archiv geprüft. Eine
beschädigte oder veränderte Sicherung fällt damit nicht auf.

Aufgabe:
1. Kläre die Zuständigkeit: Die SHA-256 wird im Agent (A3, streamender TAR-GZIP-Codec) über
   das fertige Archiv gebildet. Die Verifikation gehört dorthin, wo das Archiv wieder gelesen
   wird (Restore/Download). Entscheide sauber Backend (B5) vs. Agent (A3) und begründe es kurz.
2. Bei RESTORE_BACKUP und DOWNLOAD_BACKUP die gespeicherte Prüfsumme gegen das real gelesene
   Archiv verifizieren; Abweichung → definierter Fehler (bestehender Fehlercode-Katalog,
   sonst neuen benannten Code ergänzen und im Pflichtenheft-Katalog eintragen – CLAUDE.md §5/§8).
3. Streaming beibehalten (keine Vollpufferung mehrerer GB – Prüfsumme mitlaufend berechnen).
4. Tests: korrektes Archiv passiert, manipuliertes/abgeschnittenes Archiv wird abgelehnt.

CI-Schritte ausführen. Punkt 99 auf erledigt.
```

---

# N5 – Kapazitätsprüfung: TOCTOU-Rennen serialisieren (#98)

> B3/B4/Datenbank. Mittel. Nebenläufigkeits-Korrektheit.

```
Du arbeitest am Projekt Palantir. Lies verbindlich: CLAUDE.md (§4), PFLICHTENHEFT.md (§10
Ressourcen & Kapazität), WORK_STATUS.md (Gefundener Punkt 98).

Vor Arbeitsbeginn: WORK_STATUS.md + gh pr list / git ls-remote --heads origin prüfen.
Token sparen (Pflicht): Aktiviere zu Beginn den caveman-Modus (/caveman) für komprimierte
Ausgaben, und nutze zum Lokalisieren graphify statt das Repo breit zu lesen –
graphify query "<stichworte zum thema>" gegen graphify-out/graph.json, dann gezielt nur die
so gefundenen Dateien/Funktionen öffnen (kein Voll-Scan). Der Graph liegt bereits gebaut vor.
Branch: git checkout -b n5/kapazitaet-toctou (von main). Commit-Prefix [b3].

Problem (Gefundener Punkt 98): Die Kapazitätsprüfung ist ein TOCTOU-Rennen ohne
Serialisierung: assertResourcesAvailable liest die Belegung, der Insert/Statuswechsel folgt
separat. Zwei gleichzeitige START/CREATE könnten beide die Prüfung bestehen und zusammen die
Node- oder Nutzer-Kapazität überschreiten.

Aufgabe:
1. Prüfung und schreibende Aktion (Server anlegen / auf START-Belegung setzen) in EINER
   serialisierten Datenbank-Transaktion zusammenführen – z. B. passende Sperre auf die Node-
   bzw. Nutzer-Zeile (SELECT ... FOR UPDATE) oder eine geeignete Isolation, sodass die
   Belegungsprüfung und der Insert atomar sind.
2. Keine zweite Kapazitätslogik bauen – die bestehende checkCapacity()/assertStartCapacity()
   aus B4 weiterverwenden, nur den transaktionalen Rahmen ergänzen (CLAUDE.md §3/§4).
3. Bei Verletzung weiterhin RESOURCE_LIMIT_EXCEEDED (bestehender Code).
4. Test: Zwei nebenläufige Starts, die einzeln je passen, dürfen zusammen die Kapazität nicht
   überschreiten – einer scheitert deterministisch.

CI-Schritte inkl. db:check ausführen (falls Migration/Constraint nötig). Punkt 98 auf erledigt.
```

---

# N6 – Globaler Fastify-Error-Handler (#97)

> Grundgerüst/alle Backend-Pakete. Klein.

```
Du arbeitest am Projekt Palantir. Lies verbindlich: CLAUDE.md (§5 Fehlerbehandlung & API),
PFLICHTENHEFT.md (§5.1 Envelope, Fehlercode-Katalog), WORK_STATUS.md (Gefundener Punkt 97).

Vor Arbeitsbeginn: WORK_STATUS.md + gh pr list / git ls-remote --heads origin prüfen.
Token sparen (Pflicht): Aktiviere zu Beginn den caveman-Modus (/caveman) für komprimierte
Ausgaben, und nutze zum Lokalisieren graphify statt das Repo breit zu lesen –
graphify query "<stichworte zum thema>" gegen graphify-out/graph.json, dann gezielt nur die
so gefundenen Dateien/Funktionen öffnen (kein Voll-Scan). Der Graph liegt bereits gebaut vor.
Branch: git checkout -b n6/global-error-handler (von main). Commit-Prefix [grundgeruest].

Problem (Gefundener Punkt 97): Kein globaler setErrorHandler. Jede Route fängt
Geschäftsfehler selbst ab; unerwartete Fehler (rohe DB-/Laufzeitfehler) werden weitergeworfen
und verlassen die App NICHT im Envelope-Format – inkonsistent und potenziell mit
Implementierungsdetails nach außen.

Aufgabe:
1. In apps/backend/src/server.ts (buildServer) einen globalen setErrorHandler registrieren,
   der unbehandelte Fehler auf einen generischen INTERNAL-Fehlercode im Envelope (§5.1)
   abbildet, mit passendem HTTP-Status, ohne Stacktrace/Interna nach außen (Logging serverseitig).
2. Bestehende, bewusst pro Route abgefangene Geschäftsfehler bleiben unverändert – der
   Handler ist nur das Sicherheitsnetz für Unerwartetes.
3. Falls kein passender generischer Fehlercode existiert, einen benannten Code ergänzen und im
   Pflichtenheft-Katalog eintragen (CLAUDE.md §8), keinen Freitext.
4. Test: eine Route, die absichtlich einen rohen Fehler wirft, antwortet trotzdem im Envelope
   mit dem generischen Code und passendem Status.

CI-Schritte ausführen. Punkt 97 auf erledigt.
```

---

# N7 – Deployment: r1-Branch klären + Compose-Dateien VPS/Homeserver (#2)

> Deployment. Mittel. **Zuerst den nicht gemergten Branch prüfen, damit begonnene Arbeit
> nicht verloren geht.**

```
Du arbeitest am Projekt Palantir. Lies verbindlich: CLAUDE.md (§6, §8, §9), PFLICHTENHEFT.md
(§12.3 Deployment, Architektur VPS↔Homeserver, Docker-Hardening §2.3), WORK_STATUS.md
(Gefundener Punkt 2). LASTENHEFT.md zur Einordnung.

Vor Arbeitsbeginn:
- WORK_STATUS.md lesen.
- gh pr list und git ls-remote --heads origin ansehen.
- BESONDERS: git log origin/main..origin/r1/ersteinrichtung ansehen. Dort liegt ein NICHT
  gemergter Commit "[ersteinrichtung] Owner-Schritt auf der VPS ueber Docker statt pnpm",
  der u. a. deploy/vps/docker-compose.yml (neu) und den Owner-Ablauf enthält. Entscheide
  zuerst: Ist diese Arbeit noch gewünscht? Wenn ja, als Grundlage übernehmen (rebase/cherry-
  pick auf den neuen Branch), NICHT ignorieren und parallel neu bauen.

Token sparen (Pflicht): Aktiviere zu Beginn den caveman-Modus (/caveman) für komprimierte
Ausgaben, und nutze zum Lokalisieren graphify statt das Repo breit zu lesen –
graphify query "<stichworte zum thema>" gegen graphify-out/graph.json, dann gezielt nur die
so gefundenen Dateien/Funktionen öffnen (kein Voll-Scan). Der Graph liegt bereits gebaut vor.
Branch: git checkout -b n7/deployment-compose (von main). Commit-Prefix [deploy].

Problem (Gefundener Punkt 2): docker-compose.yml für VPS- UND Homeserver-Seite fehlt
(teilweise auf r1 begonnen). SETUP.md hat nur den DB-Abschnitt ausgearbeitet; VPS, OAuth-Apps,
WireGuard, Homeserver-VM und Owner-Ersteinrichtung fehlen.

Aufgabe:
1. Compose-Stacks nach Pflichtenheft: VPS-Seite (Backend, Frontend, DB, Owner-Einrichtdienst,
   Reverse-Proxy soweit vorgesehen) und Homeserver-Seite (Agent + Docker-Socket-Proxy).
   Hardening-Vorgaben aus §2.3 auf JEDE Container-Definition anwenden: no-new-privileges,
   Resource-Limits, Socket-Proxy statt direktem Docker-Socket.
2. SETUP.md ausbauen: VPS-Aufsetzung, OAuth-Apps (Discord/Twitch/Steam) mit den nötigen
   Redirect-URIs, WireGuard (VPS↔Homeserver), Homeserver-VM, Owner-Ersteinrichtung.
3. Für jede Datei, die der Nutzer selbst platzieren muss, EXAKTEN Pfad und Zielmaschine
   nennen (CLAUDE.md §9).
4. Neue .env-Variablen mit Kommentar in .env.example ergänzen (CLAUDE.md §8).

Hängt thematisch mit N1 (SSH) und N8 (setup.sh) zusammen – nicht gleichzeitig dieselben
Deploy-Dateien mit denen bearbeiten. CI-Schritte (mind. format:check) ausführen. Punkt 2 auf
erledigt bzw. den erreichten Stand präzise notieren.
```

---

# N8 – setup.sh: DB-Passwort & wg0.conf automatisch erzeugen (#4)

> Grundgerüst/Deployment. Klein.

```
Du arbeitest am Projekt Palantir. Lies verbindlich: CLAUDE.md (§2, §9), PFLICHTENHEFT.md
(§12.1 .env, Deployment), WORK_STATUS.md (Gefundener Punkt 4).

Vor Arbeitsbeginn: WORK_STATUS.md + gh pr list / git ls-remote --heads origin prüfen (v. a.
deploy/-Branches und N7, damit ihr euch nicht bei setup.sh/SETUP.md überschneidet).
Token sparen (Pflicht): Aktiviere zu Beginn den caveman-Modus (/caveman) für komprimierte
Ausgaben, und nutze zum Lokalisieren graphify statt das Repo breit zu lesen –
graphify query "<stichworte zum thema>" gegen graphify-out/graph.json, dann gezielt nur die
so gefundenen Dateien/Funktionen öffnen (kein Voll-Scan). Der Graph liegt bereits gebaut vor.
Branch: git checkout -b n8/setup-automatisierung (von main). Commit-Prefix [grundgeruest].

Problem (Gefundener Punkt 4, markiert als TODO in scripts/setup.sh):
- POSTGRES_PASSWORD wird nicht automatisch erzeugt; POSTGRES_PASSWORD und DATABASE_URL müssen
  konsistent in die .env geschrieben werden.
- Fertige wg0.conf-Dateien werden nicht generiert.

Aufgabe:
1. In scripts/setup.sh: sicheres Zufallspasswort erzeugen, es sowohl als POSTGRES_PASSWORD als
   auch konsistent in DATABASE_URL schreiben – idempotent (bereits gesetzte Werte nicht
   überschreiben, nur leere füllen; bestehende get_env_value/set_env_value-Helfer nutzen).
2. WireGuard-Konfiguration (wg0.conf) für die vorgesehenen Peers generieren; welche Datei auf
   welche Maschine gehört (VPS vs. Homeserver) mit exaktem Zielpfad ausgeben (CLAUDE.md §9).
3. Keine Secrets ins Repo schreiben (CLAUDE.md §2) – nur in die lokale, ungetrackte .env bzw.
   an die genannten Zielorte.
4. TODO-Marker im Skript entfernen, sobald erledigt.

CI-Schritte (mind. format:check) ausführen. Punkt 4 auf erledigt.
```

---

# N9 – Notification-Auslöser verdrahten (#80, #81, #82)

> B4/B6/B1. Klein bis mittel. Ereignisse feuern lassen.

```
Du arbeitest am Projekt Palantir. Lies verbindlich: CLAUDE.md (§3, §5), PFLICHTENHEFT.md
(§14 Notifications, Event-Katalog), WORK_STATUS.md (Gefundene Punkte 80, 81, 82).

Vor Arbeitsbeginn: WORK_STATUS.md + gh pr list / git ls-remote --heads origin prüfen.
Token sparen (Pflicht): Aktiviere zu Beginn den caveman-Modus (/caveman) für komprimierte
Ausgaben, und nutze zum Lokalisieren graphify statt das Repo breit zu lesen –
graphify query "<stichworte zum thema>" gegen graphify-out/graph.json, dann gezielt nur die
so gefundenen Dateien/Funktionen öffnen (kein Voll-Scan). Der Graph liegt bereits gebaut vor.
Branch: git checkout -b n9/notification-ausloeser (von main). Commit-Prefix [b6].

Problem: Die Notification-Engine (B6) ist fertig, aber zwei Ereignisse werden von niemandem
ausgelöst:
- #80 resource.low: evaluateNodeWarnings()/evaluateServerWarnings() (B4) rechnen die Nutzlast
  aus, werden aber nicht aufgerufen. Passender Takt fehlt.
- #81 user.registered: steht im Katalog mit Text/Empfängerkreis/Nutzlast (B6), wird bei der
  Registrierung (B1) nicht gefeuert.
- #82 (Kontext): frische Installation hat keine Regeln – prüfen, ob das nur Doku ist oder ob
  eine sinnvolle Default-Regel angelegt werden soll (mit Owner/Admin abstimmen, im Zweifel als
  Doku belassen, nicht eigenmächtig Scope erweitern – CLAUDE.md §1).

Aufgabe:
1. resource.low: an geeigneter periodischer Stelle (apps/backend/src/scheduler.ts – existiert
   bereits als EINE periodische Auslösestelle) die Warnungs-Auswertung aufrufen und die
   resource.low-Nutzlast in die bestehende Ereignissenke geben. Kein Polling-Wildwuchs, nur
   den vorhandenen Scheduler-Takt nutzen.
2. user.registered: im Auth-Registrierungspfad (B1) das Ereignis über die bestehende
   Ereignissenke publizieren – so wie B3/B5/B7 es bereits tun (publish() wirft nie, §14).
3. #82 sauber einordnen und Status entsprechend setzen (erledigt nur, wenn wirklich erledigt).
4. Tests: Registrierung löst user.registered aus; ein Node/Server unter Schwellwert löst
   resource.low im Scheduler-Tick aus.

CI-Schritte ausführen. Punkte 80/81 (und ggf. 82) entsprechend setzen.
```

---

# N10 – Regel-Empfänger: recipientRoleName füllen (#84)

> B6 (+ Lesezugriff auf B2-RoleService). Klein.

```
Du arbeitest am Projekt Palantir. Lies verbindlich: CLAUDE.md (§3 Contracts, §4),
PFLICHTENHEFT.md (§14 Notifications), WORK_STATUS.md (Gefundener Punkt 84).

Vor Arbeitsbeginn: WORK_STATUS.md + gh pr list / git ls-remote --heads origin prüfen.
Token sparen (Pflicht): Aktiviere zu Beginn den caveman-Modus (/caveman) für komprimierte
Ausgaben, und nutze zum Lokalisieren graphify statt das Repo breit zu lesen –
graphify query "<stichworte zum thema>" gegen graphify-out/graph.json, dann gezielt nur die
so gefundenen Dateien/Funktionen öffnen (kein Voll-Scan). Der Graph liegt bereits gebaut vor.
Branch: git checkout -b n10/regel-rollenname (von main). Commit-Prefix [b6].

Problem (Gefundener Punkt 84): NotificationRuleDto.recipientRoleName liefert immer null. Den
Rollennamen kennt B2 (RoleService); B6 hat bewusst keine harte Abhängigkeit darauf. Für die
Anzeige (F10) fehlt der Klartext-Name der Zielrolle.

Aufgabe:
1. Beim Bauen des NotificationRuleDto den Rollennamen zur recipientRoleId auflösen – über eine
   schmale, injizierte Nachschlagefunktion (Port), NICHT über eine neue harte Modulabhängigkeit
   B6→B2 (Richtung/Zyklen beachten, CLAUDE.md §3/§4). Der RoleService liefert die Daten, B6
   bekommt nur eine Funktion "id -> name".
2. Contracts nur additiv anfassen, falls überhaupt nötig – recipientRoleName existiert schon.
3. Test: Regel mit gesetzter recipientRoleId liefert den korrekten Namen; unbekannte/entfernte
   Rolle liefert weiterhin null ohne Fehler.

CI-Schritte ausführen. Punkt 84 auf erledigt.
```

---

# N11 – Kontingent-REST-API + F10-Anbindung (#88, dazu #89)

> B4/B8/F10 (+ ggf. contracts). Mittel. **Enthält evtl. eine kleine Contracts-Änderung –
> dann eigener kleiner Contracts-PR zuerst (CLAUDE.md §6).**

```
Du arbeitest am Projekt Palantir. Lies verbindlich: CLAUDE.md (§3, §6), PFLICHTENHEFT.md (§10
Ressourcen/Kontingente, §5.1 Envelope), LASTENHEFT.md (Kontingente), WORK_STATUS.md
(Gefundene Punkte 88 und 89).

Vor Arbeitsbeginn: WORK_STATUS.md + gh pr list / git ls-remote --heads origin prüfen (keine
zwei Contracts-PRs gleichzeitig – liegt ein fremder offen, erst dessen Merge abwarten).
Token sparen (Pflicht): Aktiviere zu Beginn den caveman-Modus (/caveman) für komprimierte
Ausgaben, und nutze zum Lokalisieren graphify statt das Repo breit zu lesen –
graphify query "<stichworte zum thema>" gegen graphify-out/graph.json, dann gezielt nur die
so gefundenen Dateien/Funktionen öffnen (kein Voll-Scan). Der Graph liegt bereits gebaut vor.
Branch: git checkout -b n11/kontingent-api (von main). Commit-Prefix [b8] bzw. [b4].

Problem (#88): Kontingente (RAM/CPU/Speicher/Serveranzahl) lassen sich über KEIN REST-API
setzen. ResourceService hat getUserLimits/setUserLimits/clearUserLimits (user.manage), aber
keine Route. F10 hat die Kontingent-UI deshalb bewusst offen gelassen.
Nebenpunkt (#89): F10 nutzt lokal DateField und TextArea, die im Design-System (F2) fehlen –
prüfen, ob für die Kontingent-UI relevant; falls ja, mit N-frei koordinieren, sonst als Doku
lassen.

Aufgabe:
1. REST-Routen unter /admin (Envelope-Format §5.1) für Lesen/Setzen/Löschen der
   Nutzer-Kontingente vor dem bestehenden ResourceService – Rechte user.manage, keine zweite
   Kontingent-Logik bauen (CLAUDE.md §3).
2. Falls ein DTO/Schema für Ein-/Ausgabe fehlt: additiv in packages/contracts + validation, als
   eigener kleiner Contracts-PR ZUERST mergen, dann Backend + Frontend.
3. F10-Anbindung: die vorhandene, bewusst offen gelassene Kontingent-Ansicht an die neuen
   Endpunkte hängen (Sichtbarkeit/Aktionen allein am permissions-Objekt).
4. #89 einordnen: DateField/TextArea gehören ins Shared-UI (F2). Wenn diese UI sie braucht,
   Punkt sauber notieren/koordinieren statt lokal zu duplizieren.
5. Tests: Setzen/Auslesen/Löschen eines Kontingents inkl. Rechteprüfung.

CI-Schritte ausführen. Punkt 88 auf erledigt, #89 entsprechend.
```

---

# N12 – Route /nodes/available (#87)

> B3. Klein.

```
Du arbeitest am Projekt Palantir. Lies verbindlich: CLAUDE.md (§3, §5), PFLICHTENHEFT.md (§10
Nodes/Kapazität, §5.1), WORK_STATUS.md (Gefundene Punkte 87 und 49).

Vor Arbeitsbeginn: WORK_STATUS.md + gh pr list / git ls-remote --heads origin prüfen.
Token sparen (Pflicht): Aktiviere zu Beginn den caveman-Modus (/caveman) für komprimierte
Ausgaben, und nutze zum Lokalisieren graphify statt das Repo breit zu lesen –
graphify query "<stichworte zum thema>" gegen graphify-out/graph.json, dann gezielt nur die
so gefundenen Dateien/Funktionen öffnen (kein Voll-Scan). Der Graph liegt bereits gebaut vor.
Branch: git checkout -b n12/nodes-available (von main). Commit-Prefix [b3].

Problem (Gefundener Punkt 87): fetchHostNodes() im F3-Wizard ruft /nodes/available auf – einen
Pfad, den bisher KEINE Backend-Route bedient. F7 zeigt dieselbe Node-Sicht. Punkt 49 listet die
von F3 erwarteten REST-Pfade.

Aufgabe:
1. Route GET /nodes/available (bzw. exakt der von F3/F7 erwartete Pfad – in lib/api prüfen)
   im Envelope-Format, die die für die Nutzeransicht nötigen Nodes samt freier Kapazität
   liefert (HostNodeDto, permissions-Objekt). Datenquelle: bestehender Resource-/Node-Service,
   nichts neu berechnen.
2. Nur additiv; keine Contracts-Änderung, falls HostNodeDto ausreicht.
3. Test: Route liefert verfügbare Nodes mit Kapazität, respektiert Sichtbarkeit/Status.

CI-Schritte ausführen. Punkt 87 auf erledigt; #49 auf den erreichten Stand präzisieren.
```

---

# N13 – Nutzerverzeichnis-Endpunkt für DMs (#94)

> B7/B8. Klein bis mittel.

```
Du arbeitest am Projekt Palantir. Lies verbindlich: CLAUDE.md (§3, §5), PFLICHTENHEFT.md (Chat
§15, Datenschutz), LASTENHEFT.md (Chat/DMs), WORK_STATUS.md (Gefundener Punkt 94).

Vor Arbeitsbeginn: WORK_STATUS.md + gh pr list / git ls-remote --heads origin prüfen.
Token sparen (Pflicht): Aktiviere zu Beginn den caveman-Modus (/caveman) für komprimierte
Ausgaben, und nutze zum Lokalisieren graphify statt das Repo breit zu lesen –
graphify query "<stichworte zum thema>" gegen graphify-out/graph.json, dann gezielt nur die
so gefundenen Dateien/Funktionen öffnen (kein Voll-Scan). Der Graph liegt bereits gebaut vor.
Branch: git checkout -b n13/nutzerverzeichnis-dm (von main). Commit-Prefix [b7].

Problem (Gefundener Punkt 94): Kein allgemeiner Nutzer-Verzeichnis-Endpunkt für DMs.
openDirectConversation verlangt eine recipientId, aber es gibt keine Route, die die für einen
Nutzer zulässigen DM-Empfänger auflistet. F5 behilft sich derzeit mit "Besitzern sichtbarer
Server".

Aufgabe:
1. Datenschutzprinzip aus B7 wahren (visibility.ts – nur was der Nutzer sehen darf). Definiere
   klar, WER als DM-Empfänger auftauchen darf (z. B. Besitzer/Mitglieder von Servern, auf die
   der Nutzer Zugriff hat) – keine globale Nutzerliste, die Konten quer offenlegt.
2. Route (Envelope) liefert genau diese zulässige Empfängermenge mit recipientId + Anzeigename.
   Rechte/Umfang bewusst eng; im Pflichtenheft §15 dokumentieren, falls das Prinzip präzisiert
   wird (CLAUDE.md §8).
3. F5 kann den Endpunkt statt der Hilfskonstruktion nutzen (optional in diesem Paket oder als
   Folge-Notiz).
4. Test: Verzeichnis enthält nur zulässige Empfänger, keine fremden Konten.

CI-Schritte ausführen. Punkt 94 auf erledigt.
```

---

# N14 – Serverseitiger Chat-Lesezustand (#95)

> B7 + contracts. Mittel. **Additive Contracts-Änderung – kleiner Contracts-PR zuerst.**

```
Du arbeitest am Projekt Palantir. Lies verbindlich: CLAUDE.md (§3, §6), PFLICHTENHEFT.md (Chat
§15), WORK_STATUS.md (Gefundener Punkt 95).

Vor Arbeitsbeginn: WORK_STATUS.md + gh pr list / git ls-remote --heads origin prüfen (keine
zwei Contracts-PRs gleichzeitig).
Token sparen (Pflicht): Aktiviere zu Beginn den caveman-Modus (/caveman) für komprimierte
Ausgaben, und nutze zum Lokalisieren graphify statt das Repo breit zu lesen –
graphify query "<stichworte zum thema>" gegen graphify-out/graph.json, dann gezielt nur die
so gefundenen Dateien/Funktionen öffnen (kein Voll-Scan). Der Graph liegt bereits gebaut vor.
Branch: git checkout -b n14/chat-lesezustand (von main).
Commit-Prefix [b7].

Problem (Gefundener Punkt 95): Kein serverseitiger Lesezustand. ConversationDto trägt keinen
Ungelesen-Zähler; F5 zählt ungelesene Nachrichten rein lokal in der Sitzung – über Geräte
hinweg geht der Zustand verloren.

Aufgabe:
1. Contracts zuerst, additiv: ConversationDto um einen Ungelesen-Indikator/-Zähler bzw. eine
   lastReadAt-Markierung ergänzen. Eigener kleiner Contracts-PR, ZUERST mergen (CLAUDE.md §6).
2. Backend (B7): pro Teilnehmer den Lesestand persistieren (Migration über Drizzle Kit,
   CLAUDE.md §4), eine Route zum Markieren-als-gelesen, und den Zähler beim Bauen des DTO
   füllen. Datenschutzprinzip (visibility.ts) unangetastet lassen.
3. Live-Kanal: gelesen/ungelesen konsistent halten (kein Polling).
4. Tests: Lesen setzt den Stand; Zähler stimmt geräteunabhängig; keine fremden Konversationen
   lesbar.

CI-Schritte inkl. db:check ausführen. Punkt 95 auf erledigt.
```

---

# N15 – Inbox-Feinschliff: Sprungziele & Close-Code-Konstante (#92, #91)

> F4/F5/F7/F10 + B6. Klein.

```
Du arbeitest am Projekt Palantir. Lies verbindlich: CLAUDE.md (§3, §5), PFLICHTENHEFT.md (§14
Notifications, WebSocket-Events/Close-Codes), WORK_STATUS.md (Gefundene Punkte 92 und 91).

Vor Arbeitsbeginn: WORK_STATUS.md + gh pr list / git ls-remote --heads origin prüfen.
Token sparen (Pflicht): Aktiviere zu Beginn den caveman-Modus (/caveman) für komprimierte
Ausgaben, und nutze zum Lokalisieren graphify statt das Repo breit zu lesen –
graphify query "<stichworte zum thema>" gegen graphify-out/graph.json, dann gezielt nur die
so gefundenen Dateien/Funktionen öffnen (kein Voll-Scan). Der Graph liegt bereits gebaut vor.
Branch: git checkout -b n15/inbox-feinschliff (von main). Commit-Prefix [f6].

Probleme:
- #92: Aus der Inbox springt bisher nur eine Server-Meldung an ihre Stelle (subjectHref).
  Backups (F4), gemeldete Nachrichten (F5), Nodes (F7) und Konten (F10) haben kein Sprungziel.
- #91: Der Close-Code 4401 ("nicht angemeldet") des Inbox-Live-Kanals steht in
  @palantir/contracts nur als Kommentar, im Backend als CLOSE_CODE_UNAUTHORIZED – nicht als
  gemeinsame Konstante geführt.

Aufgabe:
1. #92: subjectHref/Ziel-Auflösung für die weiteren Ereignistypen ergänzen, sodass Inbox-
   Einträge zu Backup-/Meldungs-/Node-/Konto-Ansichten springen. Nur an bestehende Routen
   verlinken; wenn ein Ziel fehlt, sauber notieren statt erfinden.
2. #91: Den Close-Code als echte, geteilte Konstante in @palantir/contracts führen und Backend
   darauf umstellen (additiv). Falls das eine Contracts-Änderung ist: kleiner Contracts-PR
   zuerst (CLAUDE.md §6).
3. Tests je nach betroffener Logik (Ziel-Auflösung rein testbar halten).

CI-Schritte ausführen. Punkte 91/92 auf erledigt.
```

---

## Nicht aufgenommen (bewusst)

- **Ältere DTO-/Verdrahtungspunkte #8, #10, #12, #17, #18, #19, #21, #23, #24, #27, #50, #61
  usw.** stammen aus frühen Wellen und sind vermutlich mit ihren Folge-Paketen erledigt (wie
  #65). Sie gehören in **N0 (Triage)**, nicht in eigene Bau-Pakete – erst prüfen, dann ggf. ein
  gezieltes Paket nachziehen.
- **Bewusste Entscheidungen** (#6 privates Repo) und **reine Kontext-Notizen** (#34, #36, #38,
  #58, #96 Doku-Anteile) brauchen keine Sitzung.
