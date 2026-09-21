# Palantir einrichten

Diese Anleitung führt von zwei leeren Maschinen zu einer laufenden Installation. Sie
nennt bei jedem Schritt die Maschine, den Pfad und den Befehl. Alles, was
installationsspezifisch ist (Adressen, Domain, Schlüssel, Tokens), steht als
`<Platzhalter>` und gehört in die zentrale `.env`; welche Werte es gibt und was sie
bedeuten, beschreibt `.env.example` vollständig.

Palantir läuft auf zwei Maschinen:

| Maschine       | Rolle                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **VPS**        | öffentlich erreichbar: Reverse Proxy (Traefik), Frontend, Backend-API, PostgreSQL, Tunnel-Gateway, Spiele-Verkehrsproxy (frps) |
| **Homeserver** | privat, hinter NAT: Agent, Docker-Socket-Proxy, Spielcontainer, frpc, optional Hostname-Router                                 |

Der Homeserver nimmt **keine** eingehenden Verbindungen an, auch nicht aus dem Tunnel.
Jede Verbindung geht von ihm aus. Das ist die Sicherheitsarchitektur, und mehrere Schritte
unten dienen allein dazu, sie nicht versehentlich aufzuheben.

**Reihenfolge einer Neueinrichtung:** §1 (`.env`) → §2 (VPS-Grundlage) → §3 (WireGuard) →
§4 (DNS) → §5 (OAuth) → §6 (Datenbank und erster Start auf der VPS) → §7 (Deployment per
GitHub) → §8 (Homeserver) → §9 (Prüfen). WireGuard muss vor dem ersten `docker compose up`
auf der VPS stehen, sonst gibt es die Tunnel-Adresse beim Containerstart noch nicht.

---

## 1. Zentrale Konfiguration

Es gibt genau **eine** `.env`. Sie liegt auf beiden Maschinen unter `/opt/palantir/.env`;
jede Komponente liest daraus nur die Werte, die sie braucht. Erzeugt wird sie einmal auf
dem Rechner des Betreibers, im Repo-Root:

```bash
./scripts/setup.sh
```

Das Skript kopiert `.env.example` nach `.env`, erzeugt die Geheimnisse (JWT, CSRF, ALTCHA,
Agent-Token, Datenbankpasswort), legt die WireGuard-Schlüsselpaare an und prüft die
Pflichtfelder. Bereits gefüllte Werte überschreibt es nie; ein zweiter Lauf ist gefahrlos.

Von Hand einzutragen sind nur die Werte, die das Skript nicht wissen kann:

| Variable                                       | Woher                                          |
| ---------------------------------------------- | ---------------------------------------------- |
| `PALANTIR_DOMAIN`                              | eigene Domain, z. B. `panel.example.tld`       |
| `VPS_PUBLIC_IP`                                | öffentliche IPv4 der VPS                       |
| `ACME_EMAIL`                                   | Adresse für Let's-Encrypt-Hinweise             |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`   | §4                                             |
| `DISCORD_*`, `TWITCH_*`, `STEAM_*`             | §5, mindestens ein Anbieter                    |
| `GAME_PORT_RANGE_START`, `GAME_PORT_RANGE_END` | Portbereich der Spielserver, z. B. 25000–25999 |

**Rechte:** `chmod 600 /opt/palantir/.env`, Eigentümer ist der Dienst-Nutzer (§7.1 auf der
VPS, `root` auf dem Homeserver). Die Datei gehört nie ins Repository und nicht
unverschlüsselt in Backups.

Der Homeserver braucht nicht den vollen Satz. Dort genügen: `NODE_ENV`, `LOG_LEVEL`,
`PALANTIR_VERSION`, `SOCKET_PROXY_VERSION`, `FRP_VERSION`, `FRP_TOKEN`, `AGENT_TOKEN`,
`AGENT_NODE_ID`, `AGENT_BACKEND_WS_URL`, `AGENT_DATA_DIR`, `AGENT_BACKUP_DIR`,
`AGENT_CONTAINER_NETWORK`, `WIREGUARD_VPS_IP`, `GAME_PORT_RANGE_*`, `MINECRAFT_ROUTER_PORT`
und die Registry-Werte. `AGENT_TOKEN` und `FRP_TOKEN` müssen mit der VPS übereinstimmen.

---

## 2. VPS-Grundlage

Alle Befehle auf der **VPS** als `root`. Empfohlen ist ein aktuelles Debian oder Ubuntu LTS.
Die VPS braucht **nur Docker**; weder Node noch pnpm werden dort installiert.

```bash
curl -fsSL https://get.docker.com | sh
```

```bash
docker compose version
```

Firewall: nach außen offen sind genau vier Ports. Der Backend-Port 4000 gehört nicht dazu,
er wird an die Tunnel-Adresse gebunden (§8.3); der Datenbank-Port 5432 wird nie
veröffentlicht.

```bash
ufw default deny incoming && ufw default allow outgoing && ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 51820/udp && ufw enable
```

| Port        | Wofür                                            |
| ----------- | ------------------------------------------------ |
| `22/tcp`    | SSH-Administration und der Deploy-Zugang (§7.2)  |
| `80/tcp`    | HTTP, nur Umleitung auf HTTPS und ACME-Challenge |
| `443/tcp`   | HTTPS, Frontend und API                          |
| `51820/udp` | WireGuard (`WIREGUARD_LISTEN_PORT`)              |

Dazu kommt der Portbereich der Spielserver (`GAME_PORT_RANGE_START` bis `_END`, TCP **und**
UDP) und, falls der Hostname-Router genutzt wird, `MINECRAFT_ROUTER_PORT/tcp`. Das
Regelwerk dafür steht im Kopf von `deploy/vps/frps.toml`.

TLS und Reverse Proxy werden **nicht von Hand** eingerichtet: Der Dienst `traefik` im
Compose-Stack holt die Let's-Encrypt-Zertifikate selbst. Voraussetzung sind `ACME_EMAIL`
in der `.env` und DNS-Einträge, die auf die VPS zeigen (§4).

---

## 3. WireGuard-Tunnel

Der Tunnel ist das einzige Netz zwischen den Maschinen. Feste Adressen: VPS
`WIREGUARD_VPS_IP` (Vorgabe `10.10.0.1`), Homeserver `WIREGUARD_HOME_IP` (Vorgabe
`10.10.0.2`).

### 3.1 Schlüssel

`scripts/setup.sh` (§1) erzeugt beide Schlüsselpaare und legt die **privaten** Schlüssel
unter `wireguard/vps.key` und `wireguard/home.key` ab (Rechte 0600, Ordner 0700, per
`.gitignore` ausgeschlossen). In die `.env` kommen nur die öffentlichen Schlüssel. Aus
beidem schreibt das Skript zwei fertige Konfigurationen: `wireguard/wg0.vps.conf` und
`wireguard/wg0.home.conf`. Jede wird auf **genau eine** Maschine kopiert und danach lokal
gelöscht.

### 3.2 VPS

Zielort `/etc/wireguard/wg0.conf` auf der **VPS** (Inhalt von `wireguard/wg0.vps.conf`):

```ini
[Interface]
Address = <WIREGUARD_VPS_IP>/24
ListenPort = 51820
PrivateKey = <Inhalt von wireguard/vps.key>

[Peer]
PublicKey = <WIREGUARD_HOME_PUBLIC_KEY>
AllowedIPs = <WIREGUARD_HOME_IP>/32
```

Kein `Endpoint`: Der Homeserver sitzt hinter NAT und meldet sich selbst.

### 3.3 Homeserver

Zielort `/etc/wireguard/wg0.conf` auf dem **Homeserver** (Inhalt von
`wireguard/wg0.home.conf`):

```ini
[Interface]
Address = <WIREGUARD_HOME_IP>/24
PrivateKey = <Inhalt von wireguard/home.key>
PostUp = nft add table inet palantir_wg; nft add chain inet palantir_wg input '{ type filter hook input priority 0; policy accept; }'; nft add rule inet palantir_wg input iifname "wg0" ct state established,related accept; nft add rule inet palantir_wg input iifname "wg0" drop
PostDown = nft delete table inet palantir_wg

[Peer]
PublicKey = <WIREGUARD_VPS_PUBLIC_KEY>
Endpoint = <VPS_PUBLIC_IP>:51820
AllowedIPs = <WIREGUARD_VPS_IP>/32
PersistentKeepalive = 25
```

`PostUp`/`PostDown` sind **Pflicht**: Sie verwerfen jeden neu eingehenden Verkehr aus dem
Tunnel, auch SSH, und lassen nur Antworten auf Verbindungen durch, die der Homeserver
selbst aufgebaut hat. Prüfbefehle und die `ufw`-Variante stehen in
[`gamenode/wireguard-firewall.md`](gamenode/wireguard-firewall.md).

### 3.4 Starten

Auf **beiden** Maschinen, so, dass der Tunnel beim Systemstart **vor** Docker läuft:

```bash
systemctl enable --now wg-quick@wg0
```

Gegenprobe auf der **VPS**:

```bash
ping -c 3 <WIREGUARD_HOME_IP>
```

---

## 4. DNS (Cloudflare)

Palantir legt DNS-Einträge für neue Spielserver automatisch über die Cloudflare-API an.
Einmalig anzulegen in der Zone von `PALANTIR_DOMAIN` (Ziel jeweils `VPS_PUBLIC_IP`):

| Typ | Name           | Proxy-Status                      |
| --- | -------------- | --------------------------------- |
| `A` | `@`            | „Proxied" möglich oder „DNS only" |
| `A` | `api`          | wie `@`                           |
| `A` | `*` (Wildcard) | **„DNS only"** (grau)             |

„DNS only" für die Spiele-Subdomains ist Pflicht: Cloudflare proxied nur HTTP(S), kein
Spieleprotokoll. Laufen `@` und `api` hinter dem Proxy, `TRUSTED_PROXY_HOPS` in der `.env`
setzen.

API-Token: unter _Profil → API-Tokens_ ein Token mit **ausschließlich** DNS-Bearbeitung für
genau diese Zone (Vorlage „Edit zone DNS"). In die `.env` auf der VPS:

```
CLOUDFLARE_API_TOKEN=<Token>
CLOUDFLARE_ZONE_ID=<Zone-ID aus der Zonenübersicht>
```

---

## 5. OAuth-Anbieter

Mindestens **ein** Anbieter muss konfiguriert sein. Die Rückruf-Adressen leiten sich aus
`PUBLIC_API_URL` ab (Vorgabe `https://<PALANTIR_DOMAIN>/api`) und müssen in der jeweiligen
Entwicklerkonsole **exakt** so stehen:

| Anbieter | Variablen                                                            | Rückruf-Adresse                                       |
| -------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| Discord  | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI` | `https://<PALANTIR_DOMAIN>/api/auth/discord/callback` |
| Twitch   | `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_REDIRECT_URI`    | `https://<PALANTIR_DOMAIN>/api/auth/twitch/callback`  |
| Steam    | `STEAM_API_KEY`, `STEAM_RETURN_URL`                                  | `https://<PALANTIR_DOMAIN>/api/auth/steam/callback`   |

- Discord: Developer Portal → New Application → OAuth2 → Redirects. Angefragt wird nur
  `identify` (optional `email`).
- Twitch: Developer Console → Register Your Application → OAuth Redirect URLs.
- Steam: Web-API-Key auf `PALANTIR_DOMAIN` registrieren; Steam hat kein Client-Secret.

Ein Tippfehler in der Adresse zeigt sich als `redirect_uri_mismatch` (Discord, Twitch)
oder als stumme Zurückweisung (Steam).

---

## 6. Datenbank und erster Start auf der VPS

Alle Befehle auf der **VPS** aus `/opt/palantir/deploy/vps`. Das Repository liegt unter
`/opt/palantir` (§7.1).

**Zugangsdaten.** `scripts/setup.sh` hat `POSTGRES_PASSWORD` erzeugt. `DATABASE_URL` muss
denselben Wert tragen:

```
DATABASE_URL=postgresql://palantir:<POSTGRES_PASSWORD>@postgres:5432/palantir
```

Nur alphanumerische Zeichen; Sonderzeichen müssten URL-kodiert werden. `@postgres` ist der
Dienstname im Docker-Netz, der Port wird nie veröffentlicht.

**Stack starten.** Der Container legt Rolle und Datenbank beim ersten Start selbst an, der
Dienst `migrate` wendet bei jedem Start die Migrationen an, bevor Backend und Frontend
hochfahren:

```bash
docker compose --env-file ../../.env up -d
```

**Ersteinrichtung** (einmalig): legt die Rollen Admin, Moderator, Nutzer und die geschützte
Systemrolle Gast an, dazu die erste Node, den Portbereich und die Grundregeln für
Benachrichtigungen. Der Lauf ist idempotent.

```bash
docker compose --env-file ../../.env run --rm seed
```

**Owner-Konto** (einmalig): Zuerst im Browser unter `https://<PALANTIR_DOMAIN>/register`
ganz normal ein Konto anlegen (der Wartebildschirm danach ist erwartet). Dann:

```bash
docker compose --env-file ../../.env run --rm owner <benutzername>
```

Der Owner steht außerhalb des Rollensystems und hat immer alle Rechte; genau ein Konto
trägt den Status. Bewusst kein Automatismus für das erste registrierte Konto: Die
Registrierung ist offen, und der Nachweis ist der Zugang zur Maschine. Danach einmal ab-
und wieder anmelden. Ab hier läuft alles über die Oberfläche: Der Owner schaltet weitere
Konten unter „Anfragen" frei.

**Audit-Archiv** (laufender Betrieb): Einträge älter als 24 Monate wandern in
`AUDIT_ARCHIVE_DIR` (Vorgabe `/opt/palantir/data/audit-archive`, Eigentümer UID 1000, Rechte
700). Lauf: `docker compose --env-file ../../.env run --rm archive`, gern monatlich per
Cron.

---

## 7. Deployment per GitHub Actions

Ein Deployment läuft so: Ein Pull Request wird nach `main` gemergt, `images.yml` baut die
drei Anwendungs-Images und legt sie mit dem Commit-SHA in der GitHub Container Registry
(GHCR) ab. Ein **signiertes Versions-Tag** `vX.Y.Z` löst `deploy.yml` aus; nach einer
Freigabe im Environment `production` verbindet sich der Workflow per SSH mit der VPS und
ruft dort genau ein Skript auf. Der Homeserver holt sich denselben Stand selbst (§8.6).

### 7.1 Deploy-Benutzer auf der VPS

Als `root` auf der **VPS**, ein eigener Benutzer, nicht `root`:

```bash
adduser --system --group --shell /bin/bash --home /home/palantir-deploy palantir-deploy && usermod -aG docker palantir-deploy
```

```bash
git clone https://github.com/<owner>/<repo>.git /opt/palantir && chown -R palantir-deploy:palantir-deploy /opt/palantir
```

Die `.env` aus §1 nach `/opt/palantir/.env` legen:

```bash
chown palantir-deploy:palantir-deploy /opt/palantir/.env && chmod 600 /opt/palantir/.env
```

### 7.2 Schlüssel für die Pipeline

Auf dem Rechner des Betreibers:

```bash
ssh-keygen -t ed25519 -f palantir-ci -N "" -C "github-actions-deploy"
```

Auf der **VPS** den öffentlichen Teil hinterlegen. Entscheidend ist das erzwungene
Kommando: Ohne `command=` wäre der Schlüssel ein vollwertiger Shell-Zugang.

```bash
install -d -m 700 -o palantir-deploy -g palantir-deploy /home/palantir-deploy/.ssh
```

In `/home/palantir-deploy/.ssh/authorized_keys` **eine** Zeile:

```
command="/opt/palantir/deploy/vps/deploy.sh",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc ssh-ed25519 <Inhalt von palantir-ci.pub>
```

```bash
chown palantir-deploy:palantir-deploy /home/palantir-deploy/.ssh/authorized_keys && chmod 600 /home/palantir-deploy/.ssh/authorized_keys
```

Probe vom Betreiber-Rechner; erwartet wird **nicht** eine Shell, sondern die Fehlermeldung
des Deploy-Skripts (`Kein gültiger Commit-SHA`):

```bash
ssh -i palantir-ci palantir-deploy@<VPS_PUBLIC_IP> "whoami"
```

### 7.3 GitHub-Environment `production`

Im Repository unter _Settings → Environments_: Name `production`, **Required reviewers**
mit dem eigenen Konto, **Deployment branches** auf `main` beschränkt. Als
**Environment-Secrets** (nicht Repository-Secrets):

| Name          | Inhalt                                          |
| ------------- | ----------------------------------------------- |
| `VPS_SSH_KEY` | vollständiger Inhalt von `palantir-ci` (privat) |
| `VPS_HOST`    | `VPS_PUBLIC_IP` oder Hostname                   |
| `VPS_USER`    | `palantir-deploy`                               |

Den privaten Schlüssel danach lokal löschen. Als Repository-Variable: `PALANTIR_DOMAIN`
(wird beim Bau des Frontends gebraucht).

### 7.4 Versions-Tags signieren

Die Node zieht ihren Stand aus dem Zweig `prod`. Damit ein bewegter Zweig allein nicht
reicht, verlangen `deploy/gamenode/update.sh` und der Deploy-Workflow ein signiertes Tag
auf dem Zielcommit, sobald ein Schlüssel eingetragen ist.

Einmalig auf dem Rechner, von dem aus Tags gesetzt werden:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/palantir_release -C "palantir-release" && git config --global gpg.format ssh && git config --global user.signingkey ~/.ssh/palantir_release.pub && git config --global tag.gpgsign true
```

Zugelassene Unterzeichner, dieselbe Zeile an zwei Orten: im Repository in
`deploy/allowed_signers` und auf dem **Homeserver** unter `/etc/palantir/allowed_signers`
(root:root, 0644):

```
<mail-adresse> namespaces="git" <Inhalt von ~/.ssh/palantir_release.pub>
```

Prüfen:

```bash
git -c gpg.format=ssh -c gpg.ssh.allowedSignersFile=deploy/allowed_signers verify-tag vX.Y.Z
```

### 7.5 Ausrollen

```bash
git tag -s v1.0.0 -m "<kurz, was drin ist>"
git cat-file -t v1.0.0   # muss `tag` ausgeben, nicht `commit`
git push origin v1.0.0
```

**`-s` ist nicht optional**, sobald in `deploy/allowed_signers` ein Schlüssel steht (7.4).
Ohne das Flag entsteht ein _leichtgewichtiges_ Tag: ein bloßer Zeiger auf den Commit, ohne
eigenes Objekt und damit ohne Platz für eine Signatur. Der Deploy-Lauf bricht dann mit
`cannot verify a non-tag object of type commit` ab – die Meldung sagt nicht „falsch
unterschrieben", sondern „hier ist nichts zum Prüfen". Die Zeile dazwischen zeigt das vorher
an: `tag` ist richtig, `commit` ist das leichtgewichtige.

`tag.gpgsign true` aus 7.4 erledigt das `-s` von allein. Die Angabe steht hier trotzdem: Auf
einem frisch aufgesetzten Rechner ist die Einstellung noch nicht da, und das fällt sonst erst
am abgebrochenen Deployment auf.

Ein Tag mit demselben Namen **neu** zu setzen verlangt, es vorher zu löschen – auf beiden
Seiten. `git tag -s` überschreibt kein vorhandenes Tag, sondern bricht mit `already exists`
ab; der Push schickt danach wieder das alte, und der Lauf scheitert erneut an derselben
Stelle:

```bash
git push origin :refs/tags/v1.0.0 && git tag -d v1.0.0
```

Der Workflow wartet auf die Freigabe im Environment, prüft die Signatur, verbindet sich mit
der VPS, setzt `PALANTIR_VERSION` auf den Commit-SHA und startet den Stack neu. Danach
bewegt er den Zweig `prod` auf denselben Commit; das ist das Signal für den Homeserver.

### 7.6 API am Panel-Host (einziger Weg seit dem 20.09.2026)

Die API liegt unter `<Domain>/api`, auf demselben Host wie das Panel. Einen eigenen
API-Host (`api.<Domain>`) gibt es nicht mehr.

**Warum.** Zwei Hosts zwingen die Sitzungs-Cookies auf die Elterndomain – und damit gehen
sie auch an `<name>.<Domain>`, also an die Spielcontainer. `httpOnly` hält dort nur
Skripte ab, nicht den Empfänger: Ein HTTP-Dienst auf einer Spiel-Subdomain bekäme sie im
Anfragekopf. Auf einem gemeinsamen Host leitet das Backend gar keine Cookie-Domain mehr
ab; die Cookies sind host-only. Nebenbei entfällt CORS als Thema.

**Was das für eine neue Instanz heißt.** Nichts weiter: `PUBLIC_API_URL` leer lassen, die
Vorgabe ist `https://<Domain>/api`, und `COOKIE_DOMAIN` bleibt ebenfalls leer. Die
Rücksprung-Adressen der Anmeldedienste leiten sich daraus ab (Abschnitt 7.2) und müssen so
in der Discord- und der Twitch-Konsole stehen.

**Was in das Browser-Bundle gehört.** `PUBLIC_API_URL` wird beim **Bauen** in das Bundle
geschrieben, nicht zur Laufzeit gelesen. Wer die Adresse ändert, setzt deshalb die
Repository-Variable (GitHub, _Settings → Variables_) **und** rollt neu aus. Eine Änderung
allein in der `.env` führt zu einer Anmeldung, die mit 200 antwortet und trotzdem nicht
funktioniert.

**Ein eigener API-Host wieder?** Dann braucht es den Router zurück
(`palantir-api` in `deploy/vps/docker-compose.yml`, entfernt am 20.09.2026), dazu
`PUBLIC_API_URL`, `COOKIE_DOMAIN` und die beiden `*_REDIRECT_URI` in der `.env` – und die
Cookies gelten wieder für die Elterndomain. Der empfohlene Weg dafür ist eine Ebene
tiefer: `panel.<Domain>` und `api.panel.<Domain>`, damit die Spielserver-Hosts daneben
liegen.

---

## 8. Homeserver

Alle Befehle als `root` in der Gameserver-VM. Diese Maschine nimmt keine eingehenden
Verbindungen an; es wird kein Port weitergeleitet, und die Compose-Datei setzt bewusst
kein `ports:`.

### 8.1 Docker und Verzeichnisse

```bash
curl -fsSL https://get.docker.com | sh
```

Datenverzeichnisse gehören **UID 1000** (der Agent läuft als dieser Benutzer und legt je
Server einen Ordner an):

```bash
install -d -m 755 -o 1000 -g 1000 /srv/palantir/servers /srv/palantir/backups /srv/palantir/router /srv/palantir/router/proxies
```

### 8.2 Zugangsdaten unter `/etc/palantir`

Der Update-Dienst läuft mit `ProtectHome=true`, sieht also weder `/root` noch `/home`.
Alles, was er braucht, liegt deshalb unter `/etc/palantir`:

```bash
mkdir -p /etc/palantir/docker && chmod 700 /etc/palantir
```

Deploy-Key (Leserecht) erzeugen und den öffentlichen Teil im Repository unter _Settings →
Deploy keys_ **ohne** Schreibrecht eintragen:

```bash
ssh-keygen -t ed25519 -N '' -C 'palantir-gamenode-readonly' -f /etc/palantir/repo_readonly
```

GitHubs Host-Schlüssel hinterlegen und gegen den unter `https://api.github.com/meta`
veröffentlichten Fingerabdruck prüfen:

```bash
ssh-keyscan -t ed25519 github.com > /etc/palantir/known_hosts && ssh-keygen -lf /etc/palantir/known_hosts
```

Auschecken und den Schlüssel fest an die Auscheckung binden:

```bash
GIT_SSH_COMMAND='ssh -i /etc/palantir/repo_readonly -o IdentitiesOnly=yes -o UserKnownHostsFile=/etc/palantir/known_hosts' git clone git@github.com:<owner>/<repo>.git /opt/palantir
```

```bash
git -C /opt/palantir config core.sshCommand 'ssh -i /etc/palantir/repo_readonly -o IdentitiesOnly=yes -o UserKnownHostsFile=/etc/palantir/known_hosts' && git -C /opt/palantir checkout --detach origin/prod
```

Registry-Login für die privaten Images, mit einem Personal Access Token (classic) mit
`read:packages`, in das Verzeichnis unter `/etc/palantir`:

```bash
read -rsp 'Token: ' T; echo; echo "$T" | DOCKER_CONFIG=/etc/palantir/docker docker login ghcr.io -u <github-benutzer> --password-stdin; unset T
```

### 8.3 Agent-Kanal auf der VPS freigeben

Der Agent spricht das Backend über den Tunnel an, nicht über Traefik. Die Compose-Datei der
VPS bindet Port 4000 dafür an die Tunnel-Adresse:

```yaml
ports:
  - '${WIREGUARD_VPS_IP:-10.10.0.1}:4000:4000'
```

Voraussetzung ist, dass `wg-quick@wg0` vor Docker läuft (§3.4). Prüfen auf der **VPS**:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://<WIREGUARD_VPS_IP>:4000/health
```

### 8.4 `.env` und Node-Zuordnung

`/opt/palantir/.env` auf dem Homeserver mit den Werten aus §1 (knapper Satz). Zwei Werte
verbinden die Maschinen:

- `AGENT_BACKEND_WS_URL=ws://<WIREGUARD_VPS_IP>:4000/agent`
- `AGENT_TOKEN`: Das gemeinsame Token aus der VPS-`.env` gilt nur, solange es genau eine
  Node gibt. Sauberer, und ab der zweiten Node Pflicht: Im Panel für die Node ein eigenes
  Token erzeugen (Node-Liste → „Agent-Token", Recht `node.manage`), hier als `AGENT_TOKEN`
  eintragen und `AGENT_NODE_ID` auf die Id der Node setzen.

Stimmen die Tokens nicht überein, weist das Backend den Handshake ab; der Agent versucht es
dann still weiter, es sieht nicht nach einem Fehler aus.

### 8.5 Spielenetz und Ausgangsregeln

Spielcontainer dürfen ins Internet, aber nicht ins Heimnetz, nicht an die Tunnel-Adresse
und nicht zu Nachbarcontainern. Das Regelwerk legt das Netz `palantir-games` an und hängt
sich in `DOCKER-USER`. **Erst das Netz, dann der Stack**; ohne das Netz startet der Agent
nicht.

```bash
/opt/palantir/deploy/gamenode/egress-firewall.sh apply && /opt/palantir/deploy/gamenode/egress-firewall.sh status
```

Erwartet: Das Netz besteht, die Kette `PALANTIR-EGRESS` steht in `DOCKER-USER` an
**Position 1**. Den Neustart überleben lassen:

```bash
cp /opt/palantir/deploy/gamenode/palantir-egress.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now palantir-egress.service
```

Nach jedem Update, das das Regelwerk ändert, `apply` erneut ausführen (idempotent).

### 8.6 Stack und Update-Timer

```bash
export DOCKER_CONFIG=/etc/palantir/docker && cd /opt/palantir/deploy/gamenode && docker compose --env-file ../../.env up -d
```

```bash
docker compose --env-file ../../.env logs -f agent
```

Erwartet ist eine Zeile über die aufgebaute Verbindung; im Panel wechselt die Node auf
„Online". Der Timer holt danach alle fünf Minuten den Stand von `prod` und startet den Stack
neu, wenn er sich geändert hat:

```bash
cp /opt/palantir/deploy/gamenode/palantir-update.{service,timer} /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now palantir-update.timer
```

```bash
systemctl list-timers palantir-update.timer
```

### 8.7 Hostname-Router (optional)

Alle Minecraft-Server teilen sich einen öffentlichen Port; der Spieler tippt nur
`<welt>.<PALANTIR_DOMAIN>`. Dafür läuft auf dem Homeserver der Proxy Infrared als
Compose-Profil `hostname-router`. Einrichtung: in der `.env` `AGENT_ROUTER_DIR`,
`GAME_ROUTER_CONTAINER_IP`, `INFRARED_VERSION`, `INFRARED_DIGEST` setzen; Stack mit
`--profile hostname-router up -d` starten; auf der VPS einen A-Eintrag
`mc.<PALANTIR_DOMAIN>` anlegen, `GAME_ROUTER_HOSTNAME` setzen und `frps` sowie `backend` neu
starten. Ohne das Profil ist der Router folgenlos.

---

## 9. Prüfen

| Was             | Wo         | Befehl / Erwartung                                                       |
| --------------- | ---------- | ------------------------------------------------------------------------ |
| Tunnel          | VPS        | `ping -c 3 <WIREGUARD_HOME_IP>` antwortet                                |
| Dienste         | beide      | `docker ps` zeigt alle Container als `healthy`                           |
| Backend         | VPS        | `curl -s https://<PALANTIR_DOMAIN>/api/health` liefert `"database":"ok"` |
| Agent           | VPS        | `docker logs palantir-backend 2>&1 \| grep -i 'Agent verbunden'`         |
| Ausgangsregeln  | Homeserver | `egress-firewall.sh status` zeigt `PALANTIR-EGRESS` an Position 1        |
| Tunnel-Firewall | Homeserver | `nft list table inet palantir_wg` zeigt die `drop`-Regel                 |
| Spielserver     | Panel      | Server anlegen, starten, **beitreten**; erst das ist der Beweis          |

---

## Fallstricke

- **Agent bleibt „offline", kein Fehler im Log:** Tokens stimmen nicht überein (§8.4), oder
  die Protokollversion des Agents passt nicht zum Backend; das Panel zeigt in der
  Node-Liste die Fassung des Agents und eine Warnung.
- **Anlegen eines Servers endet mit `EACCES`:** Datenverzeichnisse gehören `root` statt UID
  1000 (§8.1).
- **Pull auf dem Homeserver scheitert mit `unauthorized`, obwohl `docker login` von Hand
  klappt:** Die Anmeldung liegt unter `/root/.docker` statt `/etc/palantir/docker` (§8.2).
- **Backend bindet nicht an Port 4000:** WireGuard lief beim Containerstart noch nicht
  (§3.4).
- **Spielerzahl und Ping bleiben leer:** Regelwerk nach einem Update nicht neu angewendet
  (§8.5).
- **Registrierung schlägt still fehl:** Rückruf-Adressen der OAuth-Anbieter stimmen nicht
  exakt (§5), oder `PALANTIR_DOMAIN` war beim Bau des Frontends nicht gesetzt (§7.3).
