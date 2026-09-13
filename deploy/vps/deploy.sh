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

# Ablage der Sicherungen, die dieses Skript unmittelbar vor dem Ausrollen zieht
# (Abschnitt 3b). Bewusst neben den uebrigen Ablageorten unter data/, aber NICHT
# mit ihnen verwechseln: data/panel-backups schreibt das Backend aus dem
# Container heraus als UID 1000, hier schreibt der Deploy-Benutzer auf dem Host.
# Ein `chown 1000` waere hier also falsch.
DUMP_DIR="${REPO_DIR}/data/pre-deploy"
DUMP_KEEP_STANDARD=10

# Liest einen Wert aus der .env (letzte Zuweisung gewinnt, alles rechts vom
# ersten `=`). Bewusst kein `source`: die Datei traegt Geheimnisse, und sie soll
# nicht die Umgebung dieses Skripts fuellen.
env_wert() {
  local zeile
  zeile="$(grep -E "^[[:space:]]*${1}=" "${ENV_FILE}" | tail -n 1 || true)"
  zeile="${zeile#*=}"
  zeile="${zeile%\"}"
  zeile="${zeile#\"}"
  zeile="${zeile%\'}"
  zeile="${zeile#\'}"
  printf '%s' "${zeile}" | tr -d '\r'
}

# `docker compose` im Stack-Verzeichnis, ohne das Arbeitsverzeichnis des Skripts
# zu verschieben - das passiert erst in Abschnitt 4. Gebraucht wird das von der
# Sicherung (3b, laeuft davor) und vom Rueckrollen (laeuft danach, aber aus einer
# Falle heraus, in der das Arbeitsverzeichnis nicht feststeht).
compose_im_stack() {
  (cd "${COMPOSE_DIR}" && docker compose --env-file "${ENV_FILE}" "$@")
}

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

# -----------------------------------------------------------------------------
# 2a. Keine Platzhalter aus der Vorlage (Fundpunkt 283)
# -----------------------------------------------------------------------------
# `.env.example` liefert drei Werte mit `CHANGE_ME` aus. Einen davon faengt das
# Backend seit HM-2 beim Start ab - aber nur die, die in seinem Schema stehen.
# `POSTGRES_PASSWORD` und `FRP_TOKEN` kommen dort nie an: Der eine gehoert dem
# Datenbank-Container, der andere frps und frpc, und beide bekommen ihre
# Umgebung direkt aus der `.env`.
#
# Blieben sie stehen, haette die Datenbank ein oeffentlich bekanntes Passwort
# und dem Spiele-Tunnel fehlte seine zweite Schranke. `scripts/setup.sh` fuellt
# beide - aber der laeuft einmal bei der Einrichtung, und danach sieht niemand
# mehr hin. Diese Pruefung sieht bei JEDEM Ausrollen hin.
#
# Bewusst allgemein statt auf die beiden Namen: Ein kuenftiger Platzhalter
# desselben Musters faellt damit von selbst auf. Und bewusst hier ganz oben -
# ein Abbruch kostet dann nichts, es ist noch nichts geholt und nichts
# ausgetauscht.
#
# Gemeldet werden nur die NAMEN. Ein Deployment-Protokoll landet in GitHub
# Actions, und dort hat kein Wert aus der `.env` etwas verloren.
platzhalter_offen() {
  local treffer

  # Nur Zuweisungen, keine Kommentare: Das Muster verlangt am Zeilenanfang
  # einen Variablennamen. `# POSTGRES_PASSWORD=CHANGE_ME` in der Vorlage faellt
  # damit durch.
  treffer="$(grep -nE "^[[:space:]]*[A-Z_][A-Z0-9_]*=.*CHANGE_ME" "${ENV_FILE}" || true)"

  [[ -n "${treffer}" ]] || return 0

  printf '%s\n' "${treffer}" |
    sed -E "s/^([0-9]+):[[:space:]]*([A-Z_][A-Z0-9_]*)=.*/  - \\2 (Zeile \\1)/"
}

offene_platzhalter="$(platzhalter_offen)"

if [[ -n "${offene_platzhalter}" ]]; then
  log "In ${ENV_FILE} steht noch der Platzhalter CHANGE_ME aus der Vorlage:"
  printf '%s\n' "${offene_platzhalter}" | while IFS= read -r zeile; do log "${zeile}"; done
  log '   So kommen sie weg:'
  log '   - FRP_TOKEN: auf BEIDEN Maschinen denselben neuen Wert eintragen'
  log "     (openssl rand -hex 32), danach frps und frpc neu starten."
  log '   - POSTGRES_PASSWORD: reicht nicht in der .env allein - das Image setzt'
  log '     es nur beim ersten Anlegen des Datenverzeichnisses. In der laufenden'
  log '     Datenbank: ALTER ROLE <benutzer> WITH PASSWORD '"'"'<neu>'"'"';'
  log '     danach denselben Wert in POSTGRES_PASSWORD und in DATABASE_URL.'
  log '   - Uebrige: scripts/setup.sh fuellt sie, oder von Hand.'
  fail 'Es wird nichts ausgerollt, solange ein Platzhalter aus der Vorlage in Betrieb ist.'
fi

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

# -----------------------------------------------------------------------------
# 3b. Sicherung, bevor irgendetwas ausgetauscht wird
# -----------------------------------------------------------------------------
# Der Dienst `migrate` wandert beim Hochfahren ueber die Datenbank. Eine
# Migration, die eine Spalte oder Tabelle entfernt oder umbenennt, ist danach
# nicht mehr rueckgaengig zu machen: Das Zurueckrollen weiter unten tauscht die
# ANWENDUNG zurueck, die Datenbank steht dann aber schon weiter. Deshalb zuerst
# ein Abzug; scheitert er, wird gar nicht erst ausgerollt.
#
# Bewusst VOR der Auscheckung und damit mit der Konfiguration, die gerade
# laeuft: Die Sicherung soll den Stand festhalten, der jetzt in Betrieb ist -
# nicht einen, der erst noch erprobt wird.
#
# ⚠️ Das ersetzt die geplante Panel-Sicherung NICHT (Abschnitt 17 der .env,
# `data/panel-backups`). Diese hier ist der gezielte Stand eines Deployments und
# wird nach `PRE_DEPLOY_DUMP_KEEP` Laeufen wieder weggeraeumt.
#
# **Warum diese Abzuege NICHT verschluesselt werden** (Fundpunkt 287): Inhaltlich
# sind sie so heikel wie eine Panel-Sicherung - jeder Passwort-Hash, jedes
# TOTP-Geheimnis, jede Webhook-Adresse. Der Unterschied ist der Zweck. Eine
# Panel-Sicherung ist dafuer da, die Maschine zu verlassen; deshalb traegt sie
# den oeffentlichen Schluessel des Betreibers, und der private liegt
# ausdruecklich woanders.
#
# Dieser Abzug hier ist das Gegenteil: der Rueckweg fuer ein Deployment, das in
# den naechsten Minuten schiefgeht. Ihn mit demselben Schluessel zu versehen
# hiesse, im Ernstfall erst den privaten Schluessel von ausserhalb zu holen und
# eine Passphrase einzutippen (`panel:entschluesseln` fragt danach) - genau dann,
# wenn es schnell gehen muss und womoeglich niemand am Platz ist. Eine Sicherung,
# die man im Ernstfall nicht aufbekommt, ist keine.
#
# Die Schranke ist deshalb eine andere: Der Ordner steht auf 700, die Abzuege auf
# 600, beide gehoeren dem Deploy-Benutzer, und `PRE_DEPLOY_DUMP_KEEP` begrenzt,
# wie lange sie ueberhaupt herumliegen. Gegen root auf der VPS hilft ohnehin
# nichts davon - wer dort root ist, liest auch die laufende Datenbank.
#
# Wer sie dennoch aus dem Haus tragen will (auf ein anderes Blech, in ein
# fremdes Backup), verschluesselt sie beim Wegtragen - nicht hier.
sicherung_ziehen() {
  local datei behalten groesse

  # ⚠️ `${REPO_DIR}/data` gehoert auf der VPS root (Stand 13.09.2026), der
  # Deploy-Benutzer kann darin nichts anlegen. Der Ordner ist deshalb EINMALIG
  # als root vorzubereiten - und zwar vor dem ersten Tag nach dieser Aenderung,
  # sonst bricht das Deployment hier ab. Bewusst mit Abbruch statt mit einer
  # Warnung: Ein Deployment ohne Rueckweg ist genau das, was hier abgeschafft
  # wird.
  # `umask` statt `mkdir -m`: Mit `-p` gilt `-m` nur fuer den letzten Ordner
  # (ShellCheck SC2174), ein zwischendurch angelegter Elternteil bekaeme die
  # Standardmaske. Die Maske gilt fuer alles, was hier entsteht, und schliesst
  # zugleich das Fenster zwischen Anlegen und dem `chmod` darunter.
  if ! (umask 077 && mkdir -p "${DUMP_DIR}") 2>/dev/null; then
    fail "Sicherungsordner ${DUMP_DIR} laesst sich nicht anlegen ($(dirname "${DUMP_DIR}") gehoert root). Einmalig als root auf der VPS: install -d -m 700 -o $(id -un) -g $(id -gn) ${DUMP_DIR}"
  fi

  # Rechte bei JEDEM Lauf durchsetzen, nicht nur beim Anlegen (Fundpunkt 287).
  #
  # Die Maske oben wirkt nur auf einen Ordner, den dieser Aufruf tatsaechlich
  # anlegt - ein bereits vorhandener behaelt seinen Modus. Genau so entstand
  # der Fundpunkt: Der erste Lauf legte den Ordner mit der Standardmaske als
  # 755 an. Ein Abzug traegt jeden Passwort-Hash, jedes TOTP-Geheimnis und
  # jede Webhook-Adresse der Instanz - dieselbe Vertraulichkeit wie eine
  # Panel-Sicherung. Jeder lokale Nutzer der VPS konnte darin lesen.
  #
  # Der Ordner ist die tragende Schranke: Ohne x-Recht darauf kommt niemand
  # an die Dateien, gleich welchen Modus die tragen.
  chmod 700 "${DUMP_DIR}" 2>/dev/null ||
    log "ACHTUNG: ${DUMP_DIR} liess sich nicht auf 700 setzen - Abzuege sind moeglicherweise mitlesbar."

  # Die Datenbank muss laufen, sonst gibt es nichts zu sichern. `--wait` haengt
  # am Healthcheck des Dienstes (`pg_isready`), die Frist verhindert, dass ein
  # kaputter Datenordner den Lauf endlos offen haelt.
  log 'Stelle die Datenbank bereit ...'
  if ! compose_im_stack up -d --wait --wait-timeout 120 postgres; then
    fail 'Die Datenbank wurde nicht bereit - es wird nichts ausgerollt.'
  fi

  datei="${DUMP_DIR}/vor-${ziel:0:12}-$(date -u '+%Y%m%dT%H%M%SZ').sql.gz"

  # Das Passwort bleibt im Container: `sh -c` mit EINFACHEN Anfuehrungszeichen
  # wird vom Host nicht ersetzt, sondern erst von der Shell im Container - die
  # ihre eigenen POSTGRES_*-Variablen kennt. Ein `-e PGPASSWORD=...` von aussen
  # stuende dagegen in der Prozessliste des Hosts.
  #
  # `set -o pipefail` (Kopf der Datei) sorgt dafuer, dass ein Fehler von pg_dump
  # nicht von einem erfolgreichen gzip verdeckt wird.
  log 'Sichere die Datenbank ...'

  # Zweite Schranke am Abzug selbst (Fundpunkt 287): Die Umleitung legt die
  # Datei an, bevor irgendetwas hineinfliesst - ohne diese Maske entstuende
  # sie mit den Vorgaben des Aufrufers, und zwischen Anlegen und einem
  # nachtraeglichen `chmod` laege ein Fenster, in dem sie lesbar waere.
  # `umask` gilt nur in dieser Subshell, damit nichts weiter unten davon
  # ueberrascht wird.
  if ! (
    umask 077
    compose_im_stack exec -T postgres \
      sh -c 'PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump -h 127.0.0.1 -U "${POSTGRES_USER}" -d "${POSTGRES_DB}"' \
      | gzip -c >"${datei}"
  ); then
    rm -f "${datei}"
    fail 'Die Sicherung ist fehlgeschlagen - es wird nicht migriert und nicht ausgerollt.'
  fi

  # Abzuege aus der Zeit vor dieser Aenderung liegen noch mit der
  # Standardmaske da. Sie sind durch den Ordner geschuetzt; die Dateien
  # ziehen wir trotzdem nach, damit ein spaeter geoeffneter Ordner sie nicht
  # freilegt.
  chmod 600 "${DUMP_DIR}"/vor-*.sql.gz 2>/dev/null || true

  groesse="$(du -h "${datei}" | cut -f1)"
  log "    Sicherung: ${datei} (${groesse})"
  log "    Zurueckspielen: gunzip -c ${datei} | docker compose exec -T postgres psql -U <benutzer> -d <datenbank>"

  # Aufbewahrung: die juengsten N behalten, der Rest geht. Ohne das fuellt sich
  # die Platte schleichend - dasselbe Muster wie bei den Abbildern in
  # Abschnitt 6. `find -printf` statt `ls`, damit die Sortierung nicht am
  # Dateinamen haengt.
  behalten="$(env_wert PRE_DEPLOY_DUMP_KEEP)"
  [[ "${behalten}" =~ ^[0-9]+$ ]] || behalten="${DUMP_KEEP_STANDARD}"

  if [[ "${behalten}" -gt 0 ]]; then
    find "${DUMP_DIR}" -maxdepth 1 -type f -name 'vor-*.sql.gz' -printf '%T@ %p\n' \
      | sort -rn \
      | tail -n +"$((behalten + 1))" \
      | cut -d' ' -f2- \
      | while read -r alt; do
        log "    Raeume alte Sicherung weg: $(basename "${alt}")"
        rm -f "${alt}"
      done
  fi
}

sicherung_ziehen

# -----------------------------------------------------------------------------
# 3c. Rueckweg, falls der neue Stand nicht hochkommt
# -----------------------------------------------------------------------------
# Bis hierher ist nichts ausgetauscht, ein Abbruch ist folgenlos. Ab der
# Auscheckung gilt das nicht mehr: Auscheckung und laufende Container koennen
# auseinanderlaufen, und ohne Rueckweg bliebe die VPS mit einem halb
# ausgetauschten Stand stehen, bis jemand von Hand eingreift.
#
# Zwei Schalter statt einer pauschalen Falle, damit nur zurueckgenommen wird,
# was tatsaechlich angefasst wurde.
checkout_verschoben=0
stack_angefasst=0

zurueck_bei_fehler() {
  local ausgang=$? release_vorher

  [[ "${ausgang}" -ne 0 ]] || exit "${ausgang}"

  if [[ "${checkout_verschoben}" -eq 1 ]]; then
    log "Setze die Auscheckung auf ${vorher:0:12} zurueck."
    git -C "${REPO_DIR}" checkout --quiet --detach "${vorher}" \
      || log 'ACHTUNG: Das Zuruecksetzen der Auscheckung ist misslungen - von Hand pruefen.'
  fi

  if [[ "${stack_angefasst}" -eq 1 ]]; then
    if [[ "${vorher}" == "${ziel}" ]]; then
      # Derselbe Stand lief schon vorher. Ihn erneut zu starten waere kein
      # Rueckrollen, sondern ein zweiter Versuch mit genau dem, was gerade
      # gescheitert ist - schlimmer als nichts zu tun.
      log 'Kein Rueckweg: es lief bereits derselbe Commit. Der Stack bleibt, wie er ist.'
    else
      release_vorher="$(git -C "${REPO_DIR}" describe --tags --exact-match "${vorher}" 2>/dev/null || git -C "${REPO_DIR}" rev-parse --short "${vorher}")"
      log "Rolle den Stack zurueck auf ${vorher:0:12} (${release_vorher}) ..."

      # Die Abbilder zum alten Commit liegen unter seinem SHA in der Registry;
      # umgehaengt werden muss dafuer nichts. Die Compose-Datei kommt aus der
      # eben zurueckgesetzten Auscheckung - eine Aenderung an ihr faellt damit
      # mit zurueck.
      if PALANTIR_VERSION="${vorher}" PALANTIR_RELEASE="${release_vorher}" \
        compose_im_stack up -d --remove-orphans; then
        log 'Der vorherige Stand laeuft wieder.'
      else
        log 'ACHTUNG: Das Zurueckrollen ist misslungen. Der Stack ist NICHT betriebsbereit -'
        log "         von Hand: cd ${COMPOSE_DIR} && PALANTIR_VERSION=${vorher} docker compose --env-file ${ENV_FILE} up -d"
      fi
    fi
  fi

  exit "${ausgang}"
}
trap zurueck_bei_fehler EXIT

git -C "${REPO_DIR}" checkout --quiet --detach "${ziel}"
checkout_verschoben=1

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
stack_angefasst=1
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
    fail 'Dienste wurden nicht rechtzeitig gesund. Es wird auf den vorherigen Stand zurueckgerollt (Abschnitt 3c).'
  fi
  sleep 5
done

log 'Alle Dienste betriebsbereit.'
if [[ -n "${ohne_check}" ]]; then
  log "Ohne Healthcheck - nur der Zustand wurde geprueft:${ohne_check}"
fi
docker compose --env-file "${ENV_FILE}" ps --format 'table {{.Service}}\t{{.Status}}'

# -----------------------------------------------------------------------------
# 6. Alte Abbilder aufraeumen
# -----------------------------------------------------------------------------
# Jedes Deployment zieht ein neues Backend- und ein neues Frontend-Abbild und
# laesst das bisherige liegen. Am 13.09.2026 hatten sich so 110 Abbilder mit
# 13,7 GB angesammelt - auf einer Platte mit 38 GB. Nach einem Prune von Hand
# blieben 6 Abbilder mit 1,58 GB uebrig, die Belegung fiel von 52 % auf 15 %.
# Ohne diesen Schritt steht dasselbe in wenigen Wochen wieder an.
#
# Bewusst erst hier, nach der Gesundheitspruefung: Scheitert das Deployment,
# bricht das Skript oben mit `fail` ab und es wird nichts geloescht.
#
# `-a` klingt schlimmer, als es ist: Docker fasst kein Abbild an, das ein
# Container benutzt - auch kein beendeter. Uebrig bleibt also genau die gerade
# laufende Fassung. Der Rueckwaertsgang laeuft ohnehin ueber
# `deploy.sh <alter-commit>` und zieht die Abbilder anhand des SHA neu aus der
# Registry (siehe Rueckfall am Ende dieser Datei); ein lokaler Vorrat spart dabei
# nur den Zug selbst, rund eine Minute.
#
# Der Bau-Zwischenspeicher (`docker builder prune`) wird ausdruecklich NICHT
# angefasst: Am 13.09. waren dessen 22 Eintraege mit 1,27 GB allesamt in
# Benutzung, und auf der VPS wird ohnehin nichts gebaut.
#
# Ein Fehlschlag beim Aufraeumen darf das Deployment nicht kippen - der Stack
# laeuft an dieser Stelle bereits gesund. Das `if` haelt `set -e` von genau
# diesem Aufruf fern; gemeldet wird der Fehler trotzdem.
log 'Raeume alte Abbilder auf ...'
if aufraeum_ausgabe="$(docker image prune -af 2>&1)"; then
  # Die letzte Zeile ist "Total reclaimed space: ..." - mehr braucht das
  # Protokoll nicht, die Liste der geloeschten Ebenen ist lang und nutzlos.
  log "$(printf '%s' "${aufraeum_ausgabe}" | tail -n 1)"
else
  log 'Hinweis: Das Aufraeumen der Abbilder ist fehlgeschlagen. Das Deployment'
  log '         selbst ist davon unberuehrt - der Stack laeuft. Ausgabe:'
  printf '%s\n' "${aufraeum_ausgabe}" >&2
fi

log "Fertig: ${vorher} -> ${ziel}"

# Rückfall, zwei Fälle:
#
# 1. **Der neue Stand kommt gar nicht hoch.** Dann rollt dieses Skript selbst
#    zurueck (Abschnitt 3c): Auscheckung zurueck, vorheriger Commit wieder als
#    PALANTIR_VERSION, Stack neu gestartet. Es ist nichts von Hand zu tun; in
#    GHCR und am Zweig `prod` aendert sich dabei nichts, weil deploy.yml beides
#    erst nach einem erfolgreichen Lauf umhaengt.
#
# 2. **Der Fehler faellt spaeter auf.** Dann dieses Skript mit dem vorherigen
#    SHA erneut aufrufen (siehe docs/ci-cd.md §4) - die VPS zieht die Abbilder
#    anhand des SHA. Damit die Gamenode mitkommt, gehoert danach in GHCR das Tag
#    `prod` und der Zweig `prod` ebenfalls auf diesen SHA zurueck.
#
# Achtung in beiden Faellen: Migrationen sind vorwärtsgerichtet. Der Abzug aus
# Abschnitt 3b ist der Rueckweg fuer das Schema - er macht destruktive
# Migrationen nicht harmlos, er macht sie nur ueberlebbar.
