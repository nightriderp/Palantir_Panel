# Minecraft: Bedrock Edition (`palantir-game-minecraftbedrock`)

Der Server für die Bedrock-Ausgabe: Handy, Konsole, Windows-Edition. Mojang liefert ein natives
Linux-Programm, das nur die C-Bibliothek und `libgcc` braucht — keine JVM, kein SteamCMD. Das Image
sitzt deshalb unmittelbar auf `palantir-base-linux`.

**Nicht zu verwechseln mit `palantir-game-minecraft`.** Das ist die Java-Ausgabe: anderes Programm,
anderes Protokoll, andere Spielstände. Plugins der Java-Welt laufen hier nicht, und ein Java-Spieler
kommt nicht auf einen Bedrock-Server. Zwei Server, zwei Images.

| Sache         | Wert                                                            |
| ------------- | --------------------------------------------------------------- |
| Basis         | `palantir-base-linux:3`                                         |
| Serverfassung | 1.26.51.1, beim ersten Start geholt, Prüfsumme im Image         |
| Port          | 19132/udp — Spiel und Health-Check (GameDig `minecraftbedrock`) |
| Konsole       | Standardeingabe (`palantir-console`); Bedrock kennt kein RCON   |
| Serverdateien | `/data/.palantir/server/<Fassung>`                              |
| Spielstände   | `/data/worlds`, gehören dem Betreiber                           |

## Woher die Serverdateien kommen

Mojang gibt den dedizierten Server heraus, aber nicht zur Weitergabe frei — er kann also nicht im
Image liegen. Das Startskript holt das Archiv beim ersten Start, prüft es gegen die SHA-256 aus dem
Dockerfile, packt es aus und **löscht das Archiv wieder**: neunzig Megabyte je Server, die sonst in
jede Sicherung wanderten.

Die aktuelle Fassung nennt Mojang selbst. Ohne Kennungs-Kopf antwortet die Auslieferung mit 403:

```bash
curl -sL 'https://net-secondary.web.minecraft-services.net/api/v1.0/download/links' \
  | grep -o 'https://[^"]*bin-linux/bedrock-server-[0-9.]*\.zip'
curl -sL -H 'User-Agent: Mozilla/5.0' <Adresse> | sha256sum
```

Wer die Fassung wechselt, tauscht `BEDROCK_VERSION`, `BEDROCK_URL` und `BEDROCK_SHA256` im
Dockerfile und erhöht `VERSION`.

## Warum die Spielstände woanders liegen als das Programm

Bedrock kennt keinen Schalter für den Ort der Welten: Der Server sucht sie unter `worlds/` neben
seinem Programm. Läge das Programm im Datenordner, wanderten die Ressourcenpakete in jede Sicherung,
und ein Fassungswechsel schriebe mitten in die Spielstände.

Das Programm liegt deshalb unter `.palantir/server/<Fassung>`, und `worlds`, `allowlist.json` und
`permissions.json` sind Verweise auf den Datenordner. Ein Fassungswechsel legt einen neuen
Serverordner an; die Verweise setzt das Startskript bei jedem Start neu, bestehende Ziele bleiben
unangetastet.

## Ports

Bedrock spricht **UDP**. Der Spielport ist 19132; daneben belegt der Server einen zweiten Port für
IPv6, den das Startskript fest auf `Spielport + 1` setzt. Ohne diese Angabe nähme er seinen
Vorgabewert und kollidierte mit dem Nachbarn auf derselben Node.

Ein Verbindungsversuch auf TCP sagt bei UDP nichts. Der Health-Check fragt deshalb über GameDig mit
dem Protokoll `minecraftbedrock`.

## Was das Panel verwaltet

Das Startskript schreibt genau die Schlüssel in `server.properties`, für die es im Panel ein Feld
gibt — Name, Port, Spielerzahl, Spielmodus, Schwierigkeit, Cheats, Weltname, Startwert. Alles
andere bleibt unangetastet, auch von Hand Eingetragenes.

`online-mode` steht fest auf `true`: Ohne Konto-Prüfung käme jeder mit jedem Namen herein, auch mit
dem eines Spielers, der hier schon Rechte hat.

## Stoppen

Bedrock speichert beim Stoppsignal selbst und beendet sich. Das Startskript ersetzt sich deshalb am
Ende durch den Serverprozess (`exec`) — kein Prozess steht zwischen Signal und Server.
