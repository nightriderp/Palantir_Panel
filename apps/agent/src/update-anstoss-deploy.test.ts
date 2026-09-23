import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ANSTOSS_DATEI } from './update-anstoss.js';

/**
 * Die Klingel der Selbstaktualisierung über alle Stellen hinweg (Gefundener
 * Punkt 342): Agent-Umgebung, Bind-Mount, systemd-Pfad-Unit und `update.sh`
 * müssen denselben Pfad nennen - sonst legt der Agent die Datei ab, und niemand
 * sieht sie. Dazu läuft `update.sh` unter Linux echt, gegen ein Wegwerf-Repo.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const gamenode = path.join(repoRoot, 'deploy', 'gamenode');
const lies = (datei: string): string => readFileSync(path.join(gamenode, datei), 'utf8');

const ORDNER = '/srv/palantir/update-anstoss';

describe('Klingel: Pfade und Units', () => {
  it('hat keinen Timer mehr', () => {
    expect(existsSync(path.join(gamenode, 'palantir-update.timer'))).toBe(false);
    expect(lies('palantir-update.service')).not.toMatch(/^[^#]*\.timer/m);
  });

  it('nennt ueberall denselben Anstoss-Ordner', () => {
    const compose = lies('docker-compose.yml');

    expect(compose).toContain(`AGENT_UPDATE_SIGNAL_DIR: ${ORDNER}`);
    expect(compose).toContain(`- ${ORDNER}:${ORDNER}\n`);
    expect(lies('palantir-update.path')).toContain(
      `PathExists=${ORDNER}/${ANSTOSS_DATEI}\nUnit=palantir-update.service`,
    );
    expect(lies('update.sh')).toContain(
      `ANSTOSS="\${PALANTIR_ANSTOSS_DATEI:-${ORDNER}/${ANSTOSS_DATEI}}"`,
    );
  });

  it('haengt den Ordner nicht schreibgeschuetzt und nicht breiter ein als noetig', () => {
    // Genau dieser eine Ordner - kein Elternordner, der mehr freigaebe.
    const mounts = lies('docker-compose.yml')
      .split('\n')
      .filter((zeile) => zeile.includes('update-anstoss') && /^\s*- /.test(zeile));

    expect(mounts).toEqual([`      - ${ORDNER}:${ORDNER}`]);
  });

  it('startet den Dienst nur ueber die Pfad-Unit, nicht von selbst', () => {
    expect(lies('palantir-update.service')).not.toMatch(/^\[Install\]/m);
    expect(lies('palantir-update.path')).toMatch(/^\[Install\]\nWantedBy=paths\.target$/m);
  });

  it('raeumt die Markierung vor der Sperre weg', () => {
    // Sonst startete die Pfad-Unit den Dienst in einer Schleife neu, solange
    // ein Lauf von Hand die Sperre haelt.
    const skript = lies('update.sh');

    const entfernen = skript.indexOf('rm -rf -- "${ANSTOSS}"');

    expect(entfernen).toBeGreaterThan(0);
    // Die Zeile selbst, nicht die Erwaehnung im Kommentar darueber.
    expect(entfernen).toBeLessThan(skript.search(/^exec 9>/m));
  });
});

/** Bash, Git und flock gibt es in der CI (Linux), auf Windows nicht verlässlich. */
const linux =
  process.platform === 'linux' &&
  spawnSync('flock', ['--version']).status === 0 &&
  spawnSync('git', ['--version']).status === 0;

describe.skipIf(!linux)('update.sh nach einem Anstoss', () => {
  let tmp: string;
  let repo: string;
  let anstoss: string;
  let commitA: string;

  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd,
      encoding: 'utf8',
    }).trim();

  function lauf(): { status: number | null; ausgabe: string } {
    const ergebnis = spawnSync('bash', [path.join(gamenode, 'update.sh')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PALANTIR_REPO_DIR: repo,
        PALANTIR_LOCK_FILE: path.join(tmp, 'update.lock'),
        PALANTIR_ANSTOSS_DATEI: anstoss,
        PALANTIR_ANSTOSS_WARTEN: '2',
        PALANTIR_ANSTOSS_TAKT: '1',
      },
    });

    return { status: ergebnis.status, ausgabe: `${ergebnis.stdout}${ergebnis.stderr}` };
  }

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'palantir-update-sh-'));
    const quelle = path.join(tmp, 'quelle');
    const ursprung = path.join(tmp, 'ursprung.git');
    repo = path.join(tmp, 'repo');
    anstoss = path.join(tmp, ANSTOSS_DATEI);

    execFileSync('git', ['init', '-q', '-b', 'prod', quelle]);
    git(quelle, 'commit', '-q', '--allow-empty', '-m', 'A');
    commitA = git(quelle, 'rev-parse', 'HEAD');
    execFileSync('git', ['clone', '-q', '--bare', quelle, ursprung]);
    execFileSync('git', ['clone', '-q', ursprung, repo]);
    git(repo, 'checkout', '-q', '--detach', commitA);
    writeFileSync(path.join(repo, '.env'), '');
    writeFileSync(path.join(repo, '.deployed-sha'), `${commitA}\n`);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('bleibt ohne Anstoss beim unveraenderten Stand', () => {
    const { status, ausgabe } = lauf();

    expect(status).toBe(0);
    expect(ausgabe).toContain('nichts zu tun');
    expect(ausgabe).not.toContain('Anstoss vom Backend');
  });

  it('raeumt die Markierung weg und wartet nicht, wenn der angekuendigte Stand schon laeuft', () => {
    writeFileSync(anstoss, `${commitA}\n`);

    const { status, ausgabe } = lauf();

    expect(status).toBe(0);
    expect(existsSync(anstoss)).toBe(false);
    expect(ausgabe).toContain('Anstoss vom Backend');
    expect(ausgabe).not.toContain('Warte bis zu');
    expect(ausgabe).toContain('nichts zu tun');
  });

  it('wartet begrenzt auf einen angekuendigten Stand, den prod noch nicht hat', () => {
    writeFileSync(anstoss, `${'b'.repeat(40)}\n`);

    const { status, ausgabe } = lauf();

    expect(status).toBe(0);
    expect(existsSync(anstoss)).toBe(false);
    expect(ausgabe).toContain('Warte bis zu 2 s');
    expect(ausgabe).toContain('weiter auf');
    // Nach dem Warten entscheidet wie immer allein `prod` - hier unveraendert.
    expect(ausgabe).toContain('nichts zu tun');
  });

  it('nimmt einen unbrauchbaren Inhalt als Anstoss ohne Hinweis', () => {
    writeFileSync(anstoss, '$(touch /tmp/palantir-boese)\n');

    const { status, ausgabe } = lauf();

    expect(status).toBe(0);
    expect(existsSync(anstoss)).toBe(false);
    expect(ausgabe).not.toContain('Warte bis zu');
    expect(existsSync('/tmp/palantir-boese')).toBe(false);
  });

  it('folgt keinem Symlink und raeumt auch ein Verzeichnis weg', () => {
    // Ein uebernommener Agent koennte root sonst eine fremde Datei vorlesen
    // lassen - oder die Pfad-Unit mit einem Verzeichnis in eine Schleife
    // schicken.
    const fremd = path.join(tmp, 'fremd');
    writeFileSync(
      fremd,
      `${'c'.repeat(40)}
`,
    );
    symlinkSync(fremd, anstoss);

    const mitLink = lauf();

    expect(mitLink.status).toBe(0);
    expect(existsSync(anstoss)).toBe(false);
    expect(existsSync(fremd)).toBe(true);
    expect(mitLink.ausgabe).not.toContain('cccccccccccc');

    mkdirSync(anstoss);

    expect(lauf().status).toBe(0);
    expect(existsSync(anstoss)).toBe(false);
  });
});
