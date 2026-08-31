# Abgleich App ↔ Mockup

Vollständiger Durchgang aller Ansichten der laufenden App gegen
[`Palantir.dc.html`](Palantir.dc.html). Erhoben am 31.08.2026 auf Branch
`ui/mockup-abgleich` (Basis `main` @ `d580716`), beide Seiten im Browser bei 1440×900
nebeneinander, App mit Demo-Daten (5 Server, 2 Nodes, Owner-Konto).

Diese Datei ist die **Befundliste** und wird beim Abarbeiten fortgeschrieben. Reihenfolge
und Umfang der Korrekturen entscheidet der Nutzer.

**Stand:** Abschnitt 1 (Grundgerüst), 3 (Übersicht), 4 (Server-Detail) und 5 (Server
anlegen) sind umgesetzt, alles Übrige offen. Vier Befunde des ersten Durchgangs (3.2, 3.6, 3.7, 3.8) haben sich beim
Lesen des Codes als falsch erwiesen; sie sind als „entfällt" markiert statt gelöscht,
damit die Nummerierung stabil bleibt.

**Lehre daraus:** Die Demo-Daten des ersten Durchgangs gehörten alle einem Konto, keiner
war angepinnt, keiner hatte ein Update. Zustände, die es nur bei fremden, angepinnten oder
gestörten Servern gibt, wurden deshalb nie gerendert und wirkten wie nicht gebaut. Vor
jedem weiteren Abschnitt gilt: erst die Datenlage herstellen, die den Zustand auslöst,
dann urteilen.

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

| # | Klasse | Stand | Befund |
| --- | --- | --- | --- |
| 1.1 | **A** | erledigt | **Die komplette Gesamtstatus-Leiste in der Topbar fehlt.** Mockup: `GESAMTSTATUS` · `4/7 Server online` · `28 Spieler` · `35% CPU` · `18.5 GB/32 GB RAM` · `360/1000 GB Disk` · `2/3 Nodes`, darunter `1 in Bewegung` · `1 mit Fehler` · `2 mit Update`. App-Topbar enthielt nur „Live verbunden" und das Nutzermenü. Größter Einzelunterschied im ganzen Abgleich. |
| 1.2 | **A** | erledigt | **Sidebar-Abschnitt „DEINE SERVER · n" fehlt.** Mockup listet die eigenen Server direkt in der Seitenleiste (Kürzel-Kachel, Name, Status-Punkt) als Sprungziele. |
| 1.3 | **A** | erledigt | Navigationspunkt **„Server erstellen"** fehlt in der Sidebar. In der App nur über den Button „Neuer Server" auf der Übersicht erreichbar. |
| 1.4 | **A** | erledigt | **Ungelesen-Zähler an „Nachrichten"** fehlt (Mockup: Badge mit Anzahl). |
| 1.5 | **B** | erledigt | **Reihenfolge Hauptnavigation.** Mockup: Übersicht, Nachrichten, Skins, Benachrichtigungen, Nodes, Server erstellen, Meine Backups, Arcade. App: Übersicht, Meine Backups, Nachrichten, Benachrichtigungen, Nodes, Arcade, Skins. |
| 1.6 | **B** | erledigt | **Reihenfolge Administration.** Mockup: Nutzer, Rollen, Templates, Bilder, Sticker, Arcade-Musik, Benachrichtigungs-Regeln, Anfragen, Audit-Log, Backups, Node-Platz, Adressen. App: Nutzer, Anfragen, Rollen, Moderation, Benachrichtigungs-Regeln, Ankündigungen, Audit-Log, Backups, Nodes, Node-Platz, Adressen, Templates, Bilder, Sticker, Arcade-Musik. |
| 1.7 | **C** | entschieden | App hat drei Admin-Punkte mehr als das Mockup: **Moderation**, **Ankündigungen**, **Nodes (Admin)**. Sie bleiben und stehen jetzt jeweils neben dem Eintrag, zu dem sie fachlich gehören (Moderation zu Nutzer/Rollen, Ankündigungen zu den Benachrichtigungs-Regeln, Nodes zum Node-Platz) – statt gesammelt am Ende. |
| 1.8 | **B** | erledigt | **Versionszeile im Fuß.** Mockup `v2026.34.0-entwicklung`, App `Palantir · v0.6.0`. Nur Format; die Quelle (`package.json`) bleibt richtig. |
| 1.9 | **C** | offen | Die „Demo-Rolle"-Auswahl rechts oben im Mockup ist eine reine Vorführhilfe des Entwurfs. **Nicht nachbauen.** |
| 1.10 | **A** | offen | **Glocke in der Topbar fehlt.** Mockup: Schaltfläche rechts neben dem Gesamtstatus mit rotem Punkt bei ungelesenen Benachrichtigungen; ein Klick öffnet eine Liste der letzten Meldungen („Beim Öffnen als gelesen markiert"). Nachträglich aufgenommen – beim ersten Durchgang übersehen. Die Zahl dafür liegt bereits vor (`useNotificationLive` liefert `unreadCount`). |

**Umsetzung von 1.1–1.8** liegt auf `ui/mockup-abgleich`. Die Kennzahlen der
Statusleiste entstehen aus vorhandenen Daten (Serverliste, Node-Liste,
Live-Messwerte) – kein neuer Endpunkt, keine Contracts-Änderung. Gerechnet wird
in [`shellSummary.ts`](../../apps/frontend/src/app/(dashboard)/shellSummary.ts),
dargestellt in [`GlobalStatus.tsx`](../../apps/frontend/src/app/(dashboard)/GlobalStatus.tsx).

Zwei bewusste Abweichungen dabei:

- Das Mockup zeigt beim Überfahren einer Kennzahl ein Fenster mit **Sparkline**.
  Die Kurve besteht dort aus erfundenen Zahlen („Seit dem Öffnen der Seite –
  diese Werte werden nicht gespeichert"). Statt einen Verlaufsspeicher zu
  erfinden, steht die Erläuterung als Tooltip an der Kennzahl.
- „in Bewegung" und „mit Fehler" zählen die vollständigen Zustandsgruppen des
  Lifecycles (also auch `creating` bzw. `crashed`), nicht nur die zwei bzw. den
  einen Zustand des Mockups.

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

| #   | Klasse | Stand    | Befund                                                                                                                                                                                                                                                                                                                                             |
| --- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | **B**  | erledigt | Die Gruppe hieß **„Angeheftet" statt „Angepinnt"**. Das Anpinnen selbst gab es bereits ([usePinnedServers.ts](../../apps/frontend/src/components/servers/usePinnedServers.ts)); beim ersten Durchgang stand hier fälschlich „Gruppe fehlt", weil in den Testdaten nichts angepinnt war. Das 📌 des Mockups ist in der App ein Symbol vor der Überschrift. |
| 3.2 | —      | entfällt | Die Gruppe „Andere Server" existiert (`groupServers` in [serverList.ts](../../apps/frontend/src/components/servers/serverList.ts)) und war nur leer, weil das Testkonto Besitzer aller Server war.                                                                                                                                                   |
| 3.3 | **A**  | erledigt | **Fußzeile fremder Karten.** Die Zeile gab es, aber ohne die Kennzeichnung **„Admin-Zugriff"**, und der Knopf **„Nachricht"** war zwar in der Karte angelegt, jedoch nirgends verdrahtet – er erschien deshalb nie. Beides ergänzt; „Nachricht" öffnet die Unterhaltung mit dem Besitzer.                                                             |
| 3.4 | **A**  | Backend  | Statuszusatz **„Update verfügbar"** erscheint nie. Die Oberfläche ist vollständig (`ServerCard`, verdrahtet in `ServerOverview`) – das Backend setzt `updateAvailable` fest auf `false`, weil der Vergleich der Image-Digests nicht zu B3 gehört ([dto.ts](../../apps/backend/src/modules/server-orchestration/dto.ts)). **Kein Frontend-Befund.**   |
| 3.5 | **B**  | erledigt | **Ring-Beschriftung** auf der Karte: „Platte" → **„Disk"** wie im Mockup. Die Detailseite behält „Platte" – der Entwurf selbst beschriftet sie dort so.                                                                                                                                                                                              |
| 3.6 | —      | entfällt | Die Fehlermeldung ist im Mockup **ebenfalls** ein rot umrandeter Kasten (`ServerCard.dc.html`, `card.isError`). Die App stimmt damit überein; der Erstbefund beruhte auf einem Kartenzustand, der im gerenderten Mockup nicht sichtbar war.                                                                                                          |
| 3.7 | —      | entfällt | Die Sortierung ist festgelegt, nicht willkürlich: erst Störungen, dann Bewegung, dann Ruhendes, innerhalb einer Gruppe alphabetisch (`compareServers`).                                                                                                                                                                                             |
| 3.8 | —      | entfällt | Der Untertitel folgt bereits dem Mockup (`gameTag` + Besitzername bei fremden Servern). Dass dort „Paper · 1.21.4" steht und in der App „Test-Server (Echo)", liegt am Spieltyp der Testdaten, nicht an der Ansicht.                                                                                                                                 |

**Umsetzung von 3.1, 3.3 und 3.5** liegt auf `ui/mockup-abgleich`. Zwei Mängel, die
dabei auffielen und ohne die der Ungelesen-Zähler aus 1.4 falsche Zahlen zeigt, sind
mitbehoben: der Lesestand einer Konversation wurde nur lokal vermerkt und nie an den
Server gemeldet (obwohl die Route dafür existiert), und der Rahmen holt die
Konversationen jetzt bei jedem Seitenwechsel neu.

Von den acht Befunden dieses Abschnitts haben sich **vier als falsch erwiesen**. Ursache
war durchweg dieselbe: die Demo-Daten des ersten Durchgangs gehörten alle einem Konto,
keiner war angepinnt und keiner hatte ein Update – die betroffenen Zustände wurden
deshalb nie gerendert. Für den weiteren Abgleich stehen jetzt auch fremde Server, ein
abgestürzter Server und eine Konversation in der Entwicklungsdatenbank.

---

## 4. Server-Detail (`/servers/[id]`)

| #   | Klasse | Stand    | Befund                                                                                                                                                                                                                                                                                             |
| --- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 | **A**  | erledigt | **Seitenkopf fehlte.** Jetzt steht über der Kopfkarte „`<Name>` / Details und Steuerung" mit „Zurück zur Übersicht" rechts. Der Zurück-Knopf ist dafür aus der Kopfkarte verschwunden – sie ist den Aktionen am Server vorbehalten.                                                                    |
| 4.2 | **B**  | erledigt | **Kopfkarte.** Kürzel-Kachel (62 px, Marken-Verlauf) ergänzt, mehr Innenabstand, oben ein Hauch der Markenfarbe (`bg-hero-gradient`), größerer Titel.                                                                                                                                                |
| 4.3 | **B**  | erledigt | **Die Konsole liegt jetzt auf der Übersicht**, zweispaltig neben „Server-Details" (Verhältnis 1.6 : 1 wie im Mockup, auf schmalen Bildschirmen untereinander). Der eigene Reiter „Konsole" entfällt – zwei Türen in denselben Raum. Ein Lesezeichen auf `?tab=console` landet auf der Übersicht.       |
| 4.4 | **B**  | erledigt | **Reiter** jetzt `Übersicht · Aufgaben · Dateien · Backups` wie im Mockup, dazu **Einstellungen**. Der Reiter bleibt, obwohl das Mockup ihn nicht kennt: dort führt das Zahnrad in der Kopfkarte in einen Dialog, den es in der App nicht gibt – ohne den Reiter hätte das Zahnrad kein Ziel.          |
| 4.5 | **B**  | erledigt | **Kachel-Beschriftungen**: „CPU" → „CPU-Last", „RAM" → „Arbeitsspeicher". „Platte" und „Ping" stimmten bereits.                                                                                                                                                                                      |
| 4.6 | **A**  | erledigt | Kachel **„Laufzeit"** ergänzt, gerechnet aus `lastStartedAt` und nur bei laufendem Server. Format `3 d 4 h` statt „3 Tage 4 Std." – die App hat dafür bereits einen geprüften Formatierer (`formatDuration`), eine zweite Schreibweise daneben wäre der schlechtere Tausch.                            |
| 4.7 | **B**  | erledigt | **Verlauf** ist wieder ein zurückhaltender Textlink („Verlauf anzeigen" / „Verlauf schließen") statt eines gefüllten Knopfes.                                                                                                                                                                        |
| 4.8 | **B**  | teilweise | **Netzwerkaktivität**: Beschriftungen auf „Eingehend"/„Ausgehend" geändert, Fußnote um den Hinweis auf das Relay ergänzt. Die zwei **Paket-Zähler** des Mockups fehlen weiter – `ServerLiveStats` kennt nur `networkRxBytes` und `networkTxBytes`. Sie nachzurüsten wäre eine Contracts-Änderung. |

**Zusätzlich, nicht im Mockup:** Die Kachel **„Spieler"** bleibt. Das Mockup zeigt die
Spielerzahl nur auf der Karte, aber die Zahl liegt auch hier vor und gehört zum Zustand
des Servers.

**Noch nicht sichtbar geprüft:** Ohne laufenden Agent liefert der Live-Kanal keine
Messwerte. Kacheln und Netzwerkzeile zeigen deshalb „—" bzw. „Der Server läuft nicht.";
ihr Aufbau ist am Code abgeglichen, ihre Darstellung mit echten Zahlen noch nicht.
Dasselbe gilt für die Konsolenausgabe.

---

## 5. Server anlegen (`/servers/neu`)

| #   | Klasse | Stand    | Befund                                                                                                                                                                                                                                                                    |
| --- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1 | **B**  | erledigt | **Titel und Untertitel** jetzt „Neuen Server erstellen" / „In wenigen Schritten zum eigenen Gameserver". Die bisherige Fassung („In vier Schritten") war genauer, das Mockup gibt aber den Ton vor – wie schon bei „Angepinnt" und „Disk".                                   |
| 5.2 | **B**  | erledigt | **Schrittanzeige** über die volle Breite: 38-px-Kreise mit der Beschriftung darunter, dazwischen eine Linie, die den zurückgelegten Weg in der Markenfarbe zeigt. Erledigte Schritte tragen einen Haken; bisher war die Anzeige klein, linksbündig und einzeilig.            |
| 5.3 | **B**  | erledigt | **Ohne umschließende Karte** – der Wizard ist die Seite. Breite auf 880 px wie im Mockup (vorher 768 px).                                                                                                                                                                   |
| 5.4 | **B**  | erledigt | **Hinweistext** „Wähle zuerst ein Spiel." statt „Bitte ein Spiel wählen."; die Node-Meldung zieht in dieselbe Ansprache mit („Wähle eine Node."). Die übrigen Meldungen kommen aus `@palantir/validation` und bleiben unangetastet.                                          |
| 5.5 | **B**  | erledigt | **Korrigiert:** Der Erstbefund sagte, das Mockup habe einen zurückhaltenden Knopf. Das stimmt nicht – dort steht `btnPrimaryStyle`, also derselbe gefüllte Verlaufsknopf wie in der App. Der einzige Unterschied war der **Pfeil**: „Weiter →". Dafür gibt es jetzt ein Symbol `arrowRight`. |
| —   | **B**  | erledigt | Nachgetragen: Der Knopf des letzten Schritts ist im Mockup **grün** („Server erstellen"), in der App war er die Primärfarbe. Angeglichen.                                                                                                                                    |
| 5.6 | **C**  | bleibt   | Zusätzlicher Knopf „Zurück zur Übersicht" im Seitenkopf. Das Mockup hat ihn nicht – ohne ihn führt aus dem Wizard aber nur die Seitenleiste zurück.                                                                                                                          |
| 5.7 | **C**  | bleibt   | Spielkarten tragen zusätzlich eine Empfehlungszeile (RAM/Kerne). Sinnvolle Ergänzung.                                                                                                                                                                                       |

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

## 13a. Nebenbefunde außerhalb der Oberfläche

Beim Abgleich aufgefallen, aber kein Mockup-Thema – hier notiert statt ungefragt
miterledigt (CLAUDE.md §6):

- **Access-Token wird nie erneuert.** `JWT_ACCESS_TOKEN_TTL` steht auf 15 Minuten,
  `REFRESH_TOKEN_TTL` auf 30 Tage, und das Backend bietet `POST /auth/refresh` an – das
  Frontend ruft die Route jedoch an keiner Stelle auf. Nach 15 Minuten antwortet jede
  API-Anfrage mit 401, während das Routing den Nutzer weiter als angemeldet behandelt
  (die Anmeldeseite leitet auf die Übersicht um). Die Oberfläche wirkt dann eingeloggt,
  zeigt aber keine Daten mehr. Beim Testen mehrfach zugeschlagen. Gehört zu B1/F1.
- **`updateAvailable` ist im Backend fest `false`** (siehe 3.4) – die Oberfläche dafür
  steht vollständig.
- **Paket-Zähler fehlen in `ServerLiveStats`** (siehe 4.8) – wäre eine Contracts-Änderung.

---

## 14. Zusammenfassung

| Bereich | A (fehlt) | B (weicht ab) | C (Entscheidung) | offen | entfallen |
| --- | --- | --- | --- | --- | --- |
| Grundgerüst | 5 | 3 | 2 | — | — |
| Anmelden/Registrieren | 2 | 2 | 2 | — | — |
| Übersicht | 2 | 2 | — | — | 4 |
| Server-Detail | 2 | 6 | — | — | — |
| Server anlegen | — | 5 | 2 | — | — |
| Nachrichten | — | 1 | 1 | 1 | — |
| Benachrichtigungen | 1 | 1 | 1 | — | — |
| Nodes | 1 | 3 | 1 | — | — |
| Meine Backups | — | 1 | 1 | 1 | — |
| Arcade | 2 | 2 | 1 | — | — |
| Profil | 1 | 3 | — | — | — |
| Administration | 7 | 13 | 3 | — | — |
| Phase-gesperrt | — | 1 | — | — | — |
| **Summe** | **23** | **43** | **14** | **2** | **4** |

Gegenüber dem ersten Durchgang: 3.2, 3.6, 3.7 und 3.8 entfallen, 3.1 rutscht von A nach B
(die Gruppen der Übersicht gibt es bereits), und 1.10 kommt als übersehener Befund hinzu.
3.4 bleibt in der Zählung, ist aber kein Frontend-Befund: die Oberfläche steht, das
Backend liefert `updateAvailable` nur nie als `true`.

Die zwei offenen Punkte (6.3, 9.3) betreffen Nachrichten und Meine Backups: dort fehlten
Chat- und Backup-Testdaten, die Ansichten sind noch nicht abschließend verglichen.

### Vorschlag für die Reihenfolge

1. ~~**Grundgerüst** (1.1–1.8)~~ – erledigt. Offen bleibt dort nur die Glocke (1.10).
2. ~~**Übersicht + Server-Karte** (3.1, 3.3, 3.5)~~ – erledigt. 3.4 wartet auf das Backend.
3. ~~**Server-Detail** (4.x)~~ – erledigt. Offen bleibt nur der Paket-Zähler aus 4.8, der eine Contracts-Änderung bräuchte.
4. ~~**Server anlegen** (5.x)~~ – erledigt.
5. **Kleinteiliges** (Anmelden, Profil, Arcade, Benachrichtigungen).
6. **Administration** – zuletzt, weil dort die meisten Klasse-C-Entscheidungen anstehen.

Vor Punkt 6 sollte geklärt sein, wie mit den 14 Klasse-C-Befunden verfahren wird: Die App
kann dort mehr als das Mockup, teils gedeckt durch Lasten- und Pflichtenheft. Ein
Rückbau auf den Mockup-Stand wäre ein Funktionsverlust.
