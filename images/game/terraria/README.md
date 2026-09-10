# Terraria (`palantir-game-terraria`)

Das erste Spiel-Image ohne Laufzeit-Basis dazwischen. Der Server bringt sein Mono und seine
Bibliotheken selbst mit, es braucht also weder JVM noch SteamCMD noch .NET aus dem Image — genau
der Fall, für den `palantir-base-linux` als Wurzel gedacht ist.

| Sache         | Wert                                                             |
| ------------- | ---------------------------------------------------------------- |
| Basis         | `palantir-base-linux:2` (erst diese Fassung bringt `unzip` mit)  |
| Serverfassung | Bau 1458 (1.4.5.8), beim ersten Start geholt, Prüfsumme im Image |
| Port          | 7777/tcp — Spiel und Health-Check                                |
| Konsole       | Standardeingabe (`palantir-console`); Terraria kennt kein RCON   |
| Serverdateien | `/data/.palantir/server/<Bau>/Linux`                             |
| Welten        | `/data/welten`, gehören dem Betreiber                            |

## Woher die Serverdateien kommen

Re-Logic gibt den dedizierten Server unter einer festen Adresse heraus, aber nicht zur Weitergabe
frei — er kann also nicht im Image liegen. Das Startskript holt das Archiv beim ersten Start,
prüft es gegen die SHA-256 aus dem Dockerfile, packt es aus und **löscht das Archiv wieder**:
46 MiB je Server, die nie wieder gebraucht werden und sonst in jede Sicherung wanderten.

Steht die Binärdatei des angeforderten Baus schon da, passiert beim nächsten Start nichts. Passt
die Prüfsumme nicht oder ist die Quelle nicht erreichbar, endet der Start mit Exit-Code 69
(`EX_UNAVAILABLE`) — unterscheidbar von 78 (Einstellung falsch) und von einem Absturz.

## Der Stopp ist hier besonders

**Terraria speichert bei SIGTERM nicht.** Der Prozess endet, und die Welt steht auf dem Stand des
letzten selbsttätigen Speicherns — bis zu zehn Minuten Spielzeit weg, bei jedem Stopp und jedem
Neustart. Gespeichert wird beim Konsolenbefehl `exit`.

Deshalb ist dies das einzige Spiel-Image, das sich am Ende **nicht** per `exec` durch den
Serverprozess ersetzt. Eine Shell bleibt als PID 1 stehen, fängt das Signal ab, schickt `exit` in
dasselbe Rohr, das auch `palantir-console` benutzt, und wartet auf das Ende des Servers. Die
Kulanzzeit kommt aus `stopTimeoutSeconds` der Spieltyp-Definition (120 s); läuft sie ab, kommt
SIGKILL vom Docker-Daemon — dann ist es derselbe Verlust wie ohne den Umweg, aber eben erst dann.

Die Abweichung von Pflichtenheft §2.3 ist damit auf dieses Image begrenzt und hat einen Grund, der
nichts mit Bequemlichkeit zu tun hat.

## Einstellungen

Alles über Umgebungsvariablen, gesetzt vom Panel über `envMapping`. Das Startskript schreibt genau
diese Schlüssel nach `serverconfig.txt` und lässt jeden anderen unberührt — `npcstream`,
`priority` und was der Betreiber sonst gesetzt hat, gehören ihm.

| Variable                      | Vorgabe               | Schlüssel in `serverconfig.txt` |
| ----------------------------- | --------------------- | ------------------------------- |
| `TERRARIA_WORLD`              | `Palantir`            | `worldname`, `world`            |
| `TERRARIA_SIZE`               | `mittel`              | `autocreate` (1/2/3)            |
| `TERRARIA_DIFFICULTY`         | `klassisch`           | `difficulty` (0–3)              |
| `TERRARIA_SEED`               | –                     | `seed`                          |
| `TERRARIA_PASSWORD`           | –                     | `password`                      |
| `MAX_PLAYERS`                 | `8`                   | `maxplayers`                    |
| `MOTD`                        | `Ein Palantir-Server` | `motd`                          |
| `SERVER_PORT`                 | `7777`                | `port`                          |
| `PALANTIR_STARTUP_PARAMETERS` | –                     | zusätzliche Schalter            |

Größe und Spielart stehen im Panel als Wörter, weil ein Auswahlfeld mit „1, 2, 3" für niemanden zu
entziffern wäre; übersetzt wird im Startskript. Ein Wort, das es nicht gibt, endet mit 78 statt
still eine kleine Welt anzulegen.

Fest gesetzt werden außerdem zwei Schlüssel, die keine Entscheidung sind: `upnp=0` (Terraria
versuchte sonst, sich am Heimrouter eine Portweiterleitung einzurichten — der Weg nach draußen
führt hier durch den Tunnel) und `secure=1`.

## Welt und Größe

`world` und `autocreate` stehen zusammen in der Datei: Der Server erzeugt die Welt einmal und
öffnet danach dieselbe. Größe, Spielart und Startwert gelten deshalb **nur beim Erzeugen** — eine
bestehende Welt wächst davon nicht. Wer eine neue will, ändert den Namen; die alte bleibt in
`/data/welten` liegen.

Die Welten liegen neben den Serverdateien, nicht darin: Eine neue Spielfassung ersetzt den
Serverordner vollständig.

## Keine Spielerzahl

Der Health-Check ist ein Verbindungsversuch auf 7777 (`query.kind: 'portConnect'`) — das reicht,
weil Terraria TCP spricht. Er sagt aber nur, dass der Port Verbindungen annimmt, nicht wie viele
Leute spielen. Der automatische Stopp bei 0 Spielern bleibt hier deshalb wirkungslos (der Zweig
dafür steht in `auto-shutdown.ts`).

Eine echte Abfrage gäbe es über `gamedig`, aber nur mit der Server-Erweiterung TShock und einem
REST-Token. Das wäre ein eigenes Image, kein Schalter.

## Fassung erhöhen

Die Bau-Nummer ist die Fassung ohne Punkte: 1.4.5.8 → 1458. Die höchste, die mit 200 antwortet,
ist die aktuelle.

```bash
curl -sIo /dev/null -w '%{http_code}\n' https://terraria.org/api/download/pc-dedicated-server/terraria-server-1459.zip
```

Dann `TERRARIA_BUILD`, `TERRARIA_URL` und `TERRARIA_SHA256` im Dockerfile tauschen, `VERSION`
erhöhen und `dockerImage` in `game-registry.ts` nachziehen.

```bash
curl -sL https://terraria.org/api/download/pc-dedicated-server/terraria-server-1458.zip | sha256sum
```

Bestehende Server holen die neue Fassung beim nächsten Start selbst — der alte Bau bleibt im
Datenordner liegen, bis jemand ihn wegräumt.

## Tests

`start.test.mjs` ruft `start.sh` mit `sh` auf, ohne Docker und ohne Terraria. Gestellt werden ein
Datenordner und ein `TerrariaServer.bin.x86_64`, das seine Argumente und jede Zeile von der
Standardeingabe aufschreibt. Geprüft werden die verwalteten Schlüssel, die Übersetzung von Größe
und Spielart, die Trennung der Ordner — und der Stopp: dass beim Signal wirklich `exit` in der
Konsole ankommt.

Der letzte Fall wird auf Windows übersprungen: Dort gibt es keine POSIX-Signale, `SIGTERM` beendet
den Prozess sofort und kein `trap` läuft. In der CI (ubuntu-latest) läuft er.

Ob der echte Server damit startet, zeigt erst ein Lauf auf der Node.
