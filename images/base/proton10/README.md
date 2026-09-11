# Basis-Image: Proton 10 (`palantir-base-proton10`)

Dasselbe wie [`base/proton`](../proton/README.md), nur mit der **älteren Proton-Reihe**. Kein
Spiel; das Image hat keinen `ENTRYPOINT`.

| Enthalten                 | Fassung                                             |
| ------------------------- | --------------------------------------------------- |
| Grundlage                 | `palantir-base-steam:2`                             |
| Proton                    | **GE-Proton10-34**, im Image, per SHA-256 gepinnt   |
| Bibliothek                | `proton.sh` aus `palantir-base-proton:2` — dieselbe |
| Python 3, Xvfb, Wine-Libs | wie in `base/proton`                                |

## Warum es Proton zweimal gibt

**GE-Proton 11 kann ARK: Survival Ascended nicht.** Der Serverprozess bleibt beim Start hängen —
ohne Meldung, ohne Ende, ohne Absturz. Der Linux-ASA-Server-Manager pinnt deshalb ausdrücklich auf
die 10er-Reihe, und dasselbe Setup läuft dort.

`base/proton` (GE-Proton11-6) bleibt, wie es ist: Enshrouded, V Rising, Sons of the Forest und
Abiotic Factor stehen darauf. Dieses Image ist die ältere Laufzeit **daneben**, so wie `base/java21`
neben `base/java` stünde — nicht ihr Nachfolger.

Das kostet: Zwei Proton-Fassungen wollen zweimal gepflegt werden, und jede Korrektur an der
Wine-Umgebung ist zweimal zu bedenken. Die Entscheidung dafür hat der Betreiber am 2026-09-11
getroffen; die Alternative wäre gewesen, ARK draußen zu lassen.

## Die Bibliothek wird nicht abgeschrieben

`proton.sh` kommt über eine Bau-Stufe aus `palantir-base-proton:2` ins Image — **dieselbe Datei**,
nicht eine Kopie im Repository, die auseinander driftet. Sie ist ohnehin fassungsblind: Wo Proton
liegt und wie es heißt, steht in `PALANTIR_PROTON_DIR` und `PALANTIR_PROTON_VERSION`.

Ein Bau setzt deshalb voraus, dass `palantir-base-proton:2` in der Registry liegt. Das tut es seit
dem 2026-09-11. Wichtig dabei: Die Basis-Images baut eine parallele Matrix — hier darf nie auf eine
Fassung gezeigt werden, die im selben Lauf erst entstehen soll.

## Woran man sieht, welche Reihe läuft

Am Log. `proton_vorbereiten` schreibt die Fassung in die erste Zeile:

```
Proton GE-Proton10-34 aus /opt/proton
```

Wer ein Verhalten meldet, liefert diese Zeile mit.

## Fassung erneuern

```bash
curl -s https://api.github.com/repos/GloriousEggroll/proton-ge-custom/releases \
  | grep -o 'GE-Proton10-[0-9]*' | head -1
curl -sL <url> | sha256sum
```

**Nicht auf die 11er-Reihe wechseln** — dafür gibt es dieses Image. Dann die drei `ARG`-Werte im
Dockerfile tauschen und `VERSION` erhöhen. Die Spiel-Images ziehen nicht von selbst nach.

## Tests

Keine eigenen. Die Bibliothek ist dieselbe wie in `base/proton` und wird dort geprüft
(`proton.test.mjs`) — ein zweiter Testlauf über dieselbe Datei sagte nichts Neues.
