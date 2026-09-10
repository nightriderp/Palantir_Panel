# Basis-Image: Steam (`palantir-base-steam`)

Die Grundlage für Spiele, deren Server über SteamCMD kommen — mit Abstand die größte Gruppe aus
Anhang A des Lastenhefts. Kein Spiel; das Image hat keinen `ENTRYPOINT`. Das Schema aller Images
steht in `images/README.md`.

| Enthalten                    | Fassung                                                    |
| ---------------------------- | ---------------------------------------------------------- |
| Grundlage                    | `palantir-base-linux` — Benutzer, `/data`, Konsole, `curl` |
| SteamCMD                     | Paket von Valve, per SHA-256 gepinnt                       |
| 32-Bit-Bibliotheken          | `lib32gcc-s1`, `lib32stdc++6`                              |
| `/opt/palantir/lib/steam.sh` | Vorbereiten und Holen einer Anwendung                      |

**Warum die 32-Bit-Bibliotheken.** SteamCMD selbst ist ein 32-Bit-Programm, auch wenn die Server,
die es holt, 64-Bit sind. Ohne sie startet es mit „No such file or directory", obwohl die Datei da
ist. Dieselben Bibliotheken brauchen später die alten Source-Spiele.

## Die Bibliothek

Ein Startskript bindet sie **nach** `palantir.sh` ein:

```sh
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
. "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/steam.sh"
```

**`steam_vorbereiten`** kopiert SteamCMD aus dem Image in den Datenordner und setzt `HOME`
dorthin. Beides ist nötig: SteamCMD aktualisiert sich beim ersten Aufruf selbst und schreibt dabei
in sein eigenes Verzeichnis — im schreibgeschützten Wurzeldateisystem schlüge das fehl. Und ohne
`HOME` landete sein Zwischenspeicher zwischen den Spielständen des Betreibers.

**`steam_app_holen <anwendungsnummer> <zielordner>`** holt oder aktualisiert die Serverdateien.
Drei Entscheidungen stecken darin:

- **Bei jedem Start**, nicht nur beim ersten. Ist alles auf dem Stand, kostet der Aufruf Sekunden;
  ist es das nicht, kommt die neue Spielfassung, ohne dass jemand ein Image bauen muss.
- **Ohne `validate`.** Das prüfte jede Datei gegen den Stand von Valve und ersetzte Abweichungen —
  und räumte damit die Mods des Betreibers weg, die bei vielen dieser Spiele genau dort liegen. Wer
  eine kaputte Installation geradeziehen will, löscht den Ordner; der nächste Start holt sie neu.
- **Dreimal versuchen.** SteamCMD bricht regelmäßig mit einem Verbindungsfehler ab, der beim
  nächsten Versuch weg ist.

## Ein Spiel-Image darauf

```dockerfile
ARG BASIS=ghcr.io/nightriderp/palantir-base-steam:1
FROM ${BASIS}

USER root
COPY start.sh /opt/palantir/
RUN chmod 0755 /opt/palantir/start.sh
USER 1000:1000

ENTRYPOINT ["/opt/palantir/start.sh"]
```

`images/game/valheim` ist das erste und dient als Vorlage: Serverdateien und Spielstände getrennt,
Prüfung der Spielregeln vor dem Start, `exec` auf den Server.

## SteamCMD erneuern

Dependabot hält hier nichts nach: Das `FROM` zeigt auf ein Tag der eigenen Registry, und SteamCMD
hängt an einer Prüfsumme. Valve veröffentlicht das Paket unter einer festen Adresse und tauscht den
Inhalt aus — der Bau bricht dann mit „Prüfsumme passt nicht" ab. Das ist die Absicht.

```bash
curl -sL https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz | sha256sum
```

Die neue Summe nach `STEAMCMD_SHA256` im Dockerfile, dann `VERSION` erhöhen.

## Tests

`steam.test.mjs` ruft die Bibliothek mit `sh` auf, ohne Docker und ohne Steam. Statt SteamCMD steht
ein Skript in der Vorlage, das seine Argumente aufschreibt. Geprüft wird, was die Bibliothek
entscheidet: dass die Kopie im Datenordner landet und liegen bleibt, mit welchen Argumenten
SteamCMD aufgerufen wird, und dass ein Fehlschlag dreimal wiederholt wird.
