#!/bin/sh
#
# Rauchprobe für `base/proton10`. Läuft nach der Standardprobe, im frisch gebauten
# Image, als 1000, ohne Netz (siehe `.github/rauchprobe-standard.sh`).
#
# **Das ist die Probe, für die es die Rauchprobe gibt.** Am 2026-09-11 endete
# der erste echte Proton-Start auf der Node so:
#
#     File "/opt/proton/proton", line 10, in <module>
#       import shutil
#     ModuleNotFoundError: No module named 'shutil'
#
# `python3-minimal` bringt den Interpreter mit, aber nicht seine
# Standardbibliothek. Gebaut hatten die Images seit Tagen fehlerfrei; gelaufen
# war keines. Geprüft wird deshalb nicht „ist python3 da", sondern: lässt sich
# jedes Modul importieren, das `proton` selbst importiert. Die Liste kommt aus
# der Datei, nicht aus diesem Skript – eine neue Proton-Fassung mit einem
# weiteren Import ist damit mitgeprüft, ohne dass jemand hier nachträgt.

set -eu

if [ ! -x /opt/proton/proton ]; then
  echo "FEHLER: /opt/proton/proton fehlt oder ist nicht ausführbar." >&2
  exit 1
fi

if ! python3 - <<'PY'
import ast
import importlib.util
import os
import sys

pfad = '/opt/proton/proton'

# **Der Ordner des Skripts gehört an den Anfang des Suchpfads.** Genau das tut
# CPython, wenn ein Skript aufgerufen wird - und so ruft das Image Proton auch
# auf (`proton_lauf()` in `proton.sh`: `/opt/proton/proton run …`). Ohne diese
# Zeile fehlten `filelock`, `protonfixes` und `utilities`: alles Dateien, die
# neben `proton` liegen und beim echten Aufruf gefunden werden. Der erste Lauf
# dieser Probe hat sie prompt als fehlend gemeldet.
sys.path.insert(0, os.path.dirname(pfad))

with open(pfad, encoding='utf-8') as datei:
    baum = ast.parse(datei.read(), filename=pfad)

# Nur die Importe auf oberster Ebene: Was in einer Funktion steht, läuft
# vielleicht nie, und ein Import in einem try/except ist als optional gemeint.
module = set()
for knoten in baum.body:
    if isinstance(knoten, ast.Import):
        module.update(alias.name.split('.')[0] for alias in knoten.names)
    elif isinstance(knoten, ast.ImportFrom) and knoten.level == 0 and knoten.module:
        module.add(knoten.module.split('.')[0])

# `find_spec` statt `import_module`: Gefragt ist, ob das Modul da ist - das war
# der Fehler vom 2026-09-11. Es wirklich zu importieren führte fremden Code aus
# (`protonfixes/__init__.py`), der beim Laden nach einer Umgebung verlangen
# kann, die es hier nicht gibt. Die Probe würde dann etwas melden, das mit der
# Frage nichts zu tun hat.
fehlend = []
for name in sorted(module):
    try:
        if importlib.util.find_spec(name) is None:
            fehlend.append(name)
    except (ImportError, ValueError):
        fehlend.append(name)

if fehlend:
    print('FEHLER: proton importiert Module, die es hier nicht gibt: ' + ', '.join(fehlend),
          file=sys.stderr)
    print('Die Standardbibliothek fehlt (python3-minimal statt python3)?', file=sys.stderr)
    raise SystemExit(1)

print('  proton: %d Module auf oberster Ebene, alle auffindbar' % len(module))
print('  python %s' % sys.version.split()[0])
PY
then
  exit 1
fi

# Der Bildschirm, den es nicht gibt: Windows-Server unter Proton wollen einen
# X-Server vorfinden, auch wenn sie nichts zeichnen. Xvfb liefert ihn.
if ! command -v Xvfb >/dev/null 2>&1; then
  echo "FEHLER: Xvfb fehlt – Windows-Server unter Proton brauchen einen Bildschirm." >&2
  exit 1
fi

# 32-Bit-Bibliotheken: Die halbe Proton-Liste ist i386. Fehlt die Architektur,
# meldet der Loader das erst, wenn ein Spiel startet.
if [ ! -d /usr/lib/i386-linux-gnu ]; then
  echo "FEHLER: /usr/lib/i386-linux-gnu fehlt – die i386-Architektur ist nicht eingerichtet." >&2
  exit 1
fi

echo "  Xvfb und die i386-Bibliotheken sind da"
