# Basis-Image: .NET 8 (`palantir-base-dotnet8`)

Die Grundlage für Spielserver, die .NET 8 verlangen — tModLoader ist der erste und der Grund,
warum es dieses Image gibt. Kein Spiel; das Image hat keinen `ENTRYPOINT`.

| Enthalten                     | Version                                            |
| ----------------------------- | -------------------------------------------------- |
| Grundlage                     | `palantir-base-linux:3`                            |
| .NET-Laufzeit                 | 8.0.31, im Image, per SHA-512 gepinnt              |
| `libicu`, `libssl`            | was .NET außer sich selbst braucht                 |
| `/opt/palantir/lib/dotnet.sh` | die Schreiborte, die .NET ungefragt anlegen möchte |

## Warum es das neben `base/dotnet` gibt

`images/README.md` legt fest: **eine Hauptfassung der Laufzeit je Basis-Image**. Wer eine andere
braucht, bekommt ein Basis-Image daneben, keinen Schalter. Dieser Fall ist eingetreten.

`base/dotnet` trägt .NET 10 (Vintage Story). tModLoader verlangt in seiner
`tModLoader.runtimeconfig.json` ausdrücklich:

```json
"framework": { "name": "Microsoft.NETCore.App", "version": "8.0.0" }
```

Ein .NET-8-Programm läuft auf einer .NET-10-Laufzeit nur mit `--roll-forward Major`. **tModLoader
selbst tut das nicht**: Sein Startskript (`LaunchUtils/DotNetVersion.sh`) liest die Fassung aus
der `runtimeconfig.json` und holt punktgenau diese. Etwas auszuliefern, das der Hersteller so
nicht vorsieht — bei einem Spiel mit reichlich nativer Anbindung (FNA, SDL2, FAudio) —, wäre eine
Wette ohne Not.

Der Preis ist ein zweites Image von 31 MB Laufzeit. Der Gewinn ist, dass ein Spiel-Update von
.NET 10 die .NET-8-Spiele nicht anfasst und umgekehrt.

## Was daraus folgt

Die beiden Basen teilen sich `dotnet.sh` **nicht** als Datei, sondern als Kopie. Das ist Absicht:
Sie haben verschiedene Fassungen und verschiedene Lebensläufe, und ein gemeinsames Stück Shell
zwänge die eine bei jeder Änderung der anderen zu einer neuen Fassung — Versions-Tags werden nie
überschrieben.

## Version erneuern

```bash
curl -s https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/8.0/releases.json \
  | jq -r '."latest-release"'
curl -sL <url> | sha512sum
```

Dann die drei `ARG`-Werte und `PALANTIR_DOTNET_VERSION` im Dockerfile tauschen und `VERSION`
erhöhen. Die Spiel-Images ziehen nicht von selbst nach — wer die neue Fassung will, setzt dort
`BASIS` um.

**Solange .NET 8 unterstützt wird.** Microsoft führt 8.0 als LTS; läuft die Unterstützung aus und
tModLoader ist bis dahin nicht auf eine neuere Fassung gewechselt, ist das eine Entscheidung und
kein Automatismus — dann steht hier eine Laufzeit ohne Sicherheitsaktualisierungen.

## Tests

`dotnet.test.mjs` ruft `dotnet.sh` mit `sh` auf, ohne Docker und ohne .NET: Geprüft wird, dass die
Schreiborte im Datenordner landen und nicht im schreibgeschützten Wurzeldateisystem.

Die `rauchprobe.sh` läuft dagegen **im gebauten Image** (images/README.md) und prüft, was nur dort
zu sehen ist: dass `dotnet --list-runtimes` als 1000 durchläuft, dass die genannte Fassung
tatsächlich in der Liste steht — hier besonders wichtig, weil die 8 der ganze Zweck des Images
ist — und dass `DOTNET_ROOT` stimmt.
