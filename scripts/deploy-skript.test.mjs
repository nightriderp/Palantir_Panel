import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * Probelauf für `deploy/vps/deploy.sh` (Fundpunkt 282).
 *
 * Das Skript entscheidet über den laufenden Betrieb: Es zieht einen
 * Datenbankabzug, tauscht die Auscheckung, startet den Stack und rollt bei einem
 * Fehlschlag zurück. Geprüft wurde es bisher von Hand, einmal je Änderung, mit
 * einem Probelauf, der danach im Papierkorb der Sitzung verschwand. Genau das
 * ist die Fehlerklasse „grün, aber nicht gelaufen": Eine Prüfung, die niemand
 * wiederholt, ist ab dem nächsten Tag keine mehr.
 *
 * Hier läuft das echte Skript gegen einen Sandkasten: ein Wegwerf-Repository als
 * Auscheckung, eine Wegwerf-`.env` und ein gestelltes `docker` im Pfad, das
 * mitschreibt, was es gefragt wurde. Nichts davon fasst eine echte Maschine an.
 *
 * **Unter Windows wird übersprungen, und zwar sichtbar.** Das Skript braucht
 * `flock` und GNU `find -printf`; Git Bash bringt `flock` nicht mit. Auf dem
 * Linux-Runner der CI ist ein fehlendes Werkzeug dagegen ein harter Fehlschlag -
 * ein Test, der sich dort still überspringt, wäre wieder genau die Klasse, gegen
 * die er geschrieben ist.
 */

const HIER = path.dirname(fileURLToPath(import.meta.url));
const SKRIPT = path.resolve(HIER, '..', 'deploy', 'vps', 'deploy.sh');

/** Ist das hier eine Umgebung, in der das Skript überhaupt laufen kann? */
function werkzeugeFehlen() {
  const fehlend = [];

  for (const [werkzeug, probe] of [
    ['bash', ['bash', ['-c', 'true']]],
    ['flock', ['bash', ['-c', 'command -v flock']]],
    // GNU-`find`: BSD-find kennt `-printf` nicht, und die Aufbewahrung haengt
    // daran.
    ['find -printf', ['bash', ['-c', 'find . -maxdepth 0 -printf "" 2>/dev/null']]],
  ]) {
    const [befehl, argumente] = probe;
    const lauf = spawnSync(befehl, argumente, { encoding: 'utf8' });

    if (lauf.status !== 0) fehlend.push(werkzeug);
  }

  return fehlend;
}

const FEHLEND = werkzeugeFehlen();

if (FEHLEND.length > 0 && process.platform !== 'win32') {
  // Kein Ueberspringen: Auf einer POSIX-Maschine gehoert das Werkzeug dorthin,
  // und ein stiller Sprung verdeckte genau den Fall, den dieser Test abdeckt.
  throw new Error(
    `Fuer den Probelauf fehlen: ${FEHLEND.join(', ')}. ` +
      'Auf einem Linux-Runner ist das kein Grund zum Ueberspringen.',
  );
}

const UEBERSPRINGEN =
  process.platform === 'win32'
    ? `unter Windows nicht lauffaehig (fehlt: ${FEHLEND.join(', ') || 'flock'})`
    : false;

/** Das gestellte `docker`. Schreibt jeden Aufruf mit und antwortet knapp. */
const DOCKER_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "\${DOCKER_LOG}"
alle="$*"

case "\${alle}" in
  *"exec -T postgres"*)
    # Der Abzug: irgendetwas, das wie ein Dump aussieht.
    printf -- '-- PostgreSQL database dump (Probelauf)\\n'
    ;;
  *"ps --all"*)
    printf 'backend running 0 healthy\\nfrontend running 0 healthy\\nmigrate exited 0 \\n'
    ;;
  *"ps --format"*)
    printf 'SERVICE STATUS\\nbackend Up\\n'
    ;;
  "image prune"*)
    printf 'Total reclaimed space: 0B\\n'
    ;;
  *"up -d --remove-orphans"*)
    exit "\${DOCKER_UP_EXIT:-0}"
    ;;
esac

exit 0
`;

const SAUBERE_ENV = [
  'POSTGRES_USER=palantir',
  'POSTGRES_DB=palantir',
  'POSTGRES_PASSWORD=einechtespasswort',
  'DATABASE_URL=postgresql://palantir:einechtespasswort@postgres:5432/palantir',
  'FRP_TOKEN=eintoken',
  '',
].join('\n');

function git(verzeichnis, ...argumente) {
  const lauf = spawnSync(
    'git',
    [
      '-C',
      verzeichnis,
      '-c',
      'user.email=probe@example.invalid',
      '-c',
      'user.name=Probelauf',
      ...argumente,
    ],
    { encoding: 'utf8' },
  );

  if (lauf.status !== 0) {
    throw new Error(`git ${argumente.join(' ')} scheiterte: ${lauf.stderr || lauf.stdout}`);
  }

  return lauf.stdout.trim();
}

/**
 * Baut einen Sandkasten: Ursprung mit zwei Staenden auf `main`, eine Auscheckung
 * auf dem aelteren, eine `.env` und ein gestelltes `docker`.
 */
function sandkasten({ env = SAUBERE_ENV } = {}) {
  const wurzel = mkdtempSync(path.join(tmpdir(), 'palantir-deploy-probe-'));
  const ursprung = path.join(wurzel, 'origin.git');
  const arbeit = path.join(wurzel, 'arbeit');
  const repo = path.join(wurzel, 'repo');
  const stub = path.join(wurzel, 'bin');

  spawnSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', ursprung]);
  // Ein roher SHA laesst sich nur holen, wenn der Ursprung es erlaubt - im
  // Betrieb macht das GitHub, hier muss es gesagt werden.
  spawnSync('git', ['-C', ursprung, 'config', 'uploadpack.allowAnySHA1InWant', 'true']);

  spawnSync('git', ['clone', '--quiet', ursprung, arbeit]);
  mkdirSync(path.join(arbeit, 'deploy', 'vps'), { recursive: true });
  writeFileSync(path.join(arbeit, 'deploy', 'vps', 'docker-compose.yml'), 'services: {}\n');
  writeFileSync(path.join(arbeit, 'stand.txt'), 'alt\n');
  git(arbeit, 'add', '-A');
  git(arbeit, 'commit', '--quiet', '-m', 'alter Stand');
  const alt = git(arbeit, 'rev-parse', 'HEAD');

  writeFileSync(path.join(arbeit, 'stand.txt'), 'neu\n');
  git(arbeit, 'add', '-A');
  git(arbeit, 'commit', '--quiet', '-m', 'neuer Stand');
  const neu = git(arbeit, 'rev-parse', 'HEAD');
  git(arbeit, 'push', '--quiet', 'origin', 'main');

  spawnSync('git', ['clone', '--quiet', ursprung, repo]);
  git(repo, 'checkout', '--quiet', '--detach', alt);
  writeFileSync(path.join(repo, '.env'), env);

  mkdirSync(stub, { recursive: true });
  const dockerPfad = path.join(stub, 'docker');
  writeFileSync(dockerPfad, DOCKER_STUB);
  chmodSync(dockerPfad, 0o755);

  return { wurzel, repo, stub, alt, neu, dockerLog: path.join(wurzel, 'docker.log') };
}

/** Faehrt das echte Skript gegen den Sandkasten. */
function ausrollen(kasten, ziel, zusatz = {}) {
  const lauf = spawnSync('bash', [SKRIPT, ziel], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${kasten.stub}${path.delimiter}${process.env.PATH}`,
      PALANTIR_REPO_DIR: kasten.repo,
      PALANTIR_LOCK_FILE: path.join(kasten.wurzel, 'deploy.lock'),
      DOCKER_LOG: kasten.dockerLog,
      ...zusatz,
    },
  });

  return { ...lauf, ausgabe: `${lauf.stdout}${lauf.stderr}` };
}

function abzuege(kasten) {
  const ordner = path.join(kasten.repo, 'data', 'pre-deploy');

  try {
    return readdirSync(ordner).filter((name) => name.endsWith('.sql.gz'));
  } catch {
    return [];
  }
}

function modus(pfad) {
  return (statSync(pfad).mode & 0o777).toString(8);
}

test('Probelauf deploy.sh', { skip: UEBERSPRINGEN }, async (t) => {
  await t.test('rollt aus, zieht vorher einen Abzug und schiebt die Auscheckung', () => {
    const kasten = sandkasten();

    try {
      const lauf = ausrollen(kasten, kasten.neu);

      assert.equal(lauf.status, 0, lauf.ausgabe);
      assert.match(lauf.ausgabe, /Sichere die Datenbank/);
      assert.equal(abzuege(kasten).length, 1, 'genau ein Abzug');
      assert.equal(
        git(kasten.repo, 'rev-parse', 'HEAD'),
        kasten.neu,
        'Auscheckung steht auf dem Ziel',
      );
    } finally {
      rmSync(kasten.wurzel, { recursive: true, force: true });
    }
  });

  await t.test('der Abzug entsteht VOR dem Start des Stacks', () => {
    // Die ganze Begruendung von HM-1: Eine Migration, die eine Spalte entfernt,
    // ist danach nicht mehr rueckgaengig zu machen.
    const kasten = sandkasten();

    try {
      ausrollen(kasten, kasten.neu);
      const zeilen = readdirSync(kasten.wurzel).includes('docker.log')
        ? String(spawnSync('cat', [kasten.dockerLog], { encoding: 'utf8' }).stdout).split('\n')
        : [];

      const abzugBei = zeilen.findIndex((z) => z.includes('exec -T postgres'));
      const startBei = zeilen.findIndex((z) => z.includes('up -d --remove-orphans'));

      assert.ok(abzugBei >= 0, 'der Abzug wurde ueberhaupt gezogen');
      assert.ok(startBei >= 0, 'der Stack wurde gestartet');
      assert.ok(abzugBei < startBei, 'der Abzug kam zuerst');
    } finally {
      rmSync(kasten.wurzel, { recursive: true, force: true });
    }
  });

  await t.test('Ordner und Abzug bleiben unter sich (Fundpunkt 287)', () => {
    const kasten = sandkasten();

    try {
      // Ausgangslage nachstellen: Der Ordner existiert schon und steht offen.
      const ordner = path.join(kasten.repo, 'data', 'pre-deploy');
      mkdirSync(ordner, { recursive: true });
      chmodSync(ordner, 0o755);

      ausrollen(kasten, kasten.neu);

      assert.equal(modus(ordner), '700', 'der Ordner wird zugezogen');

      for (const name of abzuege(kasten)) {
        assert.equal(modus(path.join(ordner, name)), '600', `${name} gehoert niemandem sonst`);
      }
    } finally {
      rmSync(kasten.wurzel, { recursive: true, force: true });
    }
  });

  await t.test('bricht ab, wenn die Proxy-Listen auseinanderlaufen (Review 4.7)', () => {
    const kasten = sandkasten({
      env: [
        'POSTGRES_USER=palantir',
        'POSTGRES_DB=palantir',
        'POSTGRES_PASSWORD=geheim',
        'FRP_TOKEN=geheim',
        // Traefik vertraut zwei Cloudflare-Bereichen, das Backend kennt nur einen.
        'TRAEFIK_TRUSTED_IPS=127.0.0.1/32,173.245.48.0/20, 103.21.244.0/22',
        'TRUSTED_PROXY_ADDRESSES=172.16.0.0/12,173.245.48.0/20',
        '',
      ].join('\n'),
    });

    try {
      const lauf = ausrollen(kasten, kasten.neu);

      assert.notEqual(lauf.status, 0, 'der Lauf bricht ab');
      assert.match(lauf.ausgabe, /103\.21\.244\.0\/22/);
      assert.doesNotMatch(
        lauf.ausgabe,
        /- 173\.245\.48\.0\/20/,
        'der bekannte Bereich wird nicht gemeldet',
      );
      assert.equal(
        git(kasten.repo, 'rev-parse', 'HEAD'),
        kasten.alt,
        'die Auscheckung wurde nicht angefasst',
      );
    } finally {
      rmSync(kasten.wurzel, { recursive: true, force: true });
    }
  });

  await t.test('laesst gleichlaufende Proxy-Listen und die Vorgabe durch (Review 4.7)', () => {
    const kasten = sandkasten({
      env:
        SAUBERE_ENV +
        [
          'TRAEFIK_TRUSTED_IPS=127.0.0.1/32,173.245.48.0/20',
          'TRUSTED_PROXY_ADDRESSES=172.16.0.0/12,173.245.48.0/20',
          '',
        ].join('\n'),
    });

    try {
      const lauf = ausrollen(kasten, kasten.neu);

      assert.equal(lauf.status, 0, lauf.ausgabe);
    } finally {
      rmSync(kasten.wurzel, { recursive: true, force: true });
    }
  });

  await t.test('bricht bei einem Platzhalter ab, bevor etwas passiert (Fundpunkt 283)', () => {
    const kasten = sandkasten({
      env: [
        '# POSTGRES_PASSWORD=CHANGE_ME',
        'POSTGRES_USER=palantir',
        'POSTGRES_DB=palantir',
        'POSTGRES_PASSWORD=CHANGE_ME',
        'FRP_TOKEN=CHANGE_ME',
        '',
      ].join('\n'),
    });

    try {
      const lauf = ausrollen(kasten, kasten.neu);

      assert.notEqual(lauf.status, 0, 'der Lauf bricht ab');
      assert.match(lauf.ausgabe, /POSTGRES_PASSWORD/);
      assert.match(lauf.ausgabe, /FRP_TOKEN/);
      // Nur die Namen, nie die Werte - das Protokoll landet in GitHub Actions.
      assert.equal(
        git(kasten.repo, 'rev-parse', 'HEAD'),
        kasten.alt,
        'die Auscheckung wurde nicht angefasst',
      );
      assert.equal(abzuege(kasten).length, 0, 'es wurde nichts gesichert');
    } finally {
      rmSync(kasten.wurzel, { recursive: true, force: true });
    }
  });

  await t.test('rollt die Auscheckung zurueck, wenn der Stack nicht hochkommt', () => {
    const kasten = sandkasten();

    try {
      const lauf = ausrollen(kasten, kasten.neu, { DOCKER_UP_EXIT: '1' });

      assert.notEqual(lauf.status, 0, 'der Lauf meldet den Fehlschlag');
      assert.match(lauf.ausgabe, /Setze die Auscheckung auf/);
      assert.equal(
        git(kasten.repo, 'rev-parse', 'HEAD'),
        kasten.alt,
        'die Auscheckung steht wieder auf dem alten Stand',
      );
    } finally {
      rmSync(kasten.wurzel, { recursive: true, force: true });
    }
  });

  await t.test('behaelt nur die juengsten Abzuege', () => {
    const kasten = sandkasten({
      env: `${SAUBERE_ENV}PRE_DEPLOY_DUMP_KEEP=2\n`,
    });

    try {
      const ordner = path.join(kasten.repo, 'data', 'pre-deploy');
      mkdirSync(ordner, { recursive: true });

      // Drei alte Abzuege mit klar aelteren Zeitstempeln.
      for (const [nummer, alterInTagen] of [
        ['a', 3],
        ['b', 2],
        ['c', 1],
      ]) {
        const datei = path.join(ordner, `vor-alt${nummer}-2026010${alterInTagen}T000000Z.sql.gz`);
        writeFileSync(datei, '');
        const zeit = new Date(Date.now() - alterInTagen * 86_400_000);
        utimesSync(datei, zeit, zeit);
      }

      const lauf = ausrollen(kasten, kasten.neu);

      assert.equal(lauf.status, 0, lauf.ausgabe);
      // Zwei bleiben: der neue und der juengste alte.
      assert.equal(abzuege(kasten).length, 2, `es sind ${abzuege(kasten).join(', ')}`);
      assert.ok(
        abzuege(kasten).some((name) => name.includes('altc')),
        'der juengste alte bleibt',
      );
      assert.ok(!abzuege(kasten).some((name) => name.includes('alta')), 'der aelteste ist weg');
    } finally {
      rmSync(kasten.wurzel, { recursive: true, force: true });
    }
  });

  await t.test('rollt nur Staende aus, die auf main liegen', () => {
    const kasten = sandkasten();

    try {
      // Ein Commit, den es im Ursprung gibt, der aber nicht auf main liegt.
      git(kasten.repo, 'checkout', '--quiet', '--detach', kasten.alt);
      writeFileSync(path.join(kasten.repo, 'seitenzweig.txt'), 'daneben\n');
      // Gezielt diese eine Datei: Ein `add -A` naehme die `.env` mit in den
      // Commit, und das `checkout` danach raeumte sie wieder weg - der Lauf
      // scheiterte dann an der fehlenden Datei statt am Nebenzweig.
      git(kasten.repo, 'add', 'seitenzweig.txt');
      git(kasten.repo, 'commit', '--quiet', '-m', 'Nebenzweig');
      const daneben = git(kasten.repo, 'rev-parse', 'HEAD');
      git(kasten.repo, 'push', '--quiet', 'origin', `${daneben}:refs/heads/daneben`);
      git(kasten.repo, 'checkout', '--quiet', '--detach', kasten.alt);

      const lauf = ausrollen(kasten, daneben);

      assert.notEqual(lauf.status, 0, 'der Lauf bricht ab');
      assert.match(lauf.ausgabe, /liegt nicht auf main/);
    } finally {
      rmSync(kasten.wurzel, { recursive: true, force: true });
    }
  });
});
