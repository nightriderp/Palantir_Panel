#!/usr/bin/env bash
#
# Palantir - Selbstaktualisierung der Gamenode.
#
# Läuft in der Gameserver-VM, angestoßen vom systemd-Timer daneben.
#
# WARUM ZIEHEN STATT SCHICKEN: Pflichtenheft §1 - der Homeserver nimmt zu keinem
# Zeitpunkt eingehende Verbindungen an, auch nicht aus dem WireGuard-Tunnel. Ein
# Deployment per SSH wie auf der VPS ist hier also ausgeschlossen. Die Node holt
# sich ihren Stand selbst; alle Verbindungen gehen nach außen.
#
# Der Agent ist die einzige Komponente, die sich selbst aktualisieren muss. Die
# Gameserver-Container werden NICHT deployt - die steuert das Panel zur Laufzeit
# über das Agent-Protokoll.
#
# Der freigegebene Stand steht im Git-Zweig `prod`: den setzt die Pipeline nach
# der Freigabe auf denselben Commit, auf den auch das Image-Tag `prod` zeigt.

set -euo pipefail

REPO_DIR="${PALANTIR_REPO_DIR:-/opt/palantir}"
COMPOSE_DIR="${REPO_DIR}/deploy/gamenode"
ENV_FILE="${REPO_DIR}/.env"
ZWEIG="${PALANTIR_BRANCH:-prod}"
LOCK_FILE="/tmp/palantir-update.lock"

log() { printf '[update %s] %s\n' "$(date -u '+%H:%M:%S')" "$1"; }
fail() {
  printf '[update FEHLER] %s\n' "$1" >&2
  exit 1
}

exec 9>"${LOCK_FILE}"
flock -n 9 || {
  log 'Ein Lauf ist noch aktiv - übersprungen.'
  exit 0
}

[[ -d "${REPO_DIR}/.git" ]] || fail "${REPO_DIR} ist keine Git-Auscheckung."
[[ -f "${ENV_FILE}" ]] || fail "${ENV_FILE} fehlt - siehe SETUP.md."

vorher="$(git -C "${REPO_DIR}" rev-parse HEAD)"

log "Prüfe Zweig '${ZWEIG}' ..."
git -C "${REPO_DIR}" fetch --quiet origin "${ZWEIG}"
ziel="$(git -C "${REPO_DIR}" rev-parse "origin/${ZWEIG}")"

# Der übliche Fall: nichts hat sich geändert. Dann wird nichts angefasst - kein
# Neustart der Container, keine Unterbrechung laufender Gameserver.
if [[ "${vorher}" == "${ziel}" ]]; then
  log "Unverändert (${ziel:0:12}) - nichts zu tun."
  exit 0
fi

log "Neuer Stand: ${vorher:0:12} -> ${ziel:0:12}"
git -C "${REPO_DIR}" checkout --quiet --detach "${ziel}"

cd "${COMPOSE_DIR}"

log 'Hole die Images ...'
docker compose --env-file "${ENV_FILE}" pull --quiet

# Nur Agent und Socket-Proxy werden neu gestartet. Die Gameserver-Container
# gehören nicht zu diesem Compose-Projekt und laufen unberührt weiter - ein
# Update des Agents darf keine laufende Spielrunde beenden.
log 'Starte die Dienste der Gamenode neu ...'
docker compose --env-file "${ENV_FILE}" up -d --remove-orphans

log 'Zustand:'
docker compose --env-file "${ENV_FILE}" ps --format 'table {{.Service}}\t{{.Status}}'

log "Fertig: ${ziel:0:12}"
