# Vintage Story (`palantir-game-vintagestory`)

Das erste Spiel **ohne Steam und ohne Java**. Der Server kommt beim Hersteller her und läuft
auf .NET.

| Sache         | Wert                                                  |
| ------------- | ----------------------------------------------------- |
| Basis         | `palantir-base-dotnet:1`                              |
| Herkunft      | `cdn.vintagestory.at`, Fassung 1.22.7, per SHA-256    |
| Port          | 42420/tcp                                             |
| Konsole       | Standardeingabe (`/list clients`, `/announce`, `/op`) |
| Serverdateien | `/data/server`, beim ersten Start geholt              |
| Welt          | `/data/welten` (`--dataPath`)                         |

## Warum die Serverdateien nicht ins Image gehen

Vintage Story ist ein gekauftes Spiel. Die Serverdateien sind frei herunterzuladen, aber sie
weiterzugeben ist etwas anderes — dieselbe Überlegung wie bei der Minecraft-Jar von Mojang. Sie
werden deshalb beim ersten Start geholt und gegen eine feste Prüfsumme geprüft; danach liegen sie im
Datenordner und der zweite Start lädt nicht erneut.

## Die Einstellungen gehen auf die Befehlszeile

Andere Images schreiben die Konfigurationsdatei des Spiels bei jedem Start neu. Hier wäre das ein
Fehler: In der `serverconfig.json` stehen auch Rollen, Rechte und die Zugangsliste — alles, was der
Betreiber **im Spiel** gesetzt hat. Ein Startskript, das sie überschriebe, räumte das jedes Mal weg.

Vintage Story kennt dafür `--withconfig`: Die Werte des Panels liegen für diesen einen Lauf über der
Datei, und die Datei bleibt, wie sie ist.

```
dotnet VintagestoryServer.dll --dataPath /data/welten --withconfig '{"ServerName":"…","Port":42420,…}'
```

## Keine Abfrage

Die Spielerzahl bleibt im Panel leer, und das ist kein Fehler. `gamedig` kennt zwar ein Protokoll für
Vintage Story, aber es fragt nicht den Server: Es lädt das **Verzeichnis des Herstellers** und sucht
darin den Eintrag zur öffentlichen Adresse. Hinter dem Rückwärtstunnel steht dort die Adresse der
VPS, gefragt wird nach der des Containers — der Eintrag wird nie gefunden. Und ein Server, der sich
nicht anmeldet, steht ohnehin in keinem Verzeichnis.

Deshalb `query: { kind: 'none' }`: Der Start gilt als geglückt, sobald der Container läuft. Der Preis
ist derselbe wie bei Palworld — keine Spielerzahl, kein Ping, kein selbsttätiges Abschalten bei null
Spielern.

## Beim Stoppen wird gespeichert

Vintage Story speichert beim Befehl `/stop`; auf ein nacktes SIGTERM ist kein Verlass. Die Shell
bleibt deshalb als PID 1 stehen, fängt das Signal ab und schickt den Befehl in das Konsolen-Rohr —
wie bei Terraria (`exit`) und Project Zomboid (`quit`). Das ist bei diesen Spielen der Normalfall,
nicht die Ausnahme.

## Tests

`start.test.mjs` prüft ohne Docker, ohne .NET und ohne das Spiel: dass die Einstellungen als
`--withconfig` auf die Befehlszeile gehen und nicht in die Datei, die Maskierung, dass der Server
sich nicht ungefragt beim Hersteller anmeldet, dass UPnP aus bleibt — und dass der Datenordner als
`--dataPath` ankommt.

Ob der echte Server damit startet, zeigt erst ein Lauf auf der Node.
