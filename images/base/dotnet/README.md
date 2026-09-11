# Basis-Image: .NET (`palantir-base-dotnet`)

Die Grundlage für Spielserver, die auf .NET laufen — Vintage Story ist der erste. Kein Spiel; das
Image hat keinen `ENTRYPOINT`.

| Enthalten                     | Fassung                                            |
| ----------------------------- | -------------------------------------------------- |
| Grundlage                     | `palantir-base-linux:3`                            |
| .NET-Laufzeit                 | 10.0.12, im Image, per SHA-512 gepinnt             |
| `libicu`, `libssl`            | was .NET außer sich selbst braucht                 |
| `/opt/palantir/lib/dotnet.sh` | die Schreiborte, die .NET ungefragt anlegen möchte |

## Drei Entscheidungen

**Die Laufzeit, nicht das SDK.** Ein Server wird nicht übersetzt, er wird ausgeführt. Das SDK wöge
ein Mehrfaches und brächte einen Übersetzer ins Laufzeit-Image, der dort nichts zu suchen hat.

**Der Tarball, nicht das Paketarchiv von Microsoft.** Ein `apt`-Archiv liefert, was gerade aktuell
ist; der Tarball liefert genau eine Fassung, und Microsoft veröffentlicht zu jeder die SHA-512. Ein
Bau von heute und einer von morgen ergeben denselben Inhalt. Dieselbe Überlegung wie bei der JRE in
`base/java`.

**.NET 10, eine Hauptfassung.** Vintage Story 1.22 nennt in seiner `runtimeconfig.json`
`Microsoft.NETCore.App 10.0.0`. Ein Spiel, das eine ältere braucht, bekommt ein Basis-Image daneben
(`base/dotnet8`), keinen Schalter in diesem — wie bei Java.

## Die Bibliothek

Ein Startskript bindet sie **nach** `palantir.sh` ein:

```sh
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/dotnet.sh"
```

**`dotnet_vorbereiten`** legt die Orte an, die .NET beschreiben will, und sagt ihm, wo sie liegen.
Das ist nicht Kosmetik: Das Wurzeldateisystem ist schreibgeschützt, und der Benutzer 1000 hat kein
Zuhause. .NET legt trotzdem an — einen Zwischenspeicher für Ein-Datei-Anwendungen, ein Zuhause für
die Werkzeugkette. Ohne diese Variablen landet das zwischen den Spielständen des Betreibers oder es
scheitert mit `Access to the path … is denied`, und beides sieht nicht nach einem Pfadproblem aus.

Nebenbei schaltet sie die Telemetrie ab. Ein Spielserver ruft nicht zu Hause an.

## Fassung erneuern

```bash
curl -s https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json
```

Darin `releases[0].runtime.files[]`, Eintrag `dotnet-runtime-linux-x64.tar.gz`: `url` und `hash`
gehören zusammen und werden gemeinsam getauscht. Dann `VERSION` erhöhen. Die Spiel-Images ziehen
nicht von selbst nach — wer die neue Laufzeit will, setzt dort `BASIS` um.

## Tests

`dotnet.test.mjs` ruft die Bibliothek mit `sh` auf, ohne Docker und ohne .NET. Geprüft wird das
Einzige, was hier schiefgehen kann und dann schwer zu deuten ist: dass die Schreiborte im
Datenordner liegen.
