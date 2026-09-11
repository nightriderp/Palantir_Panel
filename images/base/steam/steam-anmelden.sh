#!/bin/sh
#
# Einmalige Anmeldung an einem Steam-Konto (`palantir-steam-anmelden`).
#
# Ein paar Spiele geben ihren dedizierten Server nicht anonym heraus – Assetto
# Corsa Competizione endet mit „No subscription". Für sie braucht SteamCMD ein
# Konto, das das Spiel besitzt. Dieses Skript nimmt dem Betreiber die drei
# Feinheiten ab, an denen der Aufruf von Hand scheitert:
#
#   1. **SteamCMD muss schreiben dürfen.** Es aktualisiert sich beim Start
#      selbst, und zwar in sein eigenes Verzeichnis. `/opt/steamcmd` gehört
#      `root`, gelaufen wird als Benutzer 1000 – der Aufruf dort scheitert, und
#      SteamCMD meldet das als „Steamcmd needs to be online to update", was in
#      die Irre führt. Gearbeitet wird deshalb in einer Kopie.
#   2. **`HOME` muss stimmen**, sonst legt SteamCMD seinen Token irgendwohin.
#   3. **Der Token muss dort landen, wo die Spiel-Images ihn suchen**
#      (`steam_konto_uebernehmen`).
#
# Aufruf auf der Gamenode:
#
#   docker run -it --rm -v /srv/palantir/steam-konto:/konto \
#     ghcr.io/nightriderp/palantir-base-steam:6 palantir-steam-anmelden NAME
#
# Passwort und Steam-Guard-Code fragt SteamCMD dort ab – sie gehen nie durch das
# Panel und stehen nirgendwo in einer Datei.

set -eu

if [ $# -lt 1 ]; then
  echo 'Aufruf: palantir-steam-anmelden <steam-benutzername>' >&2
  echo '' >&2
  echo 'Der Anmeldename, mit dem du dich bei Steam einloggst –' >&2
  echo 'nicht der Anzeigename aus dem Profil.' >&2
  exit 64
fi

BENUTZER="$1"
KONTO="${PALANTIR_STEAM_KONTO_DIR:-/konto}"
VORLAGE="${PALANTIR_STEAMCMD_DIR:-/opt/steamcmd}"

if [ ! -d "$KONTO" ]; then
  echo "Der Ordner ${KONTO} ist nicht eingehängt." >&2
  echo '' >&2
  echo 'Erwartet wird er als Einhängung, damit der Token die Laufzeit des' >&2
  echo 'Containers überlebt:' >&2
  echo '' >&2
  echo "  docker run -it --rm -v /srv/palantir/steam-konto:${KONTO} ..." >&2
  exit 66
fi

if [ ! -w "$KONTO" ]; then
  echo "In ${KONTO} darf dieser Container nicht schreiben." >&2
  echo '' >&2
  echo 'Auf der Node einmal den Besitzer setzen – 1000 ist der Benutzer, unter' >&2
  echo 'dem die Spielcontainer laufen:' >&2
  echo '' >&2
  echo '  chown -R 1000:1000 /srv/palantir/steam-konto' >&2
  exit 77
fi

# --- Der Ablageort, und zwar VOR der Anmeldung -------------------------------
#
# **Warum hier und nicht am Ende**: Am Ende hat der Betreiber sein Passwort
# eingegeben und die Anmeldung in der Steam-App bestätigt – und *dann* zu
# erfahren, dass eine Datei nicht geschrieben werden darf, heißt: alles noch
# einmal. Genau so ist es am 2026-09-11 passiert.
#
# Der häufige Fall ist ein Überbleibsel: Wer den Container einmal als `root`
# laufen ließ, hat `Steam/` dort als `root` angelegt. Der Mount selbst gehört
# dann dem Benutzer 1000, der Unterordner nicht – die Prüfung oben geht durch,
# das Kopieren später nicht.
ZIEL="${KONTO}/Steam/config"

if ! mkdir -p "$ZIEL" 2> /dev/null || [ ! -w "$ZIEL" ]; then
  echo "In ${ZIEL} darf dieser Container nicht schreiben." >&2
  echo '' >&2
  echo 'Das kommt von einem früheren Lauf als „root" – der Unterordner gehört' >&2
  echo 'dann ihm. Auf der Node einmal:' >&2
  echo '' >&2
  echo '  chown -R 1000:1000 /srv/palantir/steam-konto' >&2
  echo '' >&2
  echo 'Danach diesen Befehl noch einmal. (Die Anmeldung ist bis hierher' >&2
  echo 'nicht passiert – es gibt nichts zu verlieren.)' >&2
  exit 77
fi

# --- 1. Eine Kopie, in der SteamCMD sich selbst aktualisieren darf ------------
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT INT TERM

cp -a "${VORLAGE}/." "${ARBEIT}/"

HOME="$ARBEIT"
export HOME

# --- 2. Anmelden --------------------------------------------------------------
echo "Melde ${BENUTZER} an. Passwort und Steam-Guard-Code fragt SteamCMD gleich ab."
echo ''

"${ARBEIT}/steamcmd.sh" +login "$BENUTZER" +quit

# --- 3. Den Token dorthin legen, wo die Spiel-Images ihn suchen ---------------
if [ ! -f "${ARBEIT}/Steam/config/config.vdf" ]; then
  echo '' >&2
  echo 'SteamCMD hat keine Anmeldung hinterlassen – die Anmeldung ist also' >&2
  echo 'nicht durchgegangen. Ohne Fehlermeldung darüber? Dann war der' >&2
  echo 'Benutzername falsch.' >&2
  exit 75
fi

# `cp` ohne `-a`: Die Zeitstempel und den Besitzer der Vorlage zu erhalten ist
# hier nichts wert und scheitert auf einer fremden Einhängung mit „Operation not
# permitted", obwohl die Dateien längst geschrieben sind.
cp "${ARBEIT}/Steam/config/"* "$ZIEL/"
# Der Token ist die Anmeldung an diesem Konto; er geht niemanden sonst an.
chmod -R go-rwx "$ZIEL" 2> /dev/null || true

echo ''
echo "Fertig. Der Token liegt in ${ZIEL}."
echo 'Jetzt im Panel den Steam-Benutzernamen beim Server eintragen und starten.'
