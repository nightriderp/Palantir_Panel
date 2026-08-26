# CLAUDE.md – Verhaltensregeln für die Entwicklung von Palantir

Diese Datei gilt für jede Sitzung, die an diesem Repository arbeitet – unabhängig davon, an welchem Arbeitspaket gerade gearbeitet wird.

**Referenzdokumente (verbindlich):**
- `LASTENHEFT.md` – fachliche Anforderungen
- `PFLICHTENHEFT.md` – technisches Umsetzungskonzept
- `STRUKTUR.md` – Aufteilung des Projekts in parallel bearbeitbare Arbeitspakete

Bei Widersprüchen zwischen diesen Dokumenten und dem eigenen Verständnis des Codes: **nachfragen, nicht eigenmächtig interpretieren.**

---

## 1. Quellen der Wahrheit

- Lastenheft und Pflichtenheft sind bindend für den Funktionsumfang. Keine Features bauen, die dort nicht stehen, ohne vorher kurz Rückfrage zu halten – kein stillschweigendes Scope-Creep.
- Architektur-relevante Abweichungen (neue Abhängigkeit, neue Tabelle, geänderter Ablauf, neue externe Bibliothek) werden benannt und begründet, nicht einfach eingebaut.
- Wenn eine Umsetzung vom Pflichtenheft abweicht, weil sich unterwegs eine bessere Lösung zeigt: das wird dokumentiert (siehe Abschnitt 8), nicht nur im Code versteckt.

---

## 2. Sicherheit (nicht verhandelbar)

- Niemals Secrets, Tokens oder Keys hardcoden – ausschließlich über die zentrale `.env` / `.env.example`.
- Keine "temporären" Auth-Bypässe, Debug-Hintertüren oder testweise deaktivierten Sicherheitsprüfungen – auch nicht mit der Absicht, sie später zu entfernen.
- Docker-Hardening-Vorgaben aus dem Pflichtenheft (`no-new-privileges`, Resource-Limits, Docker-Socket-Proxy statt direktem Socket-Zugriff) gelten für **jede** neue Container-Ansteuerung, nicht nur für die erste Implementierung.
- `SameSite`-Cookie-Einstellungen, CSRF-Schutz und Passwort-/Token-Hashing werden exakt wie im Pflichtenheft (§7) spezifiziert umgesetzt – Abweichungen hiervon erfordern Rückfrage.
- Bei sicherheitsrelevanten Unsicherheiten (Auth, Verschlüsselung, Permissions, Session-Handling) lieber nachfragen als raten.

---

## 3. Contracts als Vertragsgrenze

- `packages/contracts` und `packages/validation` sind die einzige Schnittstelle zwischen Backend, Frontend und Agent. Änderungen daran sind bevorzugt **additiv** (neue optionale Felder).
- Breaking Changes an bestehenden Feldern/Typen werden im Commit und im PR explizit als solche gekennzeichnet.
- Vor Beginn einer Backend- oder Frontend-Aufgabe: prüfen, ob der benötigte Contract/DTO schon existiert, statt eigene Parallelstrukturen zu erfinden.
- Jedes DTO liefert immer den vollständigen Datensatz inkl. `permissions`-Objekt (siehe Pflichtenheft §5) – keine view-spezifisch zusammengestrichenen Sonderformate.

---

## 4. Code-Qualität

- TypeScript im `strict`-Modus, `any` nur mit kurzer Begründung im Code-Kommentar.
- Tests sind zwingend für kritische Logik: Server-Lifecycle-State-Machine, Permission-Berechnung (RBAC), Ressourcen-Kapazitätsprüfung, Auth-Flows.
- Der Agent spricht ausschließlich über das `ContainerRuntime`-Interface mit Docker – nie direkt gegen die Docker-API oder den Docker-Socket-Proxy.
- Datenbank-Schema-Änderungen ausschließlich über Migrationen (Drizzle Kit) – keine manuellen Anpassungen an der laufenden Datenbank.

---

## 5. Fehlerbehandlung & API

- Response-Envelope-Format (siehe Pflichtenheft §5.1) konsequent einhalten – kein Abweichen auf Ad-hoc-Formate.
- Neue Fehlerfälle werden als benannter Fehlercode in den bestehenden Katalog aufgenommen (z. B. `RESOURCE_LIMIT_EXCEEDED`), nicht als Freitext-String.
- WebSocket-Events folgen demselben Benennungsschema wie die bereits definierten Events (`server.started`, `backup.failed`, ...) – neue Events werden nach diesem Muster ergänzt.

---

## 6. Parallele Arbeit / Koordination zwischen Sitzungen

Da mehrere Sitzungen gleichzeitig an unterschiedlichen Arbeitspaketen arbeiten (siehe `STRUKTUR.md`):

- **Ein Branch pro Arbeitspaket**, niemals direkt auf `main`. Zusammenführen ausschließlich über Pull Request.
- Vor Arbeitsbeginn: `packages/contracts` und `packages/validation` auf den neuesten Stand bringen (pullen) – nie gegen veraltete Contracts entwickeln.
- **`WORK_STATUS.md`** im Repo-Root ist der laufend aktuelle Stand aller Arbeitspakete – keine reine Start-Markierung. Tabelle mit den Spalten Arbeitspaket, Branch, Status (offen / in Bearbeitung / blockiert / fertig), zuletzt aktualisiert, kurze Fortschrittsnotiz. Jede Sitzung trägt ihre Zeile bei Start ein, aktualisiert sie bei jedem nennenswerten Fortschritt oder Blocker und setzt sie bei Abschluss auf "fertig" – so sieht jede andere Sitzung jederzeit den echten Stand, ohne den Code selbst durchsuchen zu müssen. Vor Arbeitsbeginn immer zuerst hier nachsehen, ob ein Paket schon in Bearbeitung ist. Zusätzlich enthält die Datei einen zweiten Abschnitt "Gefundene Punkte" als fortlaufende Liste für Dinge, die während der Arbeit auffallen, aber nicht sofort bearbeitet werden (siehe unten).
- **`WORK_STATUS.md` allein genügt nicht mehr.** Seit `main` durch ein Ruleset geschützt ist, landet die Statuszeile einer laufenden Sitzung zuerst auf deren Branch – sichtbar wird sie erst beim Merge. Ein Paket kann also seit Stunden in Arbeit sein, während die Datei auf `main` es noch als "offen" führt. **Vor Arbeitsbeginn deshalb zusätzlich die offenen Pull Requests und die Branches auf dem Remote ansehen** (`gh pr list`, `git ls-remote --heads origin`); die Branch-Namen tragen das Kürzel des Arbeitspakets. Das gilt besonders, wenn eine Aufgabe klein und naheliegend wirkt: Genau solche Lücken fallen mehreren Sitzungen gleichzeitig auf, und zwei Korrekturen derselben Stelle kosten mehr als die Minute, die das Nachsehen braucht.
- Wird eine Änderung an `packages/contracts` nötig, die über das eigene Arbeitspaket hinausgeht: **eigener, kleiner PR nur dafür**, zuerst mergen, dann erst im eigentlichen Arbeitspaket weiterarbeiten. Contracts-Änderungen werden nie "nebenbei" in einem großen Feature-PR versteckt. Liegt bereits ein fremder Contracts-PR offen, **erst dessen Merge abwarten** – parallele Contracts-PRs machen sich gegenseitig konfliktbehaftet.
- Commit-Messages mit Präfix des Arbeitspakets, z. B. `[auth] Argon2id-Hashing implementiert`, `[server-card] Pin-Funktion ergänzt`.
- Kategorie **Frontend – Shared UI/Design-System** hat Priorität, da andere Frontend-Arbeitspakete auf ihre Komponenten (`ServerCard`, Modals, `PhaseLockedPlaceholder`) aufbauen. Bei Unklarheit, ob eine Komponente schon existiert: in `apps/frontend/src/components/shared` nachsehen, bevor eine eigene Variante gebaut wird.
- **Abschluss eines Arbeitspakets:** Vor dem Zusammenführen den aktuellen Stand von `main` holen (pull/rebase), lokal einarbeiten und Konflikte auflösen – erst danach pushen und den PR mergen. Niemals direkt auf `main` committen oder arbeiten.
- **Zusätzliche Punkte während der Bearbeitung:** Fällt während der Arbeit etwas auf, das nicht Teil der aktuellen Aufgabe ist, wird es notiert statt ungefragt nebenbei miterledigt. Betrifft es nur das eigene Arbeitspaket: am Ende der eigenen Sitzung mit abarbeiten. Betrifft es auch andere Arbeitspakete/Sitzungen: als neue Zeile unter "Gefundene Punkte" in `WORK_STATUS.md` vermerken (Arbeitspaket, Fundstelle, kurze Beschreibung) – wird dann später von der zuständigen Sitzung oder dem Nutzer aufgegriffen.

---

## 7. Arbeitsweise / Selbstkontrolle

- Vor einer "erledigt"-Meldung: Build und Tests tatsächlich ausführen, nicht nur Code schreiben und annehmen, dass er funktioniert.
- Kleine, nachvollziehbare Änderungen bevorzugt vor großen, schwer prüfbaren Umbauten.
- Bei Unsicherheit, ob eine andere Sitzung gerade an derselben Datei/demselben Contract arbeitet: `WORK_STATUS.md` prüfen, im Zweifel nachfragen statt zu überschreiben.

---

## 8. Dokumentation

- Abweichungen von Lastenheft/Pflichtenheft werden dort vermerkt oder zumindest im PR-Beschreibungstext dokumentiert – nicht nur im Code sichtbar.
- Jede neue Konfigurationsvariable landet mit erklärendem Kommentar in `.env.example` (siehe Pflichtenheft §12.1) – keine Variable, die nur im Code, aber nicht in der Vorlage existiert.
- Neue Fehlercodes, Events oder Permissions werden an der Stelle im Pflichtenheft ergänzt, an der der jeweilige Katalog geführt wird.

---

## 9. Kommunikationsstil

- Antworten immer kurz und präzise halten – keine unnötig langen Erklärungen oder Wiederholungen von bereits Bekanntem.
- Bei jeder Datei, die der Nutzer selbst manuell platzieren/einpflegen/ausführen muss (z. B. `.env`, WireGuard-Konfiguration, Docker-Compose-Datei, Zertifikate, Cronjobs): immer den **exakten Pfad** und den **Zielort** angeben – also ob das auf der VPS oder auf dem Homeserver/Node passiert. Nie nur "trage das in die Config ein" ohne Pfad und Maschine zu nennen.
