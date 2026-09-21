/**
 * Schnitt: aus den Clips die fertigen Fassungen bauen.
 *
 *     node schnitt/schneiden.mjs            # alle Fassungen
 *     node schnitt/schneiden.mjs trailer    # nur diese
 *
 * Es entstehen je Fassung zwei Dateien: eine mit der erzeugten Musik und eine
 * stumme zum Selbstvertonen.
 *
 * **Die Lücke für euer Spielmaterial.** An einer Stelle sieht man im Panel den
 * Server starten und die Adresse – was danach im Spiel passiert, kann diese
 * Maschine nicht aufnehmen (kein Spiel-Client, keine Grafikkarte). Dafür ist im
 * Schnitt ein Platz vorgesehen: Liegt `material/gameplay.mp4` vor, wird sie
 * dort eingesetzt; sonst steht dort eine Tafel, die den Platz hält.
 *
 * Geschnitten wird in zwei Schritten: Jedes Segment wird einzeln mit
 * identischen Einstellungen kodiert, danach werden die Teile ohne erneutes
 * Kodieren aneinandergehängt. Das ist unempfindlicher als ein einziger großer
 * Filtergraph und lässt sich Stück für Stück prüfen.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPfad from 'ffmpeg-static';
import { neuerLauf } from '../aufnahme/regie.mjs';
import { erzeugeMusik, schreibeWav } from './musik.mjs';
import { RAHMEN, zeichneRahmen } from './telefonrahmen.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const WURZEL = path.resolve(HIER, '..');
const CLIPS = path.join(WURZEL, 'aufnahmen');
const ZIEL = path.join(WURZEL, 'fassungen');
const ARBEIT = path.join(ZIEL, '.teile');
const MATERIAL = path.join(WURZEL, 'material');

const BILDRATE = 30;
const KODIERUNG = [
  '-c:v',
  'libx264',
  '-preset',
  'slow',
  '-crf',
  '18',
  '-pix_fmt',
  'yuv420p',
  '-r',
  String(BILDRATE),
  '-vsync',
  'cfr',
  '-an',
];

/**
 * Die Schnittlisten – vier Fassungen aus demselben Material.
 *
 * `von`/`bis` in Sekunden im jeweiligen Clip; `bis: null` heißt „bis zum
 * Ende". Die Clips blenden selbst auf und ab – für die langen Fassungen
 * reicht deshalb das Aneinanderhängen, für Trailer und Mischung werden die
 * Mittelstücke genommen und hart geschnitten.
 *
 * Besondere Segmente statt `clip`:
 *
 * - `{ luecke: 8 }`        – Platz für euer Spielmaterial (oder die Tafel)
 * - `{ handy: 13, von: 1 }`– die Hochformat-Aufnahme im Telefonrahmen
 * - `{ …, tempo: 2 }`      – dasselbe Segment im Zeitraffer
 *
 * ---
 *
 * **Die drei bestellten Videos.**
 *
 * 1. `tour` und `trailer` – die Bildschirmaufnahme, lang und kurz. Was das
 *    Panel tut, aus der Sicht eines Kontos mit der Rolle „Nutzer".
 * 2. `motion` – der Motion-Film aus `motion/film.mjs`: Standbilder,
 *    Schnitt auf den Takt, große Schrift. Kein einziges Bild davon ist
 *    aufgenommen; alles ist inszeniert.
 * 3. `mix` – beides. Der Motion-Auftakt eröffnet, dann übernimmt echtes
 *    Panel-Material, der Motion-Abbinder schließt. Die Motion-Abschnitte
 *    sind die Kapitelmarken, die Aufnahme ist der Beleg.
 *
 * Die Zeitangaben stammen aus den Drehbüchern und werden nach dem ersten
 * vollständigen Aufnahmelauf an den fertigen Clips nachgezogen – ein Segment,
 * das über das Ende seines Clips hinausgeht, endet schlicht dort.
 */
const FASSUNGEN = {
  tour: {
    titel: 'Palantir – Rundgang',
    segmente: [
      { clip: '01-vorspann', von: 0, bis: null },
      { clip: '02-anmelden', von: 0, bis: null },
      { clip: '03-uebersicht', von: 0, bis: null },
      // Der Assistent ist der längste Teil; die Optionen-Strecke wird gekürzt.
      { clip: '04-erstellen', von: 0, bis: 13.5 },
      { clip: '04-erstellen', von: 17.5, bis: null },
      { clip: '05-starten', von: 0, bis: null },
      { luecke: 8 },
      { clip: '06-konsole', von: 0, bis: null },
      { clip: '07-monitoring', von: 0, bis: null },
      { clip: '08-backups', von: 0, bis: null },
      { clip: '09-teilen', von: 0, bis: null },
      { clip: '10-drumherum', von: 0, bis: null },
      { clip: '11-themes', von: 0, bis: null },
      { handy: 13.5, von: 0.8 },
      { clip: '14-abspann', von: 0, bis: null },
    ],
  },

  trailer: {
    titel: 'Palantir – Trailer',
    segmente: [
      { clip: '01-vorspann', von: 0, bis: 7.4 },
      { clip: '03-uebersicht', von: 0.6, bis: 5.4 },
      // Das Ausfüllen des Assistenten im Zeitraffer: gehört dazu, aber
      // niemand will es in Echtzeit sehen.
      { clip: '04-erstellen', von: 1.6, bis: 13.0, tempo: 2 },
      { clip: '04-erstellen', von: 26.0, bis: null },
      { clip: '05-starten', von: 0.6, bis: 8.6 },
      { clip: '05-starten', von: 15.0, bis: 21.5 },
      { luecke: 6 },
      { clip: '06-konsole', von: 6.5, bis: 12.5 },
      { clip: '07-monitoring', von: 1.0, bis: 6.0 },
      { clip: '08-backups', von: 3.0, bis: 8.5 },
      { clip: '09-teilen', von: 5.0, bis: 10.0 },
      { clip: '10-drumherum', von: 6.0, bis: 12.0 },
      { clip: '11-themes', von: 4.0, bis: 10.5 },
      { handy: 6.5, von: 6.5 },
      { clip: '14-abspann', von: 0, bis: null },
    ],
  },

  motion: {
    titel: 'Palantir – Motion',
    segmente: [
      { clip: '20-auftakt', von: 0, bis: null },
      { clip: '21-koennen', von: 0, bis: null },
      { clip: '22-ohne', von: 0, bis: null },
      { clip: '23-marke', von: 0, bis: null },
    ],
  },

  mix: {
    titel: 'Palantir – Mischung',
    /*
     * Die Beats aus `21-koennen` sind hier die Kapitelmarken: Jeder dauert
     * zwei Takte (2,79 s), der erste beginnt bei 0,26 s. Ein Beat sagt, was
     * gleich kommt – danach zeigt die Aufnahme, dass es stimmt.
     */
    segmente: [
      // Auftakt: der Motion-Vorspann.
      { clip: '20-auftakt', von: 0, bis: 12.5 },

      // Kapitel 1: anlegen und starten.
      { clip: '21-koennen', von: 0, bis: 3.05 },
      { clip: '04-erstellen', von: 1.6, bis: 13.0, tempo: 2 },
      { clip: '04-erstellen', von: 26.0, bis: null },
      { clip: '21-koennen', von: 3.05, bis: 5.84 },
      { clip: '05-starten', von: 0.6, bis: 9.0 },
      { clip: '05-starten', von: 15.0, bis: 22.0 },
      { luecke: 7 },

      // Kapitel 2: im Betrieb.
      { clip: '21-koennen', von: 5.84, bis: 11.42 },
      { clip: '06-konsole', von: 6.5, bis: 14.0 },
      { clip: '07-monitoring', von: 1.0, bis: 6.5 },
      { clip: '21-koennen', von: 11.42, bis: 14.21 },
      { clip: '08-backups', von: 3.0, bis: 9.0 },

      // Kapitel 3: teilen und am Telefon.
      { clip: '21-koennen', von: 14.21, bis: 17.0 },
      { clip: '09-teilen', von: 5.0, bis: 11.0 },
      { clip: '21-koennen', von: 17.0, bis: 19.79 },
      { handy: 7.0, von: 6.5 },

      // Kapitel 4: das Drumherum und die Themes.
      { clip: '21-koennen', von: 19.79, bis: 28.16 },
      { clip: '10-drumherum', von: 6.0, bis: 13.0 },
      { clip: '21-koennen', von: 28.16, bis: 30.95 },
      { clip: '11-themes', von: 4.0, bis: 11.0 },

      // Schluss: der helle Teil und der Abbinder – beides aus dem Motion-Film.
      { clip: '22-ohne', von: 0, bis: null },
      { clip: '23-marke', von: 0, bis: null },
    ],
  },
};

const ffmpeg = process.env.FFMPEG ?? ffmpegPfad;

/**
 * Die Tafel, die den Platz für euer Spielmaterial hält.
 *
 * Sie ist ein aufgenommener Clip (`11-luecke`), keine im Schnitt gesetzte
 * Schrift: Der mitgelieferte ffmpeg-Bau hat keinen `drawtext`-Filter, und die
 * Tafel soll dieselbe Schrift tragen wie die Titel des Videos.
 */
async function tafelBauen(datei, sekunden) {
  const quelle = path.join(CLIPS, '13-luecke.mp4');
  if (!fs.existsSync(quelle)) {
    throw new Error(
      'Die Tafel für die Gameplay-Lücke fehlt. Entweder eigenes Material unter ' +
        'material/gameplay.mp4 ablegen oder die Tafel aufnehmen: ' +
        'node aufnahme/aufnehmen.mjs 13-luecke',
    );
  }
  await neuerLauf(ffmpeg, [
    '-y',
    '-loglevel',
    'error',
    '-t',
    String(sekunden),
    '-i',
    quelle,
    ...KODIERUNG,
    datei,
  ]);
}

/**
 * Die Handy-Aufnahme in den Telefonrahmen setzen.
 *
 * Drei Ebenen: die Fläche, darauf das Video an der Stelle des Bildschirms,
 * darüber der Rahmen mit dem durchsichtigen Loch. Das Gehäuse deckt so die
 * geraden Ecken der Aufnahme ab – ein Video hat keine runden Ecken.
 */
let rahmenBilder = null;

async function handyBauen(datei, sekunden, von = 0) {
  const quelle = path.join(CLIPS, '12-handy.mp4');
  if (!fs.existsSync(quelle)) {
    throw new Error('Die Handy-Aufnahme fehlt: node aufnahme/aufnehmen.mjs 12-handy');
  }
  if (rahmenBilder === null) rahmenBilder = await zeichneRahmen(ARBEIT);

  const x = RAHMEN.links + RAHMEN.gehaeuse;
  const y = RAHMEN.oben + RAHMEN.gehaeuse;

  await neuerLauf(ffmpeg, [
    '-y',
    '-loglevel',
    'error',
    '-ss',
    String(von),
    '-t',
    String(sekunden),
    '-i',
    quelle,
    '-i',
    rahmenBilder.hintergrund,
    '-i',
    rahmenBilder.rahmen,
    '-filter_complex',
    [
      `[0:v]scale=${String(RAHMEN.schirm.breite)}:${String(RAHMEN.schirm.hoehe)}[schirm]`,
      `[1:v][schirm]overlay=${String(x)}:${String(y)}[mit]`,
      `[mit][2:v]overlay=0:0[voll]`,
      `[voll]fade=t=in:st=0:d=0.5,fade=t=out:st=${Math.max(0, sekunden - 0.5).toFixed(2)}:d=0.5[aus]`,
    ].join(';'),
    '-map',
    '[aus]',
    ...KODIERUNG,
    datei,
  ]);
}

/** Euer eigenes Spielmaterial auf Format und Länge bringen. */
async function gameplayBauen(datei, sekunden, quelle) {
  await neuerLauf(ffmpeg, [
    '-y',
    '-loglevel',
    'error',
    '-i',
    quelle,
    '-t',
    String(sekunden),
    '-vf',
    [
      'scale=1920:1080:force_original_aspect_ratio=decrease',
      'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x05060a',
      'fade=t=in:st=0:d=0.4',
      `fade=t=out:st=${Math.max(0, sekunden - 0.4).toFixed(2)}:d=0.4`,
    ].join(','),
    ...KODIERUNG,
    datei,
  ]);
}

async function segmentBauen(segment, nummer) {
  const datei = path.join(ARBEIT, `${String(nummer).padStart(2, '0')}.mp4`);

  if (segment.handy !== undefined) {
    await handyBauen(datei, segment.handy, segment.von ?? 0);
    return { datei, hinweis: `Telefonrahmen mit 12-handy (${segment.handy} s)` };
  }

  if (segment.luecke !== undefined) {
    const eigenes = ['mp4', 'mov', 'mkv', 'webm']
      .map((endung) => path.join(MATERIAL, `gameplay.${endung}`))
      .find((pfad) => fs.existsSync(pfad));

    if (eigenes === undefined) {
      await tafelBauen(datei, segment.luecke);
      return { datei, hinweis: `Tafel (${segment.luecke} s) – kein eigenes Material gefunden` };
    }
    await gameplayBauen(datei, segment.luecke, eigenes);
    return { datei, hinweis: `${path.basename(eigenes)} (${segment.luecke} s)` };
  }

  const quelle = path.join(CLIPS, `${segment.clip}.mp4`);
  if (!fs.existsSync(quelle)) {
    throw new Error(
      `Clip fehlt: ${segment.clip}.mp4 – erst aufnehmen (node aufnahme/aufnehmen.mjs ${segment.clip}).`,
    );
  }

  /*
   * `tempo` rafft ein Segment. Gedacht für Strecken, die dazugehören, aber
   * niemanden in Echtzeit interessieren - das Ausfüllen eines Formulars etwa.
   * Bild für Bild aufgenommen, hier im Zeitraffer gezeigt.
   */
  const tempo = segment.tempo ?? 1;
  await neuerLauf(ffmpeg, [
    '-y',
    '-loglevel',
    'error',
    '-ss',
    String(segment.von ?? 0),
    ...(segment.bis === null || segment.bis === undefined ? [] : ['-to', String(segment.bis)]),
    '-i',
    quelle,
    ...(tempo === 1 ? [] : ['-vf', `setpts=PTS/${String(tempo)}`]),
    ...KODIERUNG,
    datei,
  ]);
  return {
    datei,
    hinweis:
      `${segment.clip} ${String(segment.von ?? 0)}–${segment.bis === null ? 'Ende' : String(segment.bis)} s` +
      (tempo === 1 ? '' : ` (${String(tempo)}x)`),
  };
}

/** Dauer einer Datei in Sekunden, gelesen aus der Ausgabe von ffmpeg. */
async function dauerVon(datei) {
  const { spawn } = await import('node:child_process');
  return new Promise((loesen) => {
    const lauf = spawn(ffmpeg, ['-i', datei, '-f', 'null', '-']);
    let text = '';
    lauf.stderr.on('data', (stueck) => (text += String(stueck)));
    lauf.on('close', () => {
      const treffer = /time=(\d+):(\d+):(\d+\.\d+)/g;
      let letzte = null;
      let m;
      while ((m = treffer.exec(text)) !== null) letzte = m;
      loesen(
        letzte === null ? 0 : Number(letzte[1]) * 3600 + Number(letzte[2]) * 60 + Number(letzte[3]),
      );
    });
  });
}

async function fassungBauen(name) {
  const fassung = FASSUNGEN[name];
  if (!fassung) {
    throw new Error(`Unbekannte Fassung „${name}". Bekannt: ${Object.keys(FASSUNGEN).join(', ')}`);
  }

  console.log(`\n=== ${fassung.titel} ===`);
  // Die Rahmenbilder liegen im Arbeitsordner und werden mit ihm gelöscht –
  // die gemerkten Pfade zeigen sonst beim zweiten Durchlauf ins Leere.
  rahmenBilder = null;
  fs.rmSync(ARBEIT, { recursive: true, force: true });
  fs.mkdirSync(ARBEIT, { recursive: true });
  fs.mkdirSync(ZIEL, { recursive: true });

  const teile = [];
  for (const [i, segment] of fassung.segmente.entries()) {
    const { datei, hinweis } = await segmentBauen(segment, i);
    teile.push(datei);
    console.log(`  ${String(i + 1).padStart(2)}. ${hinweis}`);
  }

  const liste = path.join(ARBEIT, 'liste.txt');
  fs.writeFileSync(liste, teile.map((d) => `file '${d}'`).join('\n'));

  const stumm = path.join(ZIEL, `palantir-${name}-stumm.mp4`);
  await neuerLauf(ffmpeg, [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    liste,
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    stumm,
  ]);

  const dauer = await dauerVon(stumm);
  console.log(`  → ${path.basename(stumm)} (${dauer.toFixed(1)} s)`);

  // Musik genau auf die Länge des Schnitts erzeugen, damit sie zum Schluss
  // ausklingt statt abgeschnitten zu werden.
  const eigeneMusik = ['wav', 'mp3', 'm4a', 'flac', 'ogg']
    .map((endung) => path.join(MATERIAL, `musik.${endung}`))
    .find((pfad) => fs.existsSync(pfad));

  const musikDatei = eigeneMusik ?? path.join(ARBEIT, 'musik.wav');
  if (eigeneMusik === undefined) {
    schreibeWav(musikDatei, erzeugeMusik(dauer));
  } else {
    console.log(`  Musik: ${path.basename(eigeneMusik)} (eigene Datei)`);
  }

  const mitMusik = path.join(ZIEL, `palantir-${name}.mp4`);
  await neuerLauf(ffmpeg, [
    '-y',
    '-loglevel',
    'error',
    '-i',
    stumm,
    '-i',
    musikDatei,
    '-filter_complex',
    // Nur leicht abgesenkt: Das Stück ist ein Opening, kein Teppich – es
    // darf tragen. Am Ende sauber ausgeblendet.
    `[1:a]volume=-1dB,afade=t=out:st=${Math.max(0, dauer - 2.5).toFixed(2)}:d=2.5[a]`,
    '-map',
    '0:v',
    '-map',
    '[a]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-movflags',
    '+faststart',
    mitMusik,
  ]);
  console.log(`  → ${path.basename(mitMusik)} (mit Musik)`);

  fs.rmSync(ARBEIT, { recursive: true, force: true });
  return { stumm, mitMusik, dauer };
}

async function main() {
  const gewuenscht = process.argv.slice(2);
  const namen = gewuenscht.length === 0 ? Object.keys(FASSUNGEN) : gewuenscht;

  const ergebnisse = [];
  for (const name of namen) {
    ergebnisse.push({ name, ...(await fassungBauen(name)) });
  }

  console.log('\nFertig:');
  for (const e of ergebnisse) {
    console.log(
      `  ${e.name.padEnd(8)} ${e.dauer.toFixed(1)} s   ${path.relative(WURZEL, e.mitMusik)}`,
    );
  }
}

main().catch((fehler) => {
  console.error('\nSchnitt abgebrochen:', fehler.message);
  process.exit(1);
});
