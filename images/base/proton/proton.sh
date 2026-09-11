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

# -----------------------------------------------------------------------------
# `proton_bildschirm_starten`
#
# Startet einen Bildschirm, den es nicht gibt.
#
# Ein Server hat keine Grafikkarte und niemand sieht ihm zu – trotzdem
# verlangen die Spiele auf Unity-Grundlage (V Rising, Sons of the Forest) unter
# Wine eine X11-Verbindung und beenden sich sonst gleich nach dem Start. Xvfb
# ist ein X-Server, der sein Bild in den Arbeitsspeicher zeichnet und
# wegwirft; er kostet ein paar Megabyte und löst genau dieses Problem.
#
# **Nicht jedes Spiel braucht das.** Enshrouded ist ein gewöhnliches
# Windows-Konsolenprogramm und läuft ohne. Deshalb startet der Bildschirm nicht
# von selbst, sondern nur, wenn ein Startskript ihn ruft.
proton_bildschirm_starten() {
  proton_anzeige="${PALANTIR_PROTON_DISPLAY:-:1}"
  proton_sockel="${PALANTIR_X11_SOCKET_DIR:-/tmp/.X11-unix}/X${proton_anzeige#:}"

  if ! command -v Xvfb >/dev/null 2>&1; then
    palantir_log 'Xvfb fehlt im Image – der Server bekommt keinen Bildschirm.'

    return 1
  fi

  Xvfb "$proton_anzeige" -screen 0 1024x768x24 -nolisten tcp &
  PROTON_BILDSCHIRM_PID=$!

  DISPLAY="$proton_anzeige"
  export DISPLAY PROTON_BILDSCHIRM_PID

  # Xvfb braucht einen Augenblick, bis es Verbindungen annimmt. Startete das
  # Spiel vorher, scheiterte es an einem Bildschirm, der gleich danach da
  # gewesen wäre – ein Fehler, der sich je nach Auslastung der Node anders
  # verhält und deshalb schwer zu deuten ist.
  proton_wartezeit=0

  while [ ! -e "$proton_sockel" ]; do
    if [ "$proton_wartezeit" -ge 100 ]; then
      palantir_log "Xvfb hat nach 10 Sekunden keinen Anschluss geöffnet (${proton_sockel})."

      return 1
    fi

    sleep 0.1
    proton_wartezeit=$((proton_wartezeit + 1))
  done

  palantir_log "Bildschirm ${proton_anzeige} steht (Xvfb, ${PROTON_BILDSCHIRM_PID})."
}
