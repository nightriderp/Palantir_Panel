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
 * Die Schnittlisten.
 *
 * `von`/`bis` in Sekunden im jeweiligen Clip; `bis: null` heißt „bis zum
 * Ende". Die Clips blenden selbst auf und ab – für die lange Fassung reicht
 * deshalb das Aneinanderhängen, für den Trailer werden die Mittelstücke
 * genommen und hart geschnitten.
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
      { clip: '09-admin', von: 0, bis: null },
      { handy: 13.5, von: 0.8 },
      { clip: '10-abspann', von: 0, bis: null },
    ],
  },

  trailer: {
    titel: 'Palantir – Trailer',
    segmente: [
      { clip: '01-vorspann', von: 0, bis: 7.4 },
      { clip: '03-uebersicht', von: 0.8, bis: 6.0 },
      { clip: '04-erstellen', von: 1.6, bis: 7.4 },
      { clip: '05-starten', von: 0.6, bis: 8.6 },
      { clip: '05-starten', von: 15.0, bis: 21.5 },
      { luecke: 6 },
      { clip: '06-konsole', von: 6.5, bis: 12.5 },
      { clip: '07-monitoring', von: 1.0, bis: 6.0 },
      { clip: '08-backups', von: 3.0, bis: 8.5 },
      { clip: '09-admin', von: 19.5, bis: 25.0 },
      { handy: 6.5, von: 6.5 },
      { clip: '10-abspann', von: 0, bis: null },
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
  const quelle = path.join(CLIPS, '11-luecke.mp4');
  if (!fs.existsSync(quelle)) {
    throw new Error(
      'Die Tafel für die Gameplay-Lücke fehlt. Entweder eigenes Material unter ' +
        'material/gameplay.mp4 ablegen oder die Tafel aufnehmen: ' +
        'node aufnahme/aufnehmen.mjs 11-luecke',
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

  await neuerLauf(ffmpeg, [
    '-y',
    '-loglevel',
    'error',
    '-ss',
    String(segment.von ?? 0),
    ...(segment.bis === null || segment.bis === undefined ? [] : ['-to', String(segment.bis)]),
    '-i',
    quelle,
    ...KODIERUNG,
    datei,
  ]);
  return {
    datei,
    hinweis: `${segment.clip} ${String(segment.von ?? 0)}–${segment.bis === null ? 'Ende' : String(segment.bis)} s`,
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
    // Etwas leiser als erzeugt und am Ende sauber ausgeblendet.
    `[1:a]volume=-3dB,afade=t=out:st=${Math.max(0, dauer - 2.5).toFixed(2)}:d=2.5[a]`,
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
