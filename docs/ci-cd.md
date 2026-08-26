# CI/CD-Konzept

Ergänzt [PFLICHTENHEFT.md §12](../PFLICHTENHEFT.md) um den Weg vom Commit bis auf die
Zielmaschinen. Verhaltensregeln für die Entwicklung stehen in [CLAUDE.md](../CLAUDE.md).

> **Stand:** CI ist umgesetzt (`.github/workflows/ci.yml`). Der CD-Teil ist beschlossen,
> aber noch nicht gebaut – es fehlen `docker-compose.yml` und die Dockerfiles der drei
> Apps. Siehe „Was noch fehlt" am Ende.

---

## 1. Der Constraint, der alles bestimmt

[PFLICHTENHEFT.md §1](../PFLICHTENHEFT.md): _Der Homeserver nimmt zu keinem Zeitpunkt
eingehende Verbindungen an – weder vom Router noch innerhalb des Tunnels._

Damit ist ein Push-Deployment auf die Gamenode ausgeschlossen. Kein SSH aus der Pipeline,
auch nicht von der VPS durch den WireGuard-Tunnel. Die Gamenode **holt** sich ihren Stand
selbst. Das ist keine Bequemlichkeitsentscheidung und auch keine Frage der
Secret-Verwahrung, sondern folgt direkt aus der Architektur.

Für die **VPS** gilt das nicht – sie ist ohnehin öffentlich erreichbar. Dort wird per SSH
deployt, weil das zwei Dinge löst, die ein reiner Image-Updater nicht kann:

- **Änderungen an der `docker-compose.yml`.** Kommt ein Service dazu, ändert sich ein
  Port-Mapping oder eine Umgebungsvariable, muss die Compose-Datei auf der Maschine
  aktualisiert werden. Ein Updater, der nur Image-Tags beobachtet, bekommt davon nichts mit.
- **Reihenfolge.** Migration anwenden, _dann_ Backend neu starten – deterministisch und mit
  sichtbarem Ergebnis in der Pipeline, statt „der Container macht das beim Hochfahren
  irgendwie".

Die Gamenode löst das erste Problem anders: ihr Updater zieht nicht nur Images, sondern
auch das Repository auf das freigegebene Tag. Weiterhin rein ausgehend.

---

## 2. Ablauf

```
  Pull Request
       │
       ▼
  CI: build · typecheck · lint · test · format          .github/workflows/ci.yml
       │                                                 (Postgres-Service für DB-Tests)
       ▼
  Merge nach main  ──▶  Images bauen  ──▶  GHCR, getaggt :<sha>
       │
       ▼
  Freigabe durch den Betreiber        GitHub-Environment "production",
       │                              Pflicht-Reviewer
       ▼
  derselbe SHA bekommt zusätzlich :prod
       │
       ├──▶ VPS:      SSH-Deploy aus Actions
       │              git fetch <tag> · docker compose pull · db:migrate · up -d
       │
       └──▶ Gamenode: Updater zieht Repo-Tag + Agent-Image (ausgehend)
```

Entscheidend: die Freigabe **taggt ein bereits gebautes Artefakt um**. Es wird nichts neu
gebaut und nichts neu kompiliert – exakt der Stand, der geprüft wurde, geht nach Produktion.

---

## 3. CI

Läuft bei jedem Pull Request nach `main` und auf `main` selbst:

| Schritt                          | Zweck                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Schlägt fehl, wenn die `pnpm-lock.yaml` nicht zum Stand der `package.json` passt |
| `pnpm build`                     | Alle fünf Workspaces                                                             |
| `pnpm typecheck`                 | TypeScript im strict-Modus ([CLAUDE.md §4](../CLAUDE.md))                        |
| `pnpm lint`                      | ESLint                                                                           |
| `pnpm test`                      | Vitest über alle Workspaces                                                      |
| `pnpm format:check`              | Prettier                                                                         |

Ein PostgreSQL-Service-Container steht bereit und `DATABASE_URL` zeigt darauf, damit
datenbanknahe Tests laufen können. Die Zugangsdaten sind Wegwerfwerte – der Container
existiert nur für die Dauer des Laufs.

**Kein Docker in CI nötig.** [PFLICHTENHEFT.md §2.5](../PFLICHTENHEFT.md) schreibt für die
Container-Ansteuerung eine abstrahierte `ContainerRuntime` mit Fake-Implementierung vor;
die Agent-Tests laufen dagegen.

Warum das zählt: mehrere Sitzungen arbeiten parallel an eigenen Arbeitspaketen. Jede prüft
ihren eigenen Branch – **niemand prüft das Ergebnis der Zusammenführung.** Genau diese
Lücke schließt CI.

---

## 4. Artefakte und Registry

Images für Backend, Frontend und Agent liegen in der **GitHub Container Registry**
(`ghcr.io/nightriderp/palantir-*`), privat, mit denselben Zugangsdaten wie das Repository.

> **Abweichung:** [PFLICHTENHEFT.md §19](../PFLICHTENHEFT.md) führt die konkrete Registry
> als offenen Punkt, der „bei Beginn von Phase 2 festgelegt" werden sollte. Die Festlegung
> auf GHCR erfolgt hier bewusst früher, weil CD sonst keinen Ablageort hat. Ein Wechsel
> bliebe möglich – es ändert sich nur die Image-Adresse.

Registry-Zugang braucht die Gamenode ohnehin: ab Phase 2 zeigt
`GameTypeDefinition.dockerImage` auf selbst gebaute, private Spiel-Images, die der Agent
zur Laufzeit zieht.

**Tagging:**

| Tag      | Bedeutung                                                                    |
| -------- | ---------------------------------------------------------------------------- |
| `:<sha>` | Jeder Build von `main`. Unveränderlich, die eigentliche Wahrheit.            |
| `:prod`  | Zeigt auf den freigegebenen SHA. Wird beim Deploy umgehängt, nie neu gebaut. |

Ein Rollback ist damit ein Umhängen von `:prod` auf den vorherigen SHA.

---

## 5. Deployment

### 5.1 VPS – Push per SSH

Die Pipeline verbindet sich nach der Freigabe auf die VPS und führt dort aus:
Repository auf das freigegebene Tag bringen, Images ziehen, Migrationen anwenden,
Container neu starten.

**Auflagen für den Deploy-Zugang:**

- Eigener Deploy-Benutzer, **nicht** `root`.
- Der private Schlüssel liegt als Secret im GitHub-**Environment** `production`, nicht als
  Repository-Secret. Dadurch ist er nur für Jobs verfügbar, die dieses Environment
  ansprechen – und die brauchen die Freigabe. Ohne Freigabe ist der Schlüssel für keinen
  Workflow-Lauf erreichbar.
- In der `authorized_keys` auf der VPS wird der Schlüssel per `command="..."` auf ein festes
  Deploy-Skript festgenagelt, dazu `no-agent-forwarding,no-port-forwarding,no-pty`. Ein
  abhandengekommener Schlüssel erlaubt dann genau ein Deployment – keine Shell.
- Die `.env` auf der Maschine wird vom Deployment **nie** angefasst. Sie enthält alle
  Secrets ([PFLICHTENHEFT.md §12.1](../PFLICHTENHEFT.md)) und wird von Hand gepflegt.

### 5.2 Gamenode – Pull

Auf der Node läuft ein Timer, der das Repository auf das freigegebene Tag bringt und
`docker compose up -d` ausführt. Damit werden Agent-Image **und** Compose-Änderungen
übernommen, ohne dass jemals eine Verbindung in die Node hineingeht.

Der Agent ist die einzige Komponente, die sich selbst aktualisieren muss. Die
Gameserver-Container werden **nicht** deployt – die steuert das Panel zur Laufzeit über das
Agent-Protokoll, und der Agent zieht die Spiel-Images bei Bedarf.

Bewusst **nicht** gewählt: das Panel schickt dem Agent einen Update-Befehl über die
bestehende Verbindung. Das verletzt §1 zwar nicht, würde aber verlangen, dass der Agent
seinen eigenen Container ersetzt – und damit die Rechte des Docker-Socket-Proxy um
„Container neu erstellen" erweitern. Der Sicherheitsgewinn des Proxys
([PFLICHTENHEFT.md §2.3](../PFLICHTENHEFT.md)) wäre dahin.

---

## 6. Entwicklungsumgebung

| Teil                      | Wo                        | Wie                                                   |
| ------------------------- | ------------------------- | ----------------------------------------------------- |
| Panel (Backend, Frontend) | Entwicklungsrechner       | Direkt aus dem Quellcode, `pnpm dev`                  |
| Datenbank                 | Entwicklungsrechner       | Nativ installiert, siehe [SETUP.md §2.2](../SETUP.md) |
| Gamenode (Agent, Docker)  | eigene Dev-VM auf Proxmox | Agent aus dem Quellcode                               |

Auf dem Entwicklungsrechner wird **kein Docker** gebraucht – der interessante Teil,
die Container-Orchestrierung, läuft auf der Dev-VM.

Der Agent läuft in Dev **quellcodebasiert**, nicht als Image. Für A1, A2 und A3 ist das der
deutlich schnellere Zyklus. Dass die Deploy-Mechanik in Dev dadurch nicht mitgetestet wird,
ist bewusst in Kauf genommen; sie wird einmal beim ersten Produktivaufbau validiert.

**WireGuard ist in Dev nicht erforderlich.** Der Agent verbindet sich ausgehend; ob das
durch einen Tunnel oder direkt übers LAN geht, ist für die Anwendungsschicht unsichtbar.
Die Dev-VM verbindet sich direkt auf die LAN-Adresse des Entwicklungsrechners, Port 4000
(Firewall-Regel für eingehend 4000 nötig). Der Tunnel ist Infrastruktur und wird beim
Produktivaufbau getestet.

**Die Dev-Gamenode ist ein eigener `HostNode`-Datensatz mit eigenem `AGENT_TOKEN`** – nie
dasselbe Token wie die Produktiv-Node, sonst könnte eine Dev-Instanz Befehle für
Produktivserver entgegennehmen.

Größe der Dev-VM: für Phase 1 genügen 2 vCPU, 4 GB RAM, 40 GB Disk – der Test-Server-Typ
aus [PFLICHTENHEFT.md §11](../PFLICHTENHEFT.md) ist ein einfacher Container, der auf einem
Port lauscht. Für echte Spiele in Phase 2 wird mehr gebraucht.

---

## 7. Zwei Dinge, die die Pipeline nicht lösen kann

**Migrationen sind vorwärtsgerichtet.** Die Anwendung lässt sich über das `:prod`-Tag
zurückrollen, das Datenbankschema nicht. Konsequenz für **alle** Backend-Arbeitspakete:
Migrationen abwärtskompatibel schreiben – erst Spalte hinzufügen, Code umstellen, später in
einer eigenen Migration die alte entfernen. Nur dann ist ein Rollback der Anwendung ohne
Datenbank-Rollback möglich.

**Versions-Schiefstand Backend ↔ Agent.** Beide sprechen über `packages/contracts`, werden
aber nicht synchron aktualisiert – die Gamenode zieht auf ihrem eigenen Takt. Ein Agent mit
altem Protokoll trifft also auf ein neues Backend. Das braucht eine Protokollversion im
Handshake, die das Backend prüft und bei Inkompatibilität sauber ablehnt, statt undefiniert
zu scheitern. Gehört nach `packages/contracts` und in A1, nicht in die Pipeline.

---

## 8. Was noch fehlt

- `docker-compose.yml` für VPS- und Gamenode-Seite
- Dockerfiles für Backend, Frontend und Agent
- Der Build-und-Push-Workflow nach GHCR
- Das Deploy-Skript auf der VPS und der Updater-Timer auf der Gamenode
- GitHub-Environment `production` mit Pflicht-Reviewer
- Deploy-Benutzer und Schlüssel auf der VPS

Diese Punkte gehören zusammen in ein Deployment-Arbeitspaket und stehen als Nr. 2 unter
„Gefundene Punkte" in [WORK_STATUS.md](../WORK_STATUS.md).
