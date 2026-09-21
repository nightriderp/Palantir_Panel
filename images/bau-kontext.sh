#!/usr/bin/env bash
#
# Abdruck des Bau-Kontexts eines Image-Ordners.
#
# Beantwortet die eine Frage, an der zwei Läufe hängen: **Hat sich das Image
# geändert?** Ausgegeben wird ein SHA-256 über die Dateien, die tatsächlich ins
# Image gehen – Blob-Hash und Name, relativ zum Ordner. Zwei Stände mit
# demselben Abdruck ergeben dasselbe Image.
#
# Aufruf: bau-kontext.sh <ref> <ordner>
#   ref     Commit-artige Angabe (SHA, Branch, `HEAD`)
#   ordner  Pfad des Image-Ordners, z. B. `images/base/java`
#
# **Warum diese Datei getrennt steht.** Die Regel wird an zwei Stellen
# gebraucht:
#
#   * `game-images.yml` entscheidet damit, welche Images neu gebaut werden.
#   * `images-version.yml` prüft damit im Pull Request, ob zu einer Änderung am
#     Image auch eine neue `VERSION` gehört.
#
# Stünde sie zweimal da, liefen die beiden Listen irgendwann auseinander – und
# zwar unbemerkt in die gefährliche Richtung: Fällt im Bau eine Ausnahme weg,
# ohne dass die Prüfung es erfährt, lässt die Prüfung eine fehlende
# `VERSION`-Erhöhung durch, und der Bau bricht erst auf `main` ab. Genau dieser
# Fall ist am 21.09.2026 eingetreten (PR #626: Dependabot hob einen Digest, die
# `VERSION` blieb stehen).
#
# **Was nicht zum Kontext zählt** und deshalb keine `VERSION`-Erhöhung erzwingt:
#
#   * `README.md`, `VERSION`, `package.json` und `*.test.mjs` – jedes
#     `.dockerignore` hält sie heraus (images/README.md).
#   * `rauchprobe.sh` – sie wird von keinem `COPY` angefasst, landet nie im
#     Image, sondern wird nach dem Bau von aussen hineingehängt. Zählte sie
#     mit, zwänge eine geänderte Probe zu einer neuen Fassung eines Images, das
#     sich nicht geändert hat.
#
# Verglichen wird bewusst der Abdruck und nicht die Liste geänderter Dateien:
# Ein Ordner, der nur verschoben wurde, hat denselben Abdruck wie vorher – egal,
# wie git die Umbenennung im Diff darstellt.

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Aufruf: $0 <ref> <ordner>" >&2
  exit 2
fi

ref="$1"
ordner="$2"

git ls-tree -r "${ref}" -- "${ordner}/" |
  awk -v wurzel="${ordner}/" '{ pfad = $4; sub("^" wurzel, "", pfad); print $3, pfad }' |
  { grep -v -E ' (README\.md|VERSION|package\.json|rauchprobe\.sh|[^ ]*\.test\.mjs)$' || true; } |
  sort | sha256sum | cut -d' ' -f1
