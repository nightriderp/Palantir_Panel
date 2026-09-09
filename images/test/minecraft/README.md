# Test-Spielserver (Minecraft-Protokoll)

Prüfstand für die Kette des Panels — **kein Spielserver**. Er spricht genau so viel
Minecraft, dass sich alles daran ablesen lässt, was zwischen Panel und Spiel liegt:

| Geprüft wird             | Woran man es sieht                                                                |
| ------------------------ | --------------------------------------------------------------------------------- |
| Portvergabe und frp      | Der Server-List-Ping antwortet auf dem öffentlichen Port                          |
| Subdomain                | Der Hostname aus dem Handshake steht im Log                                       |
| Abfrage (`gamedig`)      | Spielerzahl und Antwortzeit erscheinen im Panel, Status wechselt auf `running`    |
| Konsole (`EXEC_CONSOLE`) | `palantir-console help` antwortet                                                 |
| Live-Logs                | Jede Verbindung erscheint sofort in der Panel-Konsole                             |
| Auto-Shutdown            | `players 0` über die Konsole lässt die Schonfrist laufen                          |
| Datenordner              | `server.properties` und `logs/latest.log` entstehen und lassen sich sichern       |
| Härtung                  | Läuft als `1000:1000`, ohne `chown`, schreibt nur nach `/data` (images/README.md) |

Der echte Minecraft-Server ist `images/game/minecraft`; die Regeln für alle Images und das
Namensschema stehen in `images/README.md`.

## Einstellungen

Alles über Umgebungsvariablen, gesetzt vom Panel über `envMapping` der Spiel-Definition:

| Variable                            | Vorgabe                  | Wirkung                                                |
| ----------------------------------- | ------------------------ | ------------------------------------------------------ |
| `SERVER_PORT`                       | `25565`                  | Port im Container                                      |
| `MOTD`                              | `Palantir – Test-Server` | Text in der Serverliste                                |
| `MAX_PLAYERS`                       | `20`                     | Angezeigte Obergrenze                                  |
| `FAKE_PLAYERS`                      | `0`                      | Gemeldete Spielerzahl beim Start                       |
| `VERSION_NAME` / `PROTOCOL_VERSION` | `Palantir Test` / `767`  | Was der Client als Version sieht                       |
| `STARTUP_DELAY_SECONDS`             | `0`                      | Verzögerter Start – prüft `starting → running`         |
| `IDLE_TIMEOUT_SECONDS`              | `30`                     | Frist je Verbindung ohne Datenverkehr; `0` schaltet ab |
| `PALANTIR_STARTUP_PARAMETERS`       | –                        | Wird ins Log und nach `server.properties` geschrieben  |

## Konsole

```
palantir-console help
palantir-console players 3
palantir-console motd Wartungsarbeiten
palantir-console stop
```

`players` ist der nützlichste Befehl: Damit lässt sich die Spielerzahl von Hand setzen und
so der Auto-Shutdown auslösen, ohne dass jemand wirklich spielt.

## Tests

`server.test.mjs` startet `server.mjs` als eigenen Prozess auf freien Ports und redet über
TCP mit ihm — **kein Docker nötig**, beide Dateien sind reine Node-Programme. Geprüft wird
vor allem, dass ein kaputter Client nur seine eigene Verbindung kostet und den Prozess
nicht mitnimmt (ungültiges VarInt, überzogene Paketlänge, Leerlauf) sowie der Exit-Code der
Konsole.

```bash
# im Verbund, so wie die CI es tut
pnpm test

# nur dieses Image
pnpm --filter @palantir/test-minecraft-image test

# ganz ohne pnpm (Dateiname ausschreiben – ein Verzeichnis nimmt `--test` nicht)
node --test images/test/minecraft/server.test.mjs
```

Die `package.json` daneben existiert nur für diese Verdrahtung; das Image kopiert sie nicht.
Die Leerlauf-Frist lässt sich für Tests über `IDLE_TIMEOUT_SECONDS` klein setzen
(Bruchteile von Sekunden sind erlaubt, `0` schaltet sie ab).

## Von Hand prüfen

```bash
docker run --rm -p 25565:25565 \
  --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges:true \
  --read-only --tmpfs /tmp -v "$PWD/probe:/data" \
  ghcr.io/nightriderp/palantir-test-minecraft:2
```

Danach in Minecraft unter `localhost` eintragen: Die Serverliste zeigt MOTD und
Spielerzahl, ein Verbindungsversuch endet mit einer erklärenden Meldung.
