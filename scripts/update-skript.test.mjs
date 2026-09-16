import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

/**
 * Probelauf für `deploy/gamenode/update.sh` – die Signaturprüfung der
 * Versions-Tags (Review 2026-09-16, Befund 8.2).
 *
 * Die Node zieht ihren Stand selbst und startet danach den Agent mit
 * Docker-Zugriff neu. Bis zur Prüfung war der Zweigname `prod` der einzige
 * Vertrauensanker. Hier läuft das echte Skript gegen einen Sandkasten: ein
 * Wegwerf-Ursprung mit zwei Ständen, eine Auscheckung auf dem älteren, ein
 * frisch erzeugter SSH-Schlüssel als Unterzeichner und ein gestelltes
 * `docker`, das jeden Aufruf mitschreibt.
 *
 * Anders als `deploy-skript.test.mjs` läuft dieser Test auch unter Windows:
 * `flock` fehlt in Git Bash, wird aber nur für die Sperre gebraucht – der
 * Sandkasten stellt eines, das immer zusagt. Auf einem POSIX-Rechner ist ein
 * fehlendes Werkzeug dagegen ein Fehlschlag, kein Sprung.
 */

const HIER = path.dirname(fileURLToPath(import.meta.url));
const SKRIPT = path.resolve(HIER, '..', 'deploy', 'gamenode', 'update.sh');

function werkzeugeFehlen() {
  const fehlend = [];

  for (const [werkzeug, probe] of [
    ['bash', ['bash', ['-c', 'true']]],
    ['ssh-keygen', ['bash', ['-c', 'command -v ssh-keygen']]],
  ]) {
    const [befehl, argumente] = probe;
    const lauf = spawnSync(befehl, argumente, { encoding: 'utf8' });

    if (lauf.status !== 0) fehlend.push(werkzeug);
  }

  return fehlend;
}

const FEHLEND = werkzeugeFehlen();

if (FEHLEND.length > 0 && process.platform !== 'win32') {
  throw new Error(
    `Fuer den Probelauf fehlen: ${FEHLEND.join(', ')}. ` +
      'Auf einem Linux-Runner ist das kein Grund zum Ueberspringen.',
  );
}

const UEBERSPRINGEN = FEHLEND.length > 0 ? `fehlende Werkzeuge: ${FEHLEND.join(', ')}` : false;

/** Hat die Maschine ein echtes `flock`? Sonst stellt der Sandkasten eines. */
const FLOCK_FEHLT = spawnSync('bash', ['-c', 'command -v flock'], { encoding: 'utf8' }).status !== 0;

/** Das gestellte `docker`: schreibt mit, meldet die Dienste gesund. */
const DOCKER_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "\${DOCKER_LOG}"
alle="$*"

case "\${alle}" in
  *"ps --all --format"*)
    printf 'socket-proxy running 0 healthy\\nagent running 0 \\nfrpc running 0 \\n'
    ;;
  *"ps --format"*)
    printf 'SERVICE STATUS\\nagent Up\\n'
    ;;
  *"network inspect"*)
    exit 0
    ;;
esac

exit 0
`;

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
 * Sandkasten: Ursprung mit zwei Ständen, `prod` auf dem neueren, Auscheckung auf
 * dem älteren, zwei SSH-Schlüssel (einer zugelassen, einer fremd).
 */
function sandkasten() {
  const wurzel = mkdtempSync(path.join(tmpdir(), 'palantir-update-probe-'));
  const ursprung = path.join(wurzel, 'origin.git');
  const arbeit = path.join(wurzel, 'arbeit');
  const repo = path.join(wurzel, 'repo');
  const stub = path.join(wurzel, 'bin');
  const schluessel = path.join(wurzel, 'schluessel');

  mkdirSync(schluessel, { recursive: true });
  for (const name of ['betreiber', 'fremd']) {
    const lauf = spawnSync(
      'ssh-keygen',
      ['-q', '-t', 'ed25519', '-N', '', '-C', name, '-f', path.join(schluessel, name)],
      { encoding: 'utf8' },
    );
    if (lauf.status !== 0) throw new Error(`ssh-keygen scheiterte: ${lauf.stderr}`);
  }
  const betreiberPub = readFileSync(path.join(schluessel, 'betreiber.pub'), 'utf8').trim();
  const liste = path.join(wurzel, 'allowed_signers');
  writeFileSync(liste, `# Probelauf\nbetreiber@example.invalid namespaces="git" ${betreiberPub}\n`);
  const leereListe = path.join(wurzel, 'allowed_signers.leer');
  writeFileSync(leereListe, '# noch niemand eingetragen\n');

  spawnSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', ursprung]);
  spawnSync('git', ['clone', '--quiet', ursprung, arbeit]);
  mkdirSync(path.join(arbeit, 'deploy', 'gamenode'), { recursive: true });
  writeFileSync(path.join(arbeit, 'deploy', 'gamenode', 'docker-compose.yml'), 'services: {}\n');
  writeFileSync(path.join(arbeit, 'stand.txt'), 'alt\n');
  git(arbeit, 'add', '-A');
  git(arbeit, 'commit', '--quiet', '-m', 'alter Stand');
  const alt = git(arbeit, 'rev-parse', 'HEAD');

  writeFileSync(path.join(arbeit, 'stand.txt'), 'neu\n');
  git(arbeit, 'add', '-A');
  git(arbeit, 'commit', '--quiet', '-m', 'neuer Stand');
  const neu = git(arbeit, 'rev-parse', 'HEAD');
  git(arbeit, 'push', '--quiet', 'origin', 'main');
  git(arbeit, 'push', '--quiet', 'origin', `${neu}:refs/heads/prod`);

  spawnSync('git', ['clone', '--quiet', ursprung, repo]);
  git(repo, 'checkout', '--quiet', '--detach', alt);
  writeFileSync(path.join(repo, '.env'), 'AGENT_TOKEN=probe\n');

  mkdirSync(stub, { recursive: true });
  const dockerPfad = path.join(stub, 'docker');
  writeFileSync(dockerPfad, DOCKER_STUB);
  chmodSync(dockerPfad, 0o755);
  if (FLOCK_FEHLT) {
    const flockPfad = path.join(stub, 'flock');
    writeFileSync(flockPfad, '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(flockPfad, 0o755);
  }

  /** Signiert ein Tag auf dem neuen Stand mit dem genannten Schlüssel. */
  function signiere(tag, wer) {
    git(
      arbeit,
      '-c',
      'gpg.format=ssh',
      '-c',
      `user.signingkey=${path.join(schluessel, wer)}`,
      'tag',
      '-s',
      '-m',
      `Fassung ${tag}`,
      tag,
      neu,
    );
    git(arbeit, 'push', '--quiet', 'origin', `refs/tags/${tag}`);
  }

  return { wurzel, repo, stub, alt, neu, liste, leereListe, signiere, dockerLog: path.join(wurzel, 'docker.log') };
}

function aktualisieren(kasten, zusatz = {}) {
  const lauf = spawnSync('bash', [SKRIPT], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${kasten.stub}${path.delimiter}${process.env.PATH}`,
      PALANTIR_REPO_DIR: kasten.repo,
      PALANTIR_LOCK_FILE: path.join(kasten.wurzel, 'update.lock'),
      PALANTIR_ALLOWED_SIGNERS: kasten.liste,
      DOCKER_LOG: kasten.dockerLog,
      ...zusatz,
    },
  });

  return { ...lauf, ausgabe: `${lauf.stdout}${lauf.stderr}` };
}

test('Probelauf update.sh – Tag-Signatur', { skip: UEBERSPRINGEN }, async (t) => {
  await t.test('zieht einen Stand mit signiertem Tag und startet die Dienste', () => {
    const kasten = sandkasten();

    try {
      kasten.signiere('v9.9.0', 'betreiber');
      const lauf = aktualisieren(kasten);

      assert.equal(lauf.status, 0, lauf.ausgabe);
      assert.match(lauf.ausgabe, /Signatur geprueft: v9\.9\.0/);
      assert.equal(git(kasten.repo, 'rev-parse', 'HEAD'), kasten.neu);
      assert.match(readFileSync(kasten.dockerLog, 'utf8'), /up -d/);
    } finally {
      rmSync(kasten.wurzel, { recursive: true, force: true });
    }
  });

  await t.test('lehnt einen Stand ohne Tag ab, bevor etwas ausgecheckt wird', () => {
    const kasten = sandkasten();

    try {
      const lauf = aktualisieren(kasten);

      assert.notEqual(lauf.status, 0, lauf.ausgabe);
      assert.match(lauf.ausgabe, /zeigt kein Versions-Tag/);
      assert.equal(git(kasten.repo, 'rev-parse', 'HEAD'), kasten.alt, 'Auscheckung unveraendert');
      assert.throws(() => readFileSync(kasten.dockerLog), 'docker wurde nie gerufen');
    } finally {
      rmSync(kasten.wurzel, { recursive: true, force: true });
    }
  });

  await t.test('lehnt ein Tag eines fremden Schluessels ab', () => {
    const kasten = sandkasten();

    try {
      kasten.signiere('v9.9.1', 'fremd');
      const lauf = aktualisieren(kasten);

      assert.notEqual(lauf.status, 0, lauf.ausgabe);
      assert.match(lauf.ausgabe, /traegt eine gueltige Signatur eines zugelassenen Unterzeichners/);
      assert.equal(git(kasten.repo, 'rev-parse', 'HEAD'), kasten.alt);
    } finally {
      rmSync(kasten.wurzel, { recursive: true, force: true });
    }
  });

  await t.test('warnt ohne eingetragene Unterzeichner und zieht trotzdem', () => {
    // Der Uebergang: Solange niemand einen Schluessel eingetragen hat, darf
    // die Node nicht stumm stehen bleiben - sie sagt bei jedem Lauf, was fehlt.
    const kasten = sandkasten();

    try {
      const lauf = aktualisieren(kasten, { PALANTIR_ALLOWED_SIGNERS: kasten.leereListe });

      assert.equal(lauf.status, 0, lauf.ausgabe);
      assert.match(lauf.ausgabe, /WARNUNG: Keine zugelassenen Unterzeichner/);
      assert.equal(git(kasten.repo, 'rev-parse', 'HEAD'), kasten.neu);
    } finally {
      rmSync(kasten.wurzel, { recursive: true, force: true });
    }
  });
});
