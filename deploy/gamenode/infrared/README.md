# Hostname-Router (Infrared) – die eine Datei, die von Hand hier liegt

Ablageort im Betrieb: `/opt/palantir/deploy/gamenode/infrared/` auf der
**Gamenode** (Auscheckung dieses Repositories). Eingehängt wird der Ordner vom
Dienst `hostname-router` in `../docker-compose.yml`.

## Warum es diesen Platzhalter gibt

Infrared beendet sich beim Start mit `no proxies in gateway`, wenn sein
Routen-Verzeichnis leer ist (`Gateway.ListenAndServe` in `gateway.go` der
gepinnten Fassung v1.3.4). Mit `restart: always` liefe der Dienst dann in eine
Neustart-Schleife, und zwar genau im Normalzustand: Solange kein Spieltyp
`supportsVirtualHostRouting` auf `true` steht, gibt es keine einzige Route.

`00-platzhalter.json` ist deshalb eine Route, die nie greift:

- `kein-server.invalid` – die Sonderdomain `.invalid` ist nach RFC 6761 dauerhaft
  unauflösbar und kann keinem echten Server gehören.
- `127.0.0.1:1` – Ziel im eigenen Netz-Namensraum des Routers, an dem nichts
  lauscht. Wer die Adresse doch eintippt, bekommt die Trennmeldung.

Sie öffnet zugleich den Listener auf `:25565`, damit der Dienst auch ohne echte
Route erreichbar ist und nicht erst beim ersten Server anläuft.

## Wenn `MINECRAFT_ROUTER_PORT` geändert wird

Dann muss `listenTo` hier **mit** geändert werden. Die Datei ist statische
Konfiguration; Compose setzt in eingehängten Dateien keine Variablen ein. Bleibt
sie auf `:25565` stehen, öffnet der Platzhalter einen zweiten, ungenutzten
Listener – die echten Routen sind davon unberührt, denn die schreibt der Agent
mit dem Wert aus der `.env`.

## Die echten Routen

Die schreibt der Agent nach `${AGENT_ROUTER_DIR}/proxies/<serverId>.json`, eine
je Server, beim Anlegen des Containers und wieder weg beim Löschen
(`apps/agent/src/jobs/router/hostname-routes.ts`). In diesen Ordner hier gehört
von Hand nichts weiter hinein.
