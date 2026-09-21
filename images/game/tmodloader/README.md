# Spiel-Image: tModLoader (`palantir-game-tmodloader`)

Terraria mit Mod-Loader. Im Panel steht es als zweite Ausgabe unter der Terraria-Kachel
(`variantGroup: 'Terraria'`); Spieltyp-Kennung ist `tmodloader`.

| Enthalten  | Version                                                   |
| ---------- | --------------------------------------------------------- |
| Grundlage  | `palantir-base-dotnet8:1` (.NET 8.0.31)                   |
| tModLoader | `v2026.07.3.0`, beim ersten Start geholt, SHA-256 geprüft |
| `start.sh` | Einstiegspunkt                                            |

## Warum ein eigenes Image und kein Schalter an `game/terraria`

Bei Minecraft teilen sich vier Ausgaben ein Image, und `MINECRAFT_EDITION` wählt die Jar. Hier
geht das nicht:

|               | Terraria                    | tModLoader        |
| ------------- | --------------------------- | ----------------- |
| Programm      | `TerrariaServer.bin.x86_64` | `tModLoader.dll`  |
| Laufzeit      | keine (nativ)               | .NET 8            |
| Archiv        | 46 MiB von terraria.org     | 61 MiB von GitHub |
| Versionsfolge | Bau `1458`                  | `v2026.07.3.0`    |

Gemeinsam sind die **Welten** (dasselbe Format, derselbe Ordner `welten`), das
`serverconfig.txt` und die Konsole über die Standardeingabe. Deshalb dieselbe Kachel — aber zwei
Images.

## Warum `base/dotnet8` und nicht `base/dotnet`

tModLoader verlangt in seiner `tModLoader.runtimeconfig.json` ausdrücklich
`Microsoft.NETCore.App 8.0.0` und rollt nicht auf 10 vor. Ausführlich steht das in
`images/base/dotnet8/README.md`.

## Was das Startskript anders macht als der Hersteller

Der mitgelieferte `start-tModLoaderServer.sh` wird **nicht** benutzt. Er ist für Menschen an einer
Tastatur geschrieben:

- Er fragt „Use steam server (y/n)" und wartet auf eine Antwort. Hier tippt niemand mit.
- Er braucht `bash`.
- Über `LaunchUtils/InstallDotNet.sh` lädt er sich bei Bedarf eine eigene .NET-Laufzeit in den
  Ordner — gegen ein schreibgeschütztes Wurzeldateisystem, und je Server erneut.

Gestartet wird stattdessen die DLL direkt:

```
dotnet tModLoader.dll -server -config <serverconfig.txt> -tmlsavedirectory <intern> -nosteam
```

## Was sonst noch nötig war

**SDL und FNA bekommen Attrappen.** tModLoader ist dasselbe Programm wie der Client, nur mit
`-server`; es lädt SDL2, FNA3D und FAudio auch dann, wenn es nichts zu zeichnen gibt.
`SDL_VIDEODRIVER=dummy`, `SDL_AUDIODRIVER=dummy` und `FNA3D_FORCE_DRIVER=null` geben ihm Treiber,
die nichts tun, statt es nach einem Bildschirm suchen zu lassen. Wer etwas anderes braucht, kann
alle drei setzen — das Skript überschreibt sie nicht.

**Die nativen Bibliotheken liegen im Programmordner**, nicht auf dem Systempfad. `LD_LIBRARY_PATH`
zeigt deshalb auf `Libraries/Native/Linux`.

**`-tmlsavedirectory` zeigt in den Datenordner.** Ohne die Angabe legt tModLoader Logs,
Mod-Zwischenspeicher und `enabled.json` unter `~/.local/share` ab — außerhalb des Datenordners und
damit außerhalb jeder Sicherung.

**Mods** gehören in `mods/` im Datenordner (`modpath` in der `serverconfig.txt`). Den Ordner legt
das Startskript an, damit der Betreiber ihn vorfindet.

## Von Hand prüfen

```bash
docker run --rm -it \
  -e EULA=true -e TERRARIA_WORLD=Test \
  -v "$PWD/daten:/data" \
  ghcr.io/nightriderp/palantir-game-tmodloader:1
```

## Tests

`start.test.mjs` ruft `start.sh` mit `sh` auf, ohne Docker und ohne .NET. Statt der Laufzeit steht
ein `dotnet` im PATH, das seine Argumente, das Arbeitsverzeichnis und die gesetzten Umgebungs-
variablen aufschreibt. Geprüft werden die verwalteten Schlüssel, der Mod-Ordner, die Übersetzung
von Weltgröße und Spielart, der Aufruf samt `-nosteam` und `-tmlsavedirectory` — und das
Stoppsignal: tModLoader speichert bei SIGTERM nicht, das Skript schickt `exit` in die Konsole.

## Was noch aussteht

**Dieses Image ist nie gelaufen.** Die Rauchprobe prüft beim Bau die Laufzeit, nicht das Spiel. Ob
der Server mit den SDL-Attrappen wirklich hochkommt, ob `libnfd_gtk.so` GTK-Pakete nachzieht, die
im Image fehlen, und wie lange der erste Start dauert — das zeigt erst ein Start auf der Node.
