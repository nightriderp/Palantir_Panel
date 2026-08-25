# Lastenheft – Palantir

**Version:** 1.0
**Stand:** finale Anforderungsaufnahme vor Entwicklungsbeginn
**Dokumenttyp:** Lastenheft (Anforderungen aus Sicht des Auftraggebers/Nutzers)

---

## 1. Einleitung & Projektüberblick

**Palantir** ist eine selbst betriebene Webapplikation, mit der ein fester Kreis von Freunden (bzw. mehrere, einander teils unbekannte Freundesgruppen) eigenständig Gameserver auf einem privaten Homeserver erstellen, starten, stoppen und verwalten können – per Knopfdruck, ohne technisches Vorwissen und ohne Abhängigkeit von kommerziellen Gameserver-Hosting-Anbietern.

### 1.1 Motivation
- Unabhängigkeit von Drittanbietern für Gameserver-Hosting
- Freunde sollen selbstständig agieren können, ohne dass der Betreiber jeden Server manuell einrichten muss
- Vorhandene Hardware (Homeserver) soll sinnvoll genutzt werden
- Lerneffekt für den Betreiber (u. a. eigene Docker-Images für Spiele bauen)

### 1.2 Zielgruppe
- Freundeskreis(e) des Betreibers, mehrere unabhängige Gruppen möglich
- Technisch unterschiedlich versierte Nutzer – Bedienung muss einfach ("Knopfdruck") sein
- Ein Betreiber/Owner mit voller Kontrolle über die Instanz

---

## 2. Stakeholder / Rollenkonzept (fachlich)

**Sonderstatus Owner:** Der Ersteinrichter der Instanz erhält einen Sonderstatus, der **außerhalb** des Rollensystems liegt (technisch ein einzelnes Flag am Konto, keine Rolle) und immer alle Rechte garantiert – als Schutz davor, sich durch eine unbedachte Rollenänderung versehentlich selbst auszusperren. Genau ein Konto trägt diesen Status.

Das eigentliche Rollen-/Berechtigungssystem ist **frei konfigurierbar** (siehe Pflichtenheft für technische Details). Fachlich vorgesehen sind mindestens folgende Standard-Rollen bei Ersteinrichtung:

| Rolle | Beschreibung |
|---|---|
| **Admin** | Vollzugriff über das Rollensystem (Nutzerverwaltung, Rollen, Nodes, Backups global, Audit-Log, Benachrichtigungs-Regeln, Speicherverwaltung). Mehrfach vergebbar, vollständig editierbar. |
| **Moderator** | Wie Nutzer, zusätzlich Moderationsrechte für den Chat (gemeldete Nachrichten einsehen/bearbeiten). |
| **Nutzer** | Darf eigene Server erstellen und verwalten, am Chat teilnehmen, eigene Backups verwalten. |
| **Gast** | Automatische Standardrolle nach jeder Registrierung. Keinerlei Berechtigungen außer Ansicht des eigenen Profils, bis ein Admin die Rolle ändert. Geschützte Systemrolle, nicht editier-/löschbar. |

---

## 3. Funktionale Anforderungen

### 3.1 Authentifizierung & Registrierung
- Offene Registrierung (kein Invite-Zwang) über:
  - Benutzername + Passwort
  - Discord OAuth2
  - Twitch OAuth2
  - Steam (OpenID)
- Mehrere Login-Methoden pro Konto verknüpfbar (z. B. später Passwort zu einem per Discord erstellten Konto hinzufügen)
- Jedes neu registrierte Konto erhält automatisch die Rolle **Gast** und hat bis zur Freischaltung keinerlei Zugriff auf Funktionen
- Admin-Warteliste ("Anfragen") zeigt neue Registrierungen inkl. verfügbarer Profilinformationen (Discord-Tag/Avatar, Steam-Profilname, Twitch-Name) zur Wiedererkennung; Aktionen: freigeben oder sperren
- Sperren (Ban) jederzeit für jedes Konto möglich, unabhängig von Rolle
- Zwei-Faktor-Authentifizierung (2FA) für Passwort-Konten
- Verwaltung aktiver Sitzungen: Übersicht angemeldeter Geräte, einzeln remote abmeldbar
- Passwort-Reset ohne E-Mail-Versand (Admin setzt im Nutzerpanel zurück) – bewusste Entscheidung gegen Abhängigkeit von einem E-Mail-Dienstleister
- Selbstständige Account-Löschung durch den Nutzer
- Schutz gegen automatisierte Spam-Registrierung (selbstgehostetes CAPTCHA-Verfahren + Rate-Limiting)

### 3.2 Rollen & Berechtigungen
- Frei definierbare Rollen mit granularem Permission-Katalog (nicht auf 3 feste Rollen beschränkt)
- Nutzer können mehrere Rollen gleichzeitig haben
- Admin-Oberfläche zur Rollen-/Berechtigungsverwaltung

### 3.3 Server-Verwaltung
- Server erstellen: Spiel wählen, Name, Ressourcen-Konfiguration, Startparameter, optionaler Import bestehender Weltdaten (Migration von anderen Hosting-Anbietern)
- Start, Stop, Restart, Löschen, Klonen (mit oder ohne Weltdaten-Kopie)
- Live-Konsole mit Befehlseingabe
- Datei-Manager (Upload/Download/Bearbeiten von Konfigurations- und Welt-Dateien); Upload-Größe pro Datei ist begrenzt (Standardwert konfigurierbar, siehe Pflichtenheft)
- Vollständiger Export/Download aller Serverdaten jederzeit möglich (keine Abhängigkeit, Daten immer mitnehmbar)
- Backups: manuell und automatisch geplant; **automatische** Backups älter als 7 Tage werden gelöscht (neuestes bleibt immer erhalten); **manuell erstellte Backups sind von dieser automatischen Löschung ausgenommen** und müssen aktiv entfernt werden; Wiederherstellung (Restore) möglich
- Geplante Aufgaben ("Schedules"), z. B. täglicher Neustart zu fester Uhrzeit oder Konsolenbefehl zu festem Zeitpunkt
- Live-Monitoring: CPU, RAM, Speicher, Netzwerk, Spieleranzahl (je nach Spiel), Verlaufsdarstellung
- Warnungen bei knappen Ressourcen (Speicherplatz) auf Server- und Node-Ebene
- Server gilt erst als "läuft", wenn er nachweislich erreichbar ist (nicht nur Prozess gestartet)
- Automatischer Neustart bei Absturz, mit Schutz gegen Neustart-Schleifen
- Automatisches Abschalten bei Inaktivität (konfigurierbarer Timeout, Schonfrist nach Serverstart, individuell abschaltbar pro Server für geplante Events)
- Frei wählbare, eindeutige Subdomain pro Server (mit Verfügbarkeits- und Formatprüfung, geschützte Systemnamen gesperrt)
- Bei technisch unterstützten Spielen (initial: Minecraft) Zugriff ganz ohne sichtbaren Port über Hostname-basiertes Routing; bei anderen Spielen Subdomain mit Port
- Mitgliederverwaltung pro Server: weitere Nutzer als Mitverwalter mit eigener Berechtigungsstufe hinzufügbar

### 3.4 Ressourcenverwaltung
- Optionale, nachträglich vom Admin setzbare Nutzer-Kontingente (RAM/CPU/Speicherplatz/Anzahl gleichzeitiger Server); ohne gesetztes Limit gilt kein Limit
- Zusätzlich immer eine harte, globale Prüfung der tatsächlich verfügbaren Homeserver-Ressourcen vor jedem Start – unabhängig von individuellen Kontingenten

### 3.5 Spiele-Unterstützung
- Phase 1 (Grundsystem): spielunabhängig, funktionsfähig mit einem einfachen Test-Server-Typ
- Phase 2: erstes vollständig unterstütztes Spiel – Minecraft, mit selbst erstelltem Docker-Image
- Phase 3: schrittweise Erweiterung um weitere Spiele (siehe Anhang A) über ein generisches Spiele-Definitionssystem
- Vorgesehene Spielekandidaten laut Anhang A, Machbarkeit wird jeweils bei Umsetzung geprüft

### 3.6 Kommunikation
- Direktnachrichten (1:1) zwischen freigeschalteten Nutzern
- Automatischer Gruppen-Chat je Gameserver für alle Personen mit Zugriff auf diesen Server
- Melde-Funktion für einzelne Nachrichten; Admin/Moderator sehen und bearbeiten ausschließlich gemeldete Inhalte (kein genereller Volleinblick in private Chats)
- Benachrichtigungssystem für wichtige Ereignisse (Serverstatus, Backup-Fehler, automatisches Abschalten, neue Registrierungen, Ressourcen-Warnungen etc.), Versand initial über Discord-Webhook
- Konfigurierbare Benachrichtigungsregeln: welches Ereignis löst welchen Kanal für welchen Empfängerkreis aus
- Systemweite Ankündigungen durch den Admin (z. B. Wartungshinweise)

### 3.7 Administration
- Nutzerverwaltung (Rollen/Limits setzen, sperren, Server einsehen)
- Freischalt-Warteliste für neue Registrierungen
- Rollen-/Berechtigungsverwaltung
- Übersicht über den/die Homeserver ("Nodes") inkl. Auslastung und Kapazität
- Verwaltung des öffentlichen Port-Bereichs auf der VPS
- Globale Backup-Übersicht (alle Nutzer, Speicherverbrauch)
- Audit-Log aller sicherheitsrelevanten Aktionen (unveränderlich)
- Verwaltung der Benachrichtigungsregeln

### 3.8 Speicherverwaltung (Storage-Explorer)
- Admin erhält vollständige Übersicht über den belegten Speicherplatz am Homeserver: Server-Datenordner, Backups, Docker-Images (inkl. Kennzeichnung ungenutzter Images), sonstige/verwaiste Daten
- Direktes Löschen von Backups, ungenutzten Docker-Images und eindeutig verwaisten Daten über die Oberfläche
- Aktive Server-Datenordner sind über diese Ansicht bewusst **nicht** löschbar (nur über den dedizierten "Server löschen"-Vorgang)

### 3.9 Arcade-Bereich
- Eigenständiger Unterhaltungsbereich mit einfachen, selbst umgesetzten Browser-Minispielen (u. a. im Stil von Snake, Pong, Breakout, Tetris, Pac-Man – eigenständig entwickelt, keine Nutzung geschützter Original-Assets/Marken)
- Bestenliste je Spiel, nutzerbezogen

---

## 4. Nicht-funktionale Anforderungen

| Bereich | Anforderung |
|---|---|
| **Sicherheit** | Sicherheitsniveau vergleichbar einem kommerziellen Produkt: sichere Authentifizierung, Rollen-/Rechtekonzept, verschlüsselte Netzwerkverbindungen, Schutz vor Brute-Force/Spam, lückenloses und manipulationssicheres Audit-Log |
| **Unabhängigkeit** | Kein zwingender Einsatz kostenpflichtiger Drittanbieter-Dienste für Kernfunktionen (kein externer E-Mail-Dienst, kein kommerzieller CAPTCHA-Anbieter) |
| **Erreichbarkeit** | Kein offener Port am Heimrouter erforderlich |
| **Erweiterbarkeit** | Neue Spiele müssen sich ohne grundlegende Architekturänderung ergänzen lassen |
| **Bedienbarkeit** | Bedienung ohne tiefes technisches Vorwissen möglich ("per Knopfdruck") |
| **Mobile Nutzung** | Oberfläche muss auf Smartphone-Browsern gut nutzbar sein (responsive) |
| **Sprache** | Oberfläche zunächst ausschließlich auf Deutsch |
| **Wartbarkeit** | Klare Trennung von Backend, Frontend und Agent; parallele Entwicklung durch mehrere Entwickler-Sitzungen ohne Konflikte muss möglich sein |
| **Datenmitnahme** | Nutzer können ihre Server- und Backup-Daten jederzeit vollständig exportieren |

---

## 5. Rahmenbedingungen

- **Homeserver-Hardware:** AMD Ryzen 7 5800X, 32 GB DDR4-RAM, 2,5 TB SSD gesamt (500 GB für Proxmox/Systeme reserviert, 2 TB für die Gameserver-VM nutzbar); Betrieb via Proxmox, Gameserver laufen in einer dedizierten VM
- **Öffentlicher Server:** VPS bei Hetzner
- **Domain:** vorhanden, endgültiger Name aktuell noch offen (Platzhalter `<DOMAIN>` bis zur finalen Festlegung)
- **Tech-Stack-Wunsch:** Node.js/TypeScript (Backend), Next.js/React (Frontend) – siehe Pflichtenheft für Details
- **Repository:** öffentlich auf GitHub, so aufgebaut, dass Dritte das Projekt eigenständig nachbauen/selbst hosten können
- **Konfiguration:** sämtliche Umgebungsvariablen, Zugangsdaten und Tokens zentral in einer Datei

---

## 6. Abgrenzung (explizit nicht Teil von Version 1)

- Kein Hochverfügbarkeits-/Failover-Betrieb (ein Homeserver, eine VPS – bewusst akzeptiertes Risiko für dieses Projekt)
- Keine Monetarisierung/Abrechnung
- Kein Support für mehr als einen physischen Homeserver (Datenmodell ist dafür vorbereitet, Umsetzung ist spätere Erweiterung)
- Keine automatische Zusammenführung zweier unabhängig entstandener Nutzerkonten
- Keine Admin-Oberfläche zum Hinzufügen neuer Spiele-Typen in Version 1 (erfolgt zunächst über Code/Deployment)
- Keine Mehrsprachigkeit in Version 1

---

## 7. Phasenplan

1. **Phase 1 – Palantir Core:** vollständiges, spielunabhängiges Backend/Frontend inkl. Auth, Rollen, Server-Orchestrierung, Backups, Benachrichtigungen, Chat, Administration, Speicherverwaltung, Arcade – validiert über einen einfachen Test-Server-Typ
2. **Phase 2 – Erstes Spiel:** Minecraft mit selbst erstelltem Docker-Image
3. **Phase 3 – Skalierung:** sukzessive Ergänzung weiterer Spiele gemäß Anhang A

---

## Anhang A – Vorgesehene Spielekandidaten (Phase 3)

**Survival / Building / Crafting:** 7 Days to Die, Abiotic Factor, ARK: Survival Ascended, ARK: Survival Evolved, Avorion, Conan Exiles, Core Keeper, Don't Starve Together, Eco, Enshrouded, Palworld, Project Zomboid, Raft, RimWorld, Rust, Satisfactory, Sons of the Forest, Terraria, The Forest, V Rising, Valheim, Vintage Story

**Minecraft-Familie:** Minecraft (Paper), Minecraft Bedrock, Minecraft mit Mods (Forge/NeoForge/Fabric), Luanti

**Shooter / Taktik:** Arma 3, Arma Reforger, Battlefield 2, CS 1.6, CS: Source, CS2 (inkl. Inspect-Variante), DayZ, Deep Rock Galactic, Garry's Mod (TTT), Insurgency: Sandstorm, Killing Floor 2, Left 4 Dead 2, SCP: Secret Laboratory, Squad, Team Fortress 2, Unturned

**Sandbox / Simulation / Sonstiges:** Among Us, Assetto Corsa Competizione, Barotrauma, Euro Truck Simulator 2, Factorio, Lethal Company, Mecca Chameleon (Machbarkeit zu prüfen), Metin2, Sea of Thieves, SnowRunner, Space Engineers, Trackmania, Wreckfest, Hytale (Server-Support zum Zeitpunkt der Erstellung dieses Dokuments nicht verifizierbar, zu prüfen sobald relevant)

**Arcade-Bereich (kein Gameserver, Browser-Minispiele):** Snake, Pong, Breakout, Tetris-artig, Pac-Man-artig
