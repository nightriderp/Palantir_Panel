#!/usr/bin/env bash
#
# Palantir - Deployment auf der VPS.
#
# Wird NICHT von Hand aufgerufen, sondern über SSH aus der Pipeline. In der
# authorized_keys des Deploy-Benutzers ist dieser Pfad als erzwungenes Kommando
# hinterlegt:
#
#   command="/opt/palantir/deploy/vps/deploy.sh",no-agent-forwarding,\
#   no-port-forwarding,no-pty,no-user-rc ssh-ed25519 AAAA...
#
# Dadurch kann ein abhandengekommener Schlüssel keine Shell oeffnen und keinen
# Port weiterleiten - er kann genau dieses Skript starten. Der gewünschte Commit
# kommt über SSH_ORIGINAL_COMMAND - siehe Prüfung weiter unten.
#
# WAS DAS ERZWUNGENE KOMMANDO NICHT LEISTET (ehrlich gesagt):
#   1. Es begrenzt nicht, WAS ausgerollt wird. Der Commit kommt ueber das Netz;
#      ohne weitere Pruefung liesse sich jeder vom Remote erreichbare Stand
#      auschecken und dessen Compose-Datei als docker-berechtigter Nutzer
#      starten - also faktisch als root auf der VPS. Deshalb erzwingt dieses
#      Skript unten selbst, dass der Commit ein Vorfahre von `origin/main` ist,
#      und verlaesst sich nicht auf die gleichlautende Pruefung in der Pipeline.
#   2. Der Pfad im `command="..."` zeigt in die Auscheckung, die dieses Skript
#      selbst veraendert. Wer einmal einen Stand ausrollen konnte, bestimmt
#      damit auch das Skript des naechsten Laufs. Sauber wird das erst, wenn das
#      erzwungene Kommando auf eine Kopie ausserhalb des Repos zeigt, die nur
#      root schreiben darf (z. B. /usr/local/sbin/palantir-deploy) - siehe
#      SETUP.md, Abschnitt zum Deploy-Zugang.
#
# Von Hand (zum Nachstellen) geht auch:
#   sudo -u palantir-deploy /opt/palantir/deploy/vps/deploy.sh <commit-sha>

set -euo pipefail

REPO_DIR="${PALANTIR_REPO_DIR:-/opt/palantir}"
COMPOSE_DIR="${REPO_DIR}/deploy/vps"
ENV_FILE="${REPO_DIR}/.env"

log() { printf '[deploy %s] %s\n' "$(date -u '+%H:%M:%S')" "$1"; }
fail() {
  printf '[deploy FEHLER] %s\n' "$1" >&2
  exit 1
}

# Sperrdatei bewusst NICHT in /tmp - und auch nicht in /run/lock, das auf Debian
# und Ubuntu ebenso world-writable mit Sticky-Bit ist. Ein beliebiger lokaler
# Nutzer koennte die Datei dort vorher mit Modus 600 anlegen; das `exec 9>`
# unten scheiterte dann, und jedes weitere Deployment braeche ab, ohne dass sich
# die Datei loeschen liesse (Sticky-Bit). `$XDG_RUNTIME_DIR` (/run/user/<uid>,
# 0700) gehoert dem Deploy-Benutzer allein; ohne Sitzung bleibt das
# Repo-Verzeichnis, das ebenfalls nur ihm gehoert.
sperrpfad() {
  if [[ -n "${XDG_RUNTIME_DIR:-}" && -d "${XDG_RUNTIME_DIR}" && -w "${XDG_RUNTIME_DIR}" ]]; then
    printf '%s' "${XDG_RUNTIME_DIR}/palantir-deploy.lock"
  else
    printf '%s' "${REPO_DIR}/.deploy.lock"
  fi
}
LOCK_FILE="${PALANTIR_LOCK_FILE:-$(sperrpfad)}"

# -----------------------------------------------------------------------------
# 1. Eingabe prüfen
# -----------------------------------------------------------------------------
# Der Commit kommt über das Netz. Er wird gleich an git weitergereicht, deshalb
# wird er streng geprüft statt nur zitiert: ausschließlich 40 hexadezimale
# Zeichen. Alles andere - Optionen, Pfade, Befehlstrenner - fällt hier durch.
ziel="${1:-${SSH_ORIGINAL_COMMAND:-}}"
ziel="$(printf '%s' "${ziel}" | tr -d '[:space:]')"

[[ -n "${ziel}" ]] || fail 'Kein Commit angegeben.'
[[ "${ziel}" =~ ^[0-9a-f]{40}$ ]] || fail "Kein gültiger Commit-SHA: '${ziel}'"

# -----------------------------------------------------------------------------
# 2. Gegen gleichzeitige Läufe sichern
# -----------------------------------------------------------------------------
# Zwei Deployments gleichzeitig würden sich beim Auschecken und beim Neustart
# der Container in die Quere kommen.
exec 9>"${LOCK_FILE}"
flock -n 9 || fail 'Es läuft bereits ein Deployment.'

log "Ziel-Commit: ${ziel}"

[[ -d "${REPO_DIR}/.git" ]] || fail "${REPO_DIR} ist keine Git-Auscheckung."
[[ -f "${ENV_FILE}" ]] || fail "${ENV_FILE} fehlt - siehe SETUP.md Abschnitt 1."

vorher="$(git -C "${REPO_DIR}" rev-parse HEAD)"
log "Aktueller Stand: ${vorher}"

# -----------------------------------------------------------------------------
# 3. Stand holen
# -----------------------------------------------------------------------------
# Nur der Compose-Aufbau und die Migrationen kommen aus dem Repository - der
# Anwendungscode steckt in den Images. Deshalb genügt ein flaches Holen.
log 'Hole den Ziel-Commit ...'
git -C "${REPO_DIR}" fetch --quiet --depth=1 origin "${ziel}"

# -----------------------------------------------------------------------------
# 3a. Nur Staende von `main` - hier, nicht nur in der Pipeline
# -----------------------------------------------------------------------------
# Ohne diese Pruefung checkt das Skript jeden vom Remote erreichbaren Commit aus
# und startet dessen Compose-Datei: ein Commit auf einem Nebenzweig oder der
# Kopf eines Fork-Pull-Requests (im oeffentlichen Basis-Repo per SHA holbar)
# genuegte, um mit einem abhandengekommenen Deploy-Schluessel beliebige
# Container zu starten. Die gleichlautende Pruefung in deploy.yml schuetzt nur
# den Weg ueber die Pipeline, nicht den ueber SSH.
#
# `main` braucht dafuer Historie: Das flache Holen oben bringt nur den einen
# Commit mit, und `merge-base --is-ancestor` wuerde ohne gemeinsame Historie
# jeden Stand ablehnen. Bei einer flachen Auscheckung wird deshalb vertieft.
log 'Pruefe, ob der Commit auf main liegt ...'
if [[ "$(git -C "${REPO_DIR}" rev-parse --is-shallow-repository)" == 'true' ]]; then
  git -C "${REPO_DIR}" fetch --quiet --no-tags --deepen=250 \
    origin '+refs/heads/main:refs/remotes/origin/main'
else
  git -C "${REPO_DIR}" fetch --quiet --no-tags \
    origin '+refs/heads/main:refs/remotes/origin/main'
fi

if ! git -C "${REPO_DIR}" merge-base --is-ancestor "${ziel}" origin/main; then
  fail "${ziel} liegt nicht auf main - es wird nichts ausgerollt. (Bei einem sehr alten Stand zuerst die Historie vertiefen: git -C ${REPO_DIR} fetch --unshallow origin main)"
fi

git -C "${REPO_DIR}" checkout --quiet --detach "${ziel}"

# Versions-Tag des ausgerollten Commits bestimmen - das ist die Version, die im
# Panel unten links steht. Sie wird nirgends von Hand gepflegt: Ein Deployment
# laeuft ausschliesslich ueber ein Tag `v*`, und hier wird genau dieses Tag
# wieder aufgeloest. Das flache Holen oben bringt keine Tags mit, deshalb ein
# zweiter, ebenso flacher Holvorgang nur fuer sie.
git -C "${REPO_DIR}" fetch --quiet --depth=1 origin '+refs/tags/*:refs/tags/*' || true
release="$(git -C "${REPO_DIR}" describe --tags --exact-match "${ziel}" 2>/dev/null || true)"

if [[ -z "${release}" ]]; then
  # Sollte nicht vorkommen, weil nur ein Tag ein Deployment ausloest. Falls doch
  # (Wiederanlauf von Hand), steht die kurze SHA da - eine leere Anzeige waere
  # schlimmer als eine unschoene.
  release="$(git -C "${REPO_DIR}" rev-parse --short "${ziel}")"
  log "Kein Tag zu diesem Commit - Anzeige faellt auf ${release} zurueck."
fi

export PALANTIR_RELEASE="${release}"
log "Version dieses Standes: ${release}"

# -----------------------------------------------------------------------------
# 3b. Ablageorte pruefen (WORK_STATUS.md, Gefundener Punkt 116)
# -----------------------------------------------------------------------------
# Beide Verzeichnisse werden in den Backend-Container eingehaengt und dort vom
# Benutzer `node` (UID 1000) beschrieben. Gehoeren sie auf dem Host `root`,
# laeuft alles scheinbar normal an - und der erste Archivierungslauf bzw. die
# erste Sicherung scheitert dann still am Schreiben. Ein Deployment ist der
# richtige Zeitpunkt, das zu merken.
#
# Bewusst nur eine Warnung und kein Abbruch: Das Panel funktioniert auch mit
# falschen Rechten, nur diese beiden Laeufe nicht. Und bewusst kein `chown`:
# Dieses Skript laeuft als unprivilegierter Deploy-Benutzer, dem gehoeren die
# Verzeichnisse nicht.
#
# **Ein fehlendes Verzeichnis ist der schlimmere Fall, nicht der harmlosere.**
# Bis hierher stieg die Pruefung dann still aus. Auf einer frischen Installation
# gibt es die Ordner aber gerade nicht - Docker legt die fehlende Bind-Quelle
# selbst an, und zwar als `root:root`. Die Warnung blieb also genau dort aus, wo
# sie gebraucht wird, und der erste Schrift-Upload scheiterte spaeter mit einem
# 500er, ohne dass irgendwo etwas gestanden haette (Fundpunkt 177).
#
# Angelegt wird der Ordner hier trotzdem nicht: Dieses Skript laeuft als
# unprivilegierter Deploy-Benutzer, ein von ihm angelegter Ordner gehoerte ihm
# und damit wieder nicht UID 1000. Es bleibt beim Hinweis - aber jetzt kommt er.
pruefe_besitzer() {
  local pfad="$1" zweck="$2"

  if [[ ! -d "${pfad}" ]]; then
    log "ACHTUNG: ${pfad} gibt es noch nicht (${zweck})."
    log "         Docker legt die Bind-Quelle sonst als root:root an, und das"
    log "         Backend schreibt als UID 1000 - der erste Zugriff scheitert."
    log "         Auf der VPS als root vorbereiten:"
    log "         mkdir -p ${pfad} && chown 1000:1000 ${pfad}"

    return 0
  fi

  local besitzer
  besitzer="$(stat -c '%u' "${pfad}" 2>/dev/null || echo '')"

  if [[ -n "${besitzer}" && "${besitzer}" != '1000' ]]; then
    log "ACHTUNG: ${pfad} gehoert UID ${besitzer}, gebraucht wird UID 1000 (${zweck})."
    log "         Auf der VPS als root beheben: chown -R 1000:1000 ${pfad}"
  fi
}

pruefe_besitzer "${REPO_DIR}/data/audit-archive" 'Archivierung des Audit-Logs'
pruefe_besitzer "${REPO_DIR}/data/panel-backups" 'Sicherungen der Panel-Datenbank'
pruefe_besitzer "${REPO_DIR}/data/fonts" 'Hochgeladene Schriften der Oberflaeche'

# Der oeffentliche Schluessel der Panel-Sicherungen (Fundpunkt 241). Steht in der
# .env ein Pfad, muss die Datei auch da sein - sonst scheitert nicht das
# Deployment, sondern erst die naechste naechtliche Sicherung, und zwar still im
# Protokoll. Geprueft wird auf der HOST-Seite der Einhaengung: In der .env steht
# der Pfad im Container (/data/panel-backup-key/...), auf der Platte liegt er
# unter <repo>/data/panel-backup-key/.
schluessel_pfad="$(grep -E '^[[:space:]]*PANEL_BACKUP_PUBLIC_KEY_FILE=' "${ENV_FILE}" \
  | tail -n 1 | cut -d= -f2- | tr -d '"'"'"'\r' || true)"

if [[ -n "${schluessel_pfad}" ]]; then
  host_pfad="${schluessel_pfad/#\/data\/panel-backup-key/${REPO_DIR}/data/panel-backup-key}"

  if [[ -f "${host_pfad}" ]]; then
    log "Panel-Sicherungen werden verschluesselt (${host_pfad})."
  else
    log "ACHTUNG: PANEL_BACKUP_PUBLIC_KEY_FILE zeigt auf ${schluessel_pfad},"
    log "         auf der Platte erwartet unter ${host_pfad} - da liegt nichts."
    log "         Jede Panel-Sicherung wird scheitern, bis die Datei da ist."
    log "         Schluesselpaar erzeugen (NICHT auf der VPS):"
    log "         pnpm --filter @palantir/backend panel:schluessel"
  fi
else
  log "Hinweis: PANEL_BACKUP_PUBLIC_KEY_FILE ist leer - die Panel-Sicherungen"
  log "         liegen unverschluesselt unter data/panel-backups, mit jedem Konto"
  log "         und jedem Geheimnis der Instanz darin."
fi

# -----------------------------------------------------------------------------
# 4. Images holen und Stack starten
# -----------------------------------------------------------------------------
# Die .env wird NICHT angefasst (Pflichtenheft §12.1) - sie enthält alle
# Geheimnisse und wird von Hand gepflegt. Die Fassung kommt stattdessen als
# Umgebungsvariable; sie hat in docker compose Vorrang vor der --env-file.
# Dasselbe gilt fuer PALANTIR_RELEASE (oben gesetzt und exportiert): die
# angezeigte Version steht damit in der Umgebung des Frontend-Containers,
# nicht in einer Datei, die jemand pflegen muesste.
#
# Ausgerollt wird der Commit-SHA, NICHT das bewegliche Tag `prod`: images.yml
# taggt jedes Image mit dem vollen SHA, und `prod` haengt die Pipeline erst um,
# wenn dieser Lauf hier durch ist. Damit rollt genau der Stand aus, der als
# Kommando hereinkam - auch bei einem Rueckfall auf einen aelteren SHA und auch
# dann, wenn zwischenzeitlich jemand `prod` bewegt hat.
cd "${COMPOSE_DIR}"

log 'Hole die Images ...'
PALANTIR_VERSION="${ziel}" docker compose --env-file "${ENV_FILE}" pull --quiet

# `up -d` wendet über den Dienst `migrate` zuerst die Migrationen an; Backend und
# Frontend warten per service_completed_successfully darauf. Die Reihenfolge
# steht in der Compose-Datei, nicht hier.
log 'Starte den Stack ...'
PALANTIR_VERSION="${ziel}" docker compose --env-file "${ENV_FILE}" up -d --remove-orphans

# -----------------------------------------------------------------------------
# 5. Ergebnis prüfen
# -----------------------------------------------------------------------------
# Ohne diese Prüfung meldet die Pipeline Erfolg, sobald die Container gestartet
# sind - auch wenn das Backend gleich darauf in einer Absturzschleife hängt.
#
# Drei Dinge, die die frühere Fassung falsch gemacht hat:
#   - `traefik`, `socket-proxy` und `frps` bringen keinen Healthcheck mit. Ihr
#     leeres `{{.Health}}` wurde weggefiltert und galt damit als gesund - eine
#     frps-Absturzschleife (alle Spielserver von aussen unerreichbar) fiel nicht
#     auf. Jetzt entscheidet bei ihnen der Zustand, und das Fehlen des
#     Healthchecks wird ausdruecklich gemeldet.
#   - Ein `|| true` um die ganze Pipeline machte einen Fehler von `ps` selbst zu
#     "gesund". Unbekannt ist nicht gesund.
#   - Eine einzelne Stichprobe reicht nicht: Zwischen zwei Neustarts ist auch
#     ein abstuerzender Container kurz "running".
log 'Warte auf gesunde Dienste ...'
erfolge=0
for versuch in $(seq 1 30); do
  # `{{.Health}}` steht als letztes Feld, weil genau dieses leer sein kann:
  # `read` fasst mehrere Trennzeichen zusammen, in der Mitte wuerde ein leerer
  # Wert also die folgenden Felder verschieben.
  if ! zeilen="$(docker compose --env-file "${ENV_FILE}" ps --all \
    --format '{{.Service}} {{.State}} {{.ExitCode}} {{.Health}}')"; then
    fail 'docker compose ps ist fehlgeschlagen - der Zustand der Dienste ist unbekannt.'
  fi

  gezaehlt=0
  ungesund=''
  ohne_check=''
  while read -r dienst zustand code gesundheit; do
    [[ -n "${dienst}" ]] || continue
    gezaehlt=$((gezaehlt + 1))
    case "${gesundheit}" in
      healthy) ;;
      starting | unhealthy) ungesund+=" ${dienst}(${gesundheit})" ;;
      *)
        if [[ "${zustand}" == 'running' ]]; then
          ohne_check+=" ${dienst}"
        elif [[ "${zustand}" == 'exited' ]]; then
          # `migrate` und die Profil-Dienste beenden sich planmaessig. Ein
          # Fehlercode wird gemeldet; scheitert `migrate` wirklich, bricht schon
          # `up -d` weiter oben ab (service_completed_successfully).
          [[ "${code}" == '0' ]] || log "Hinweis: ${dienst} ist mit Code ${code} beendet."
        else
          ungesund+=" ${dienst}(${zustand})"
        fi
        ;;
    esac
  done <<<"${zeilen}"

  if [[ "${gezaehlt}" -eq 0 ]]; then
    ungesund=' (kein einziger Dienst gefunden)'
  fi

  if [[ -z "${ungesund}" ]]; then
    erfolge=$((erfolge + 1))
    if [[ "${erfolge}" -ge 2 ]]; then
      break
    fi
  else
    erfolge=0
  fi

  if [[ "${versuch}" -eq 30 ]]; then
    log "Noch nicht gesund:${ungesund}"
    docker compose --env-file "${ENV_FILE}" ps --all
    fail 'Dienste wurden nicht rechtzeitig gesund. Der vorherige Stand läuft NICHT mehr - siehe Rückfall unten.'
  fi
  sleep 5
done

log 'Alle Dienste betriebsbereit.'
if [[ -n "${ohne_check}" ]]; then
  log "Ohne Healthcheck - nur der Zustand wurde geprueft:${ohne_check}"
fi
docker compose --env-file "${ENV_FILE}" ps --format 'table {{.Service}}\t{{.Status}}'

log "Fertig: ${vorher} -> ${ziel}"

# Rückfall (von Hand, siehe docs/ci-cd.md §4): Dieses Skript mit dem vorherigen
# SHA erneut aufrufen - die VPS zieht die Images anhand des SHA, dafuer muss
# nichts umgehaengt werden. Damit die Gamenode mitkommt, gehoert danach in GHCR
# das Tag `prod` und der Zweig `prod` ebenfalls auf diesen SHA zurueck.
# Achtung: Migrationen sind vorwärtsgerichtet - ein Rückfall der Anwendung setzt
# voraus, dass die Migrationen abwärtskompatibel geschrieben wurden.
