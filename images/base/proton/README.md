# Basis-Image: Proton (`palantir-base-proton`)

Die Grundlage für Spielserver, die es **nur als Windows-Programm** gibt — die halbe Liste aus
Anhang A des Lastenhefts: Enshrouded, V Rising, Sons of the Forest, ARK: Survival Ascended. Kein
Spiel; das Image hat keinen `ENTRYPOINT`.

| Enthalten                     | Fassung                                                 |
| ----------------------------- | ------------------------------------------------------- |
| Grundlage                     | `palantir-base-steam:2` (darunter `base/linux:2`)       |
| Proton                        | GE-Proton11-6, im Image, per SHA-256 gepinnt            |
| Python 3                      | `proton` ist ein Python-Skript                          |
| Wine-Bibliotheken             | 64 und 32 Bit, auf einen Server ohne Bildschirm gekürzt |
| `/opt/palantir/lib/proton.sh` | Windows-Dateien holen, Orte setzen, Programm aufrufen   |

## Drei Entscheidungen

**Warum auf `base/steam`.** Die Serverdateien kommen bei diesen Spielen genauso über SteamCMD — nur
als Windows-Fassung. Eine eigene Wurzel daneben hieße, SteamCMD ein zweites Mal einzubauen.

**Warum GE-Proton und nicht Valves Proton.** Valves Proton kommt über den Steam-Client und läuft in
dessen Laufzeitumgebung; GE-Proton wird als vollständiges Archiv veröffentlicht, das sich auspacken
und aufrufen lässt. Dieselbe Grundlage (Wine), nur mit Korrekturen, die Valve noch nicht übernommen
hat — und das, was für Server tatsächlich eingesetzt wird.

**Warum Proton im Image liegt.** Es ist eine Laufzeit, keine Serverdatei: Es gehört zum Bauplan wie
die JRE in `base/java`. Im Datenordner läge es einmal je Server — 1,5 GiB, die sich nie
unterscheiden.

## Die Bibliothek

Ein Startskript bindet sie **nach** `palantir.sh` und `steam.sh` ein:

```sh
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/steam.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/proton.sh"
```

**`proton_app_holen <anwendung> <ziel>`** holt die **Windows**-Dateien. Der Unterschied zu
`steam_app_holen` ist eine einzige Angabe — und die Stolperstelle, an der jeder einmal
hängenbleibt:

```
+@sSteamCmdForcePlatformType windows   …muss VOR +login stehen
```

Danach gesetzt wirkt sie nicht mehr: SteamCMD lädt wortlos die Linux-Fassung oder meldet, es gebe
für diese Anwendung nichts.

**`proton_vorbereiten`** legt die Orte an, die Proton beschreiben will, und sagt ihm, wo sie liegen:
`STEAM_COMPAT_DATA_PATH` (der Wine-Prefix, `/data/.palantir/proton`),
`STEAM_COMPAT_CLIENT_INSTALL_PATH` (die SteamCMD-Kopie) und `XDG_CACHE_HOME`. Ohne diese Variablen
schreibt Proton in ein Zuhause, das es im Container nicht gibt, und scheitert mit einer Meldung über
einen Pfad, den niemand gesetzt hat.

**`proton_lauf <programm> [argumente]`** ruft ein Windows-Programm über `proton run` auf.

## Pfade im Prefix

Proton sieht das Linux-Dateisystem als Laufwerk `Z:`. Ein Spiel, dem man einen Ordner in seiner
Konfiguration nennt, braucht deshalb einen Windows-Pfad:

```
/data/welten   →   Z:\data\welten
```

Das gehört ins Startskript des Spiels, nicht hierher: Ob und wo ein Spiel Pfade entgegennimmt, weiß
nur das Spiel.

## Die Bibliotheksliste ist eine Vermutung

Die installierten Wine-Abhängigkeiten sind auf einen Server **ohne Bildschirm** zugeschnitten; was
nur Grafik und Ton braucht, fehlt bewusst. Ob die Auswahl für ein bestimmtes Spiel reicht, zeigt
erst der erste echte Lauf — Wine nennt eine fehlende Bibliothek im Log beim Namen. Dann gehört sie
ins Dockerfile und die Fassung steigt.

Das ist der ehrlichste Stand, den dieses Image ohne Node haben kann.

## Fassung erneuern

```bash
curl -s https://api.github.com/repos/GloriousEggroll/proton-ge-custom/releases/latest | grep -o 'GE-Proton[0-9-]*'
curl -sL <url> | sha256sum
```

Dann die drei `ARG`-Werte im Dockerfile tauschen und `VERSION` erhöhen. Die Spiel-Images ziehen
nicht von selbst nach — wer die neue Proton-Fassung will, setzt dort `BASIS` um.

## Tests

`proton.test.mjs` ruft die Bibliothek mit `sh` auf, ohne Docker, ohne Steam und ohne Proton. Statt
der beiden Programme stehen Attrappen bereit, die ihre Argumente aufschreiben. Geprüft wird die
Reihenfolge von `+@sSteamCmdForcePlatformType` und `+login`, dass Prefix und Zwischenspeicher im
Datenordner landen, dass die Fassung im Log steht — und dass ein Programm über `proton run`
aufgerufen wird.

Ob ein Windows-Server darunter wirklich läuft, zeigt erst ein Lauf auf der Node.
