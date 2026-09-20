#!/bin/sh
#
# Gemeinsame Bausteine für .NET-Spiel-Images (`palantir-base-dotnet`).
#
# Wird vom Startskript eines Spiel-Images eingebunden, nicht ausgeführt,
# **nach** `palantir.sh`:
#
#   . "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
#   . "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/dotnet.sh"
#
# Variablen, die eine Funktion nach außen gibt, tragen das Präfix `DOTNET_`;
# alles Innere das Präfix `dotnet_` – POSIX-Shell kennt kein `local`.
#
# Geprüft ohne Docker und ohne .NET durch `dotnet.test.mjs` daneben.

# -----------------------------------------------------------------------------
# `dotnet_vorbereiten`
#
# Legt die Orte an, die .NET beschreiben will, und sagt ihm, wo sie liegen.
#
# **Warum das nötig ist:** Das Wurzeldateisystem ist schreibgeschützt
# (`readOnlyRootFilesystem`), und der Benutzer 1000 hat kein Zuhause – `HOME`
# zeigt auf `/data`. .NET legt aber ungefragt an: einen Zwischenspeicher für
# Ein-Datei-Anwendungen, einen für Fassungsprüfungen, einen für den Übersetzer.
# Ohne diese Variablen landet das entweder zwischen den Spielständen des
# Betreibers oder es scheitert mit „Access to the path … is denied" – und
# beides sieht nicht nach einem Pfadproblem aus.
dotnet_vorbereiten() {
  # Der Ordner, in den `palantir_intern_anlegen` schon alles Interne legt.
  DOTNET_ZWISCHENSPEICHER="${PALANTIR_INTERN}/dotnet"
  mkdir -p "$DOTNET_ZWISCHENSPEICHER"

  # Ein-Datei-Anwendungen packen sich beim Start selbst aus; ohne diesen Ort
  # versuchen sie es unter `/tmp/.net` und scheitern, sobald `/tmp` klein ist.
  DOTNET_BUNDLE_EXTRACT_BASE_DIR="${DOTNET_ZWISCHENSPEICHER}/bundle"
  # Das „Zuhause" der Werkzeugkette. Zeigt es ins Wurzeldateisystem, bricht der
  # erste Schreibversuch den Start ab.
  DOTNET_CLI_HOME="$DOTNET_ZWISCHENSPEICHER"
  # Kein Aufruf nach Hause aus einem Spielserver heraus.
  DOTNET_CLI_TELEMETRY_OPTOUT=1
  DOTNET_NOLOGO=1
  # Der Server wird nicht neu übersetzt; ein Blick ins Netz nach einer neueren
  # Fassung ist reine Verzögerung beim Start.
  DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1

  mkdir -p "$DOTNET_BUNDLE_EXTRACT_BASE_DIR"

  export DOTNET_BUNDLE_EXTRACT_BASE_DIR DOTNET_CLI_HOME DOTNET_CLI_TELEMETRY_OPTOUT
  export DOTNET_NOLOGO DOTNET_SKIP_FIRST_TIME_EXPERIENCE

  palantir_log ".NET ${PALANTIR_DOTNET_VERSION:-unbekannt}"
}
