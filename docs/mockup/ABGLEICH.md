# Abgleich App ↔ Mockup

Vollständiger Durchgang aller Ansichten der laufenden App gegen
[`Palantir.dc.html`](Palantir.dc.html). Erhoben am 31.08.2026 auf Branch
`ui/mockup-abgleich` (Basis `main` @ `d580716`), beide Seiten im Browser bei 1440×900
nebeneinander, App mit Demo-Daten (5 Server, 2 Nodes, Owner-Konto).

Diese Datei ist die **Befundliste**, noch keine Umsetzung. Reihenfolge und Umfang der
Korrekturen entscheidet der Nutzer.

## Einordnung der Befunde

| Klasse | Bedeutung | Vorgehen |
| --- | --- | --- |
| **A** | Mockup hat es, App nicht | bauen |
| **B** | Beide haben es, sieht/verhält sich anders | angleichen |
| **C** | App geht über das Mockup hinaus oder weicht bewusst ab | **nicht** stillschweigend zurückbauen – Entscheidung nötig |

Grundlage der Klasse C ist [CLAUDE.md](../../CLAUDE.md): bei Widersprüchen gelten
[LASTENHEFT.md](../../LASTENHEFT.md) und [PFLICHTENHEFT.md](../../PFLICHTENHEFT.md) **vor**
dem Mockup. Das Mockup ist Orientierung für Layout und Gestaltung, nicht für den
Funktionsumfang.

---

## 1. Grundgerüst (Sidebar, Topbar) — betrifft jede Seite

Quelle App: [DashboardShell.tsx](../../apps/frontend/src/app/(dashboard)/DashboardShell.tsx),
[DashboardNav.tsx](../../apps/frontend/src/app/(dashboard)/DashboardNav.tsx)

| # | Klasse | Befund |
| --- | --- | --- |
| 1.1 | **A** | **Die komplette Gesamtstatus-Leiste in der Topbar fehlt.** Mockup: `GESAMTSTATUS` · `4/7 Server online` · `28 Spieler` · `35% CPU` · `18.5 GB/32 GB RAM` · `360/1000 GB Disk` · `2/3 Nodes`, darunter eine zweite Zeile `1 in Bewegung` · `1 mit Fehler` · `2 mit Update`. App-Topbar enthält nur „Live verbunden" und das Nutzermenü. Größter Einzelunterschied im ganzen Abgleich. |
| 1.2 | **A** | **Sidebar-Abschnitt „DEINE SERVER · n" fehlt.** Mockup listet die eigenen Server direkt in der Seitenleiste (Kürzel-Kachel, Name, Status-Punkt) als Sprungziele. |
| 1.3 | **A** | Navigationspunkt **„Server erstellen"** fehlt in der Sidebar. In der App nur über den Button „Neuer Server" auf der Übersicht erreichbar. |
| 1.4 | **A** | **Ungelesen-Zähler an „Nachrichten"** fehlt (Mockup: Badge mit Anzahl). |
| 1.5 | **B** | **Reihenfolge Hauptnavigation.** Mockup: Übersicht, Nachrichten, Skins, Benachrichtigungen, Nodes, Server erstellen, Meine Backups, Arcade. App: Übersicht, Meine Backups, Nachrichten, Benachrichtigungen, Nodes, Arcade, Skins. |
| 1.6 | **B** | **Reihenfolge Administration.** Mockup: Nutzer, Rollen, Templates, Bilder, Sticker, Arcade-Musik, Benachrichtigungs-Regeln, Anfragen, Audit-Log, Backups, Node-Platz, Adressen. App: Nutzer, Anfragen, Rollen, Moderation, Benachrichtigungs-Regeln, Ankündigungen, Audit-Log, Backups, Nodes, Node-Platz, Adressen, Templates, Bilder, Sticker, Arcade-Musik. |
| 1.7 | **C** | App hat drei Admin-Punkte mehr als das Mockup: **Moderation**, **Ankündigungen**, **Nodes (Admin)**. Kein Mockup-Gegenstück – prüfen, ob sie ins Mockup-Schema einsortiert werden sollen. |
| 1.8 | **B** | **Versionszeile im Fuß.** Mockup `v2026.34.0-entwicklung`, App `Palantir · v0.6.0`. Nur Format; die Quelle (`package.json`) bleibt richtig. |
| 1.9 | **C** | Die „Demo-Rolle"-Auswahl rechts oben im Mockup ist eine reine Vorführhilfe des Entwurfs. **Nicht nachbauen.** |

---

## 2. Anmelden / Registrieren

| # | Klasse | Befund |
| --- | --- | --- |
| 2.1 | **A** | **Kennzahlenzeile am Fuß der Markenspalte fehlt** (`6 Spiele` · `612 Tage im Dienst` · `1 284 Arcade-Partien`). |
| 2.2 | **A** | **Quellenangabe unter dem Zitat fehlt** (Mockup: „— Betriebsgrundsatz · Palantir"). |
| 2.3 | **B** | Durch 2.1/2.2 stimmt die vertikale Aufteilung der Markenspalte nicht: Mockup verteilt Logo / Zitat / Kennzahlen über die volle Höhe (`space-between`), App hat nur zwei Blöcke. |
| 2.4 | **B** | Anmeldeformular sitzt in der App rund 30 px höher als im Mockup. |
| 2.5 | **C** | App zeigt zusätzlich das **ALTCHA-Feld** („Sicherheitsprüfung …") – Vorgabe aus dem Pflichtenheft, im Mockup nicht vorgesehen. Bleibt. |
| 2.6 | **C** | App bietet **Twitch** als drittes Anmeldeverfahren, Mockup nur Discord und Steam. Bleibt, sofern im Lastenheft gedeckt. |

---

## 3. Übersicht (`/servers`)

| # | Klasse | Befund |
| --- | --- | --- |
| 3.1 | **A** | **Gruppe „ANGEPINNT · n" fehlt.** Die Stern-Symbole sind auf den Karten vorhanden, es gibt aber keine Anpinnen-Funktion und keine eigene Gruppe. In der Datenbank existiert dafür bisher keine Spalte. |
| 3.2 | **A** | **Gruppe „ANDERE SERVER · n" fehlt** – Server, auf die man Zugriff hat, ohne Besitzer zu sein. |
| 3.3 | **A** | **Fußzeile fremder Karten fehlt**: Mockup zeigt dort `Admin-Zugriff` und einen `Nachricht`-Link. |
| 3.4 | **A** | Statuszusatz **„Update verfügbar"** (orange, unter der Status-Pille) fehlt. App kennt nur „Neustart nötig". |
| 3.5 | **B** | **Ring-Beschriftung `PLATTE` statt `DISK`** – [ServerCard.tsx:204](../../apps/frontend/src/components/shared/server/ServerCard.tsx#L204) und [OverviewTab.tsx:95](../../apps/frontend/src/components/servers/detail/OverviewTab.tsx#L95). |
| 3.6 | **B** | **Fehlermeldung auf der Karte**: Mockup setzt den Text als schlichte Zeile unter den Titel, App rahmt ihn als rot hinterlegten Kasten. |
| 3.7 | **B** | **Sortierung** der Karten wirkt willkürlich (Skin-Inspect, Nordwind, Survival Runde, …). Mockup gruppiert und sortiert stabil. |
| 3.8 | **B** | **Kartentitel-Untertitel**: Mockup `Paper · 1.21.4` bzw. `Vanilla · Staging · Femi` (Variante · Version · ggf. Besitzer), App nur den Namen des Spieltyps. |

---

## 4. Server-Detail (`/servers/[id]`)

| # | Klasse | Befund |
| --- | --- | --- |
| 4.1 | **A** | **Seitenkopf fehlt.** Mockup hat über der Kopfkarte noch „Survival Runde / Details und Steuerung" plus „← Zurück zur Übersicht" rechts. In der App ist die Kopfkarte selbst der Seitenkopf, der Zurück-Button sitzt in der Aktionsleiste. |
| 4.2 | **B** | **Kopfkarte** ist im Mockup höher, mit Farbverlauf hinterlegt und hat eine deutlich größere Server-Kachel. |
| 4.3 | **B** | **Konsole liegt im Mockup auf der Übersicht** – zweispaltig neben „Server-Details". In der App ist sie ein eigener Reiter, „Server-Details" steht darunter über die volle Breite. Strukturell der größte Unterschied dieser Seite. |
| 4.4 | **B** | **Reiter**: Mockup `Übersicht · Aufgaben · Dateien · Backups` (4). App `Übersicht · Konsole · Dateien · Backups · Aufgaben · Einstellungen` (6, andere Reihenfolge). |
| 4.5 | **B** | **Kachel-Beschriftungen**: Mockup `CPU-LAST`, `ARBEITSSPEICHER`, `PLATTE`, `PING`, `LAUFZEIT`. App `CPU`, `RAM`, `PLATTE`, `PING`, `SPIELER`. |
| 4.6 | **A** | Kachel **`LAUFZEIT`** („3 Tage 4 Std.") fehlt in der App. |
| 4.7 | **B** | Mockup: **Textlink „Verlauf anzeigen"**, App: gefüllter Knopf „Verlauf der letzten Stunde". |
| 4.8 | **B** | **Netzwerkaktivität**: Mockup zeigt vier Werte (Eingehend, Ausgehend, Pakete ein, Pakete aus) samt erklärender Fußnote. App zeigt die Karte, aber ohne diese Aufteilung. |

---

## 5. Server anlegen (`/servers/neu`)

| # | Klasse | Befund |
| --- | --- | --- |
| 5.1 | **B** | **Titel** „Neuer Server" statt „Neuen Server erstellen"; **Untertitel** „In vier Schritten …" statt „In wenigen Schritten zum eigenen Gameserver". |
| 5.2 | **B** | **Schrittanzeige**: Mockup groß, mittig, Kreise mit Beschriftung darunter und Verbindungslinien über die volle Breite. App klein und linksbündig in einer Zeile. |
| 5.3 | **B** | Mockup stellt den Inhalt **ohne umschließende Karte** dar, App rahmt ihn ein. |
| 5.4 | **B** | Hinweistext „Bitte ein Spiel wählen." statt „Wähle zuerst ein Spiel." |
| 5.5 | **B** | **„Weiter"** ist im Mockup ein zurückhaltender Knopf mit Pfeil `→`, in der App ein gefüllter Verlaufsknopf. |
| 5.6 | **C** | App hat zusätzlich „← Zurück zur Übersicht" im Seitenkopf (im Mockup nicht vorhanden). |
| 5.7 | **C** | Spielkarten der App tragen zusätzlich eine Empfehlungszeile (RAM/Kerne). Sinnvolle Ergänzung. |

---

## 6. Nachrichten (`/messages`)

| # | Klasse | Befund |
| --- | --- | --- |
| 6.1 | **B** | **Untertitel** „Direktnachrichten und Server-Chats" statt „Schreib den Besitzern der anderen Server". |
| 6.2 | **C** | App zeigt über der Liste zusätzlich einen „Live"-Punkt. |
| 6.3 | — | Verlaufsspalte, Blasenform und Eingabezeile ließen sich mangels Konversationen nicht abschließend vergleichen. Nachzuholen, sobald Chat-Testdaten vorliegen. |

---

## 7. Benachrichtigungen (`/notifications`)

| # | Klasse | Befund |
| --- | --- | --- |
| 7.1 | **A** | **Karte „Push-Benachrichtigungen"** mit Schalter am Kopf der Seite fehlt (App hat sie in den Reiter „Einstellungen" verschoben). |
| 7.2 | **B** | **Untertitel** „Dein Posteingang und persönliche Einstellungen" statt „Dein Posteingang". |
| 7.3 | **C** | App hat zusätzlich Reiter (Inbox/Einstellungen), Filter nach Ereignis und Dringlichkeit, „Alle gelesen" und einen Live-Punkt. Das Mockup zeigt eine schlichte Liste. **Nicht zurückbauen** ohne Entscheidung. |

---

## 8. Nodes (`/nodes`)

| # | Klasse | Befund |
| --- | --- | --- |
| 8.1 | **B** | **Benennung durchgehend anders.** Mockup: „Nodes", „RAM gebucht", „Platte belegt". App: „Homeserver", „Rechenleistung", „Arbeitsspeicher", „Speicherplatz". Bewusste Entscheidung für Alltagssprache – bestätigen oder umstellen. |
| 8.2 | **B** | **Darstellung**: Mockup listet Nodes als kompakte Zeilen mit zwei Balken; App verwendet zweispaltige Karten mit drei beschrifteten Balken. |
| 8.3 | **B** | **Kachel-Beschriftungen**: Mockup `NODES ONLINE`, `SERVER VERTEILT`, `RAM GEBUCHT`, `PLATTE FREI`. App `VERBUNDEN`, `SERVER`, `FREIER ARBEITSSPEICHER`, `FREIER SPEICHERPLATZ`. |
| 8.4 | **A** | Kopf-Aktionen **„Node einrichten – Anleitung"** und **„Node hinzufügen"** fehlen; ebenso die Zeilen-Aktionen **„Pausieren"** / **„Löschen"** und die Angabe „seit N Tagen". |
| 8.5 | **C** | App hat stattdessen einen Erklärkasten „Was ist ein Homeserver (,Node')?" und den Knopf „Was ist das?". |

---

## 9. Meine Backups (`/my-backups`)

| # | Klasse | Befund |
| --- | --- | --- |
| 9.1 | **B** | Mockup zeigt eine **Tabelle mit einer Zeile je Server** (Spalten `SERVER`, `ERSTELLT`, `GRÖSSE`, `VERLÄSSLICHKEIT`, `INTEGRITÄT`, `ZUSTAND`), auch für Server ohne Sicherung („—"). Servernamen sind Links. |
| 9.2 | **C** | App-Untertitel kündigt zusätzlich den gesamten Speicherverbrauch an und zeigt einen Hinweiskasten zur Aufbewahrungsfrist. |
| 9.3 | — | Ohne Backup-Testdaten nicht abschließend vergleichbar. |

---

## 10. Arcade (`/arcade`)

| # | Klasse | Befund |
| --- | --- | --- |
| 10.1 | **A** | **Bestenliste auf der Spielkarte fehlt.** Mockup zeigt die besten drei je Spiel, den eigenen Eintrag hervorgehoben, sowie „Noch niemand hat gespielt." als Leerfall. |
| 10.2 | **A** | Zeile **„Bestenliste: 1240"** unter dem Spielnamen fehlt. |
| 10.3 | **B** | **„Spielen"** ist im Mockup ein gefüllter Knopf unten links, in der App ein Textlink oben rechts. |
| 10.4 | **B** | **Spielnamen**: Mockup Snake, Blocks, Echo, Chomp, Minesweeper – App Kriechpfad, Ballwechsel, Steinbrecher, Blockstapel, Punktejäger. Vermutlich bewusste Eindeutschung; bestätigen. |
| 10.5 | **C** | App hat zusätzlich einen Erklärkasten „Eigenständige Minispiele" und je Karte einen längeren Beschreibungstext. |

---

## 11. Profil (`/profil`)

| # | Klasse | Befund |
| --- | --- | --- |
| 11.1 | **B** | **Das Mockup kennt keine getrennte Einstellungsseite.** Passwort ändern, Zwei-Faktor und „Konto löschen" liegen dort als Karten direkt auf dem Profil; die App hat sie nach `/einstellungen` ausgelagert. |
| 11.2 | **A** | Karte **„Konto löschen"** (rot umrandet, „Kann nicht rückgängig gemacht werden.") fehlt auf dem Profil. |
| 11.3 | **B** | **Identitätskarte**: Mockup mit Avatar und „Speichern" für den Anzeigenamen. App zeigt stattdessen Owner-Abzeichen, Rollen und „Mitglied seit", ohne Bearbeitungsmöglichkeit. |
| 11.4 | **B** | **Verknüpfte Anmeldungen**: Mockup als schmale Zeilen mit „Verbinden" rechts, App als drei breite, farbige Knöpfe. |

---

## 12. Administration

### 12.1 Nutzer (`/admin/users`)

| # | Klasse | Befund |
| --- | --- | --- |
| 12.1.1 | **A** | Karte **„Selbstregistrierung"** mit Schalter und Knopf **„Nutzer anlegen"** fehlt. |
| 12.1.2 | **B** | Mockup nutzt eine **Tabelle** (`BENUTZER`, `ROLLE` als Auswahlfeld direkt in der Zeile, `KONTINGENT (RAM/SERVER)`, `ERSTELLT`, `AKTION`), App eine **Kartenliste** je Konto. |
| 12.1.3 | **A** | Spalte **Kontingent** (z. B. `4 GB / 8 GB · 1 / 3`) fehlt in der Übersicht. |
| 12.1.4 | **B** | Titel „Nutzer" statt „Benutzerverwaltung". |
| 12.1.5 | **C** | App hat zusätzlich Filter (Freigegeben/Wartet/Gesperrt), Suche und die Aktionen „Server", „2FA zurücksetzen". |

### 12.2 Rollen (`/admin/roles`)

| # | Klasse | Befund |
| --- | --- | --- |
| 12.2.1 | **B** | **Grundlegend andere Bedienung.** Mockup: zweispaltig – links Rollenliste mit Mitgliederzahl, rechts alle Berechtigungen als Schalter, nach Bereichen gruppiert (`SERVER`, `KONSOLE & AUSLASTUNG`, `DATEIEN`, `SICHERUNGEN & AUFGABEN`, `NODES & VORLAGEN`, …), direkt umschaltbar. App: flache Kartenliste mit „Bearbeiten"/„Löschen". |
| 12.2.2 | **B** | Untertitel „Berechtigungen zu frei definierbaren Rollen bündeln" statt „Welche Rolle was darf – jeder Schalter einzeln." |

### 12.3 Anfragen (`/admin/requests`)

| # | Klasse | Befund |
| --- | --- | --- |
| 12.3.1 | **A** | **Abschnitt „KONTINGENT" fehlt vollständig** – Anfragen auf mehr RAM/Server mit Begründung, aktuellem Verbrauch und „Genehmigen"/„Ablehnen". Die App zeigt nur Registrierungen. |
| 12.3.2 | **B** | Mockup gliedert in zwei betitelte Abschnitte (`KONTINGENT`, `FREISCHALTUNGEN`); App nutzt eine Filterleiste. |

### 12.4 Audit-Log (`/admin/audit`)

| # | Klasse | Befund |
| --- | --- | --- |
| 12.4.1 | **B** | **Spalten**: Mockup `ZEITPUNKT · NUTZER · AKTION · ZIEL · DETAILS`; App `ZEITPUNKT · AKTION · HANDELNDER · OBJEKT · HERKUNFT · DETAILS`. |
| 12.4.2 | **B** | Mockup zeigt Aktionen als **Großbuchstaben-Codes in Festbreitenschrift** und färbt Fehlschläge rot (`LOGIN_FAILED`, `ACTION_DENIED`). App schreibt sie ausformuliert („Owner-Status vergeben"). |
| 12.4.3 | **C** | App hat vier Filter plus Blättern, Mockup nur ein Auswahlfeld. |

### 12.5 Backups (`/admin/backups`)

| # | Klasse | Befund |
| --- | --- | --- |
| 12.5.1 | **B** | **Anderer Gegenstand.** Mockup: Sicherungen der Panel-Datenbank und der Server-Volumes, Kacheln `Panel-DB`, `Server-Volume`, `Automatische Sicherung`, `Speicherverbrauch`, darunter `VERLAUF` (`GESTARTET · ZIEL · AUSLÖSER · GRÖSSE · STATUS`). App: Speicherverbrauch je Nutzer und Server, sechs Zählkacheln. |
| 12.5.2 | **A** | Verlaufstabelle der Sicherungsläufe fehlt. |

### 12.6 Node-Platz (`/admin/storage`)

| # | Klasse | Befund |
| --- | --- | --- |
| 12.6.1 | **B** | Mockup zeigt **alle Nodes gleichzeitig** als Karten mit Balken und je drei Werten (Serverdaten / Sicherungen / Images). App zeigt **eine Node nach Auswahl** in einem Ausklappfeld. |
| 12.6.2 | **B** | Titel „Node-Platz" statt „Platz auf den Nodes"; Mockup nennt im Untertitel die Gesamtbelegung („Gesamt: 380 / 1000 GB belegt"). |
| 12.6.3 | **B** | Aktion heißt im Mockup **„Neu einlesen"** je Node, in der App „Scan starten" für die gewählte Node. |
| 12.6.4 | **A** | Hinweis **„Server existiert nicht mehr"** (orange) an verwaisten Beständen fehlt. |

### 12.7 Adressen (`/admin/addresses`)

| # | Klasse | Befund |
| --- | --- | --- |
| 12.7.1 | **B** | **Anderer Gegenstand.** Mockup: Tabelle aller Server mit `SPIEL · NODE · SUBDOMAIN · VERBINDUNGSADRESSE · DNS` (Zustand `aktiv · SRV` / `ausstehend`). App: Verwaltung der Portbereiche der VPS mit Kacheln und verwaisten Zuordnungen. |
| 12.7.2 | **A** | Die Server-Adressübersicht aus dem Mockup existiert in der App an keiner Stelle. |

### 12.8 Benachrichtigungs-Regeln (`/admin/notifications`)

| # | Klasse | Befund |
| --- | --- | --- |
| 12.8.1 | **B** | Mockup: zwei Reiter (`Posteingang`, `Einstellungen`) in einer schmalen Spalte; unter Einstellungen `Integrationen` (Discord-Webhook + „Testnachricht", Kanal für Freischaltungen), `Wann wird gemeldet?` (fünf Schalter), `Schwellwerte` (vier Schieberegler: CPU-Grenze, RAM-Grenze, Mindestdauer, Sperrzeit). App: `Regeln`, `Kanäle`, `Zustellungen` über die volle Breite. |
| 12.8.2 | **A** | Die vier **Schwellwert-Regler** haben in der App keine Entsprechung. |
| 12.8.3 | **C** | Das Regelwerk der App ist deutlich mächtiger als die Schalterliste des Mockups. Nicht zurückbauen. |

---

## 13. Bewusst nicht gebaut (kein Handlungsbedarf)

Diese Ansichten sind im Mockup vollständig ausgearbeitet, in Version 1 aber absichtlich
gesperrt – begründet in
[GameAdminPlaceholder.tsx](../../apps/frontend/src/components/admin/games/GameAdminPlaceholder.tsx)
mit Verweis auf Lastenheft §6/§7:

| Ansicht | Phase |
| --- | --- |
| Skins | 2 |
| Admin → Templates | 3 |
| Admin → Bilder | 3 |
| Admin → Sticker | 3 |
| Admin → Arcade-Musik | 3 |

Einziger Befund dazu: **die Seite „Templates" zeigt den Platzhalter ohne Seitenkopf**,
während „Skins" Titel und Untertitel darüber setzt. Uneinheitlich (Klasse **B**).

---

## 14. Zusammenfassung

| Bereich | A (fehlt) | B (weicht ab) | C (Entscheidung) | offen |
| --- | --- | --- | --- | --- |
| Grundgerüst | 4 | 3 | 2 | — |
| Anmelden/Registrieren | 2 | 2 | 2 | — |
| Übersicht | 4 | 4 | — | — |
| Server-Detail | 2 | 6 | — | — |
| Server anlegen | — | 5 | 2 | — |
| Nachrichten | — | 1 | 1 | 1 |
| Benachrichtigungen | 1 | 1 | 1 | — |
| Nodes | 1 | 3 | 1 | — |
| Meine Backups | — | 1 | 1 | 1 |
| Arcade | 2 | 2 | 1 | — |
| Profil | 1 | 3 | — | — |
| Administration | 7 | 13 | 3 | — |
| Phase-gesperrt | — | 1 | — | — |
| **Summe** | **24** | **45** | **14** | **2** |

Die zwei offenen Punkte (6.3, 9.3) betreffen Nachrichten und Meine Backups: dort fehlten
Chat- und Backup-Testdaten, die Ansichten sind noch nicht abschließend verglichen.

### Vorschlag für die Reihenfolge

1. **Grundgerüst** (1.1–1.6) – wirkt auf jeder Seite und ist der auffälligste Unterschied.
2. **Übersicht + Server-Karte** (3.x) – die meistgesehene Ansicht.
3. **Server-Detail** (4.x) – vor allem die zweispaltige Übersicht mit Konsole.
4. **Server anlegen** (5.x) – überschaubar, reine Gestaltung.
5. **Kleinteiliges** (Anmelden, Profil, Arcade, Benachrichtigungen).
6. **Administration** – zuletzt, weil dort die meisten Klasse-C-Entscheidungen anstehen.

Vor Punkt 6 sollte geklärt sein, wie mit den 14 Klasse-C-Befunden verfahren wird: Die App
kann dort mehr als das Mockup, teils gedeckt durch Lasten- und Pflichtenheft. Ein
Rückbau auf den Mockup-Stand wäre ein Funktionsverlust.
