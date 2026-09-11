#!/bin/sh
#
# Bausteine für Windows-Server unter Proton (`palantir-base-proton`).
#
# Wird vom Startskript eines Spiel-Images eingebunden, **nach** `palantir.sh`
# und `steam.sh`:
#
#   . "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/palantir.sh"
#   . "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/steam.sh"
#   . "${PALANTIR_LIB_DIR:-/opt/palantir/lib}/proton.sh"
#
# Sie setzt auf `steam.sh` auf: Die Serverdateien kommen über dieselbe
# SteamCMD-Kopie, nur in ihrer Windows-Fassung.

PROTON_VERZEICHNIS="${PALANTIR_PROTON_DIR:-/opt/proton}"
# Der Wine-Prefix – ein ganzes Windows-Dateisystem in Miniatur. Er entsteht beim
# ersten Aufruf und bleibt danach liegen; im Datenordner, weil das
# Wurzeldateisystem schreibgeschützt ist und weil er zum Server gehört.
PROTON_PREFIX="${PALANTIR_INTERN}/proton"

# -----------------------------------------------------------------------------
# `proton_vorbereiten`
#
# Legt die Orte an, die Proton beschreiben will, und sagt ihm, wo sie liegen.
# Ohne diese vier Variablen schreibt es in ein Zuhause, das es im Container
# nicht gibt, und scheitert mit einer Meldung über einen Pfad, den niemand
# gesetzt hat.
proton_vorbereiten() {
  # `steam_vorbereiten` setzt HOME und legt die SteamCMD-Kopie an; Proton will
  # beides vorfinden.
  steam_vorbereiten

  mkdir -p "$PROTON_PREFIX"

  # Proton legt unter diesem Pfad `pfx/` an – den eigentlichen Prefix.
  STEAM_COMPAT_DATA_PATH="$PROTON_PREFIX"
  # Proton sucht hier die Steam-Installation. Es reicht ihm, dass der Ordner
  # existiert; die SteamCMD-Kopie ist das, was dem im Container am nächsten
  # kommt.
  STEAM_COMPAT_CLIENT_INSTALL_PATH="$STEAM_HEIM"
  export STEAM_COMPAT_DATA_PATH STEAM_COMPAT_CLIENT_INSTALL_PATH

  # Sonst landen Zwischenspeicher und Shader-Sammlung im Zuhause des Benutzers
  # – und damit zwischen den Spielständen des Betreibers.
  XDG_CACHE_HOME="${PALANTIR_INTERN}/cache"
  mkdir -p "$XDG_CACHE_HOME"
  export XDG_CACHE_HOME

  palantir_log "Proton ${PALANTIR_PROTON_VERSION:-unbekannt} aus ${PROTON_VERZEICHNIS}"
}

# -----------------------------------------------------------------------------
# `proton_app_holen <anwendungsnummer> <zielordner>`
#
# Wie `steam_app_holen`, holt aber die **Windows-Dateien**.
#
# `+@sSteamCmdForcePlatformType windows` muss **vor** `+login` stehen – danach
# gesetzt wirkt es nicht mehr, und SteamCMD lädt wortlos die Linux-Fassung oder
# meldet, es gebe für diese Anwendung nichts. Das ist die Stolperstelle, an der
# jeder einmal hängenbleibt.
proton_app_holen() {
  proton_anwendung="$1"
  proton_ziel="$2"

  steam_vorbereiten
  mkdir -p "$proton_ziel"

  proton_versuch=1

  while [ "$proton_versuch" -le 3 ]; do
    palantir_log "SteamCMD holt Anwendung ${proton_anwendung} (Windows, Versuch ${proton_versuch} von 3) ..."

    if "$STEAM_CMD" +@sSteamCmdForcePlatformType windows \
      +force_install_dir "$proton_ziel" +login anonymous \
      +app_update "$proton_anwendung" +quit; then
      palantir_log "Anwendung ${proton_anwendung} ist auf dem Stand."

      return 0
    fi

    proton_versuch=$((proton_versuch + 1))
  done

  palantir_log "SteamCMD ist dreimal gescheitert; die Anwendung ${proton_anwendung} fehlt."

  return 1
}

# -----------------------------------------------------------------------------
# `proton_lauf <programm> [argumente ...]`
#
# Ruft ein Windows-Programm unter Proton auf. Der Aufrufer hat vorher
# `proton_vorbereiten` gerufen.
#
# **Ohne `exec`**, anders als bei einem Linux-Server: Zwischen dem Signal und
# dem Spielserver stehen hier ohnehin Proton und Wine – ein `exec` änderte daran
# nichts. Wer ein Spiel einbaut, das beim Stoppen selbst speichern muss,
# entscheidet in seinem Startskript, wie es beendet wird.
proton_lauf() {
  "${PROTON_VERZEICHNIS}/proton" run "$@"
}
