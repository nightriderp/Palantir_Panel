#!/bin/sh
#
# Rauchprobe, die für JEDES Palantir-Image gilt.
#
# Sie startet das frisch gebaute Image unter denselben Bedingungen, unter denen
# der Agent es später startet – als 1000, mit schreibgeschütztem Wurzeldateisystem,
# ohne Capabilities, ohne Netz – und prüft die Zusagen aus `images/README.md`.
#
# **Warum es das gibt.** Bis hierher hat nie etwas ein gebautes Image gestartet:
# `spiel-image-bauen.yml` baute und lud hoch, `image-scan.yml` liess Trivy über
# das Dateisystem laufen, die `*.test.mjs` prüfen Startskripte mit Node ohne
# Docker. Ein Image, dessen Laufzeit beim ersten Aufruf abbricht, kam durch jede
# dieser Prüfungen. Genau das ist am 2026-09-11 passiert: `python3-minimal`
# brachte den Interpreter ohne Standardbibliothek mit, `proton` scheiterte in
# Zeile 10 an `import shutil` – und alle sechs Proton-Images hatten seit Tagen
# fehlerfrei gebaut, ohne dass eines je gelaufen wäre.
#
# Die Probe läuft OHNE Netz (`--network none`). Das ist Absicht und keine
# Sparmassnahme: Eine Probe, die etwas herunterlädt, prüft die Verbindung des
# Runners mit; eine, die es nicht kann, prüft das Image.
#
# Ein Image kann daneben eine eigene `rauchprobe.sh` in seinem Ordner haben.
# Die läuft zusätzlich, unter denselben Bedingungen.

set -eu

fehler=0

melde() {
  echo "  $1"
}

scheitert() {
  echo "FEHLER: $1" >&2
  fehler=1
}

# --- Wer bin ich -----------------------------------------------------------
# UID 1000 steht fest im Dockerfile, weil der Datenordner auf der Node ihr
# gehört und der Agent ihn niemandem verschenken kann (Fundpunkt 117).
uid="$(id -u)"
gid="$(id -g)"

if [ "${uid}" = '0' ]; then
  scheitert "läuft als root. Jedes Palantir-Image endet mit USER 1000:1000."
else
  melde "Benutzer: ${uid}:${gid}"
fi

# --- Der Datenordner -------------------------------------------------------
# Der einzige dauerhaft beschreibbare Ort. Er ist zugleich WORKDIR.
if [ "$(pwd)" != '/data' ]; then
  scheitert "Arbeitsverzeichnis ist $(pwd), erwartet wird /data (WORKDIR)."
fi

if ! touch /data/.rauchprobe 2>/dev/null; then
  scheitert "/data ist nicht beschreibbar – der Datenordner ist der einzige Ort, an dem ein Server etwas ablegen kann."
else
  rm -f /data/.rauchprobe
  melde "/data ist beschreibbar"
fi

# --- Das Wurzeldateisystem ist schreibgeschützt ----------------------------
# Nicht das Image entscheidet das, sondern der Agent (`readOnlyRootFilesystem`).
# Die Probe fährt es trotzdem so: Ein Image, das beim Start irgendwo ausserhalb
# von /data schreiben will, soll hier auffallen und nicht auf der Node.
if touch /rauchprobe 2>/dev/null; then
  rm -f /rauchprobe
  scheitert "/ ist beschreibbar – die Probe lief ohne --read-only, das ist ein Fehler im Workflow."
else
  melde "/ ist schreibgeschützt"
fi

# /tmp ist der eine beschreibbare Ort daneben (tmpfs), weil eine JVM ohne
# weiteres Zutun dort landet.
if ! touch /tmp/.rauchprobe 2>/dev/null; then
  scheitert "/tmp ist nicht beschreibbar."
else
  rm -f /tmp/.rauchprobe
  melde "/tmp ist beschreibbar"
fi

# --- Die Konsole -----------------------------------------------------------
# `EXEC_CONSOLE` startet `palantir-console` OHNE Shell: Der Docker-Aufruf
# übergibt eine Argumentliste, kein Kommandozeilen-Fragment. Fehlt das
# Ausführungsrecht oder die Shebang-Zeile, fällt das erst auf der Node auf –
# und zwar dem Betreiber, der gerade `stop` tippt.
if [ ! -x /usr/local/bin/palantir-console ]; then
  scheitert "/usr/local/bin/palantir-console fehlt oder ist nicht ausführbar."
else
  melde "palantir-console ist ausführbar"
fi

# --- Die gemeinsame Bibliothek ---------------------------------------------
if [ ! -r /opt/palantir/lib/palantir.sh ]; then
  scheitert "/opt/palantir/lib/palantir.sh fehlt – jedes Startskript liest sie ein."
else
  # Mit der Shell des Images, nicht mit der des Runners: Die Bibliothek wird
  # später von genau dieser gelesen.
  if ! sh -n /opt/palantir/lib/palantir.sh; then
    scheitert "/opt/palantir/lib/palantir.sh ist syntaktisch kaputt."
  else
    melde "palantir.sh ist lesbar und syntaktisch heil"
  fi
fi

# --- Werkzeuge, auf die Startskripte bauen ---------------------------------
for werkzeug in curl unzip xz; do
  if ! command -v "${werkzeug}" >/dev/null 2>&1; then
    scheitert "${werkzeug} fehlt – base/linux bringt es mit, hier ist es weg."
  fi
done
melde "curl, unzip, xz sind da"

# --- Der Einstiegspunkt eines Spiel-Images ---------------------------------
# Basis-Images haben bewusst keinen (images/README.md). Ein Spiel-Image hat
# genau einen, und er muss ausführbar sein und mit der Shell des Images
# durchgehen. Das startet den Server nicht – es lädt nichts herunter und
# erzeugt keine Welt.
if [ -f /opt/palantir/start.sh ]; then
  if [ ! -x /opt/palantir/start.sh ]; then
    scheitert "/opt/palantir/start.sh ist nicht ausführbar."
  elif ! sh -n /opt/palantir/start.sh; then
    scheitert "/opt/palantir/start.sh ist syntaktisch kaputt."
  else
    melde "start.sh ist ausführbar und syntaktisch heil"
  fi
fi

exit "${fehler}"
