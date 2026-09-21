/**
 * Der Telefonrahmen, in den die Handy-Aufnahme gesetzt wird.
 *
 * Erzeugt zwei Bilder für den Schnitt:
 *
 *   `rahmen.png`  – 1920×1080 mit einem **durchsichtigen Loch** an der Stelle
 *                   des Bildschirms. Es wird über das Video gelegt; das Gehäuse
 *                   deckt dabei die geraden Ecken der Aufnahme ab.
 *   `hintergrund.png` – dieselbe Größe, die Fläche hinter allem.
 *
 * Gezeichnet wird im Browser und nicht mit Zeichenbefehlen von ffmpeg: Dieser
 * ffmpeg-Bau bringt keinen Textfilter mit, und der Rahmen soll dieselbe
 * Schrift und dieselben Farben tragen wie der Rest des Videos.
 *
 * Das Loch entsteht über einen sehr großen `box-shadow` – dieselbe Technik wie
 * bei der Hervorhebung in der Aufnahme: Der Schatten füllt alles außerhalb des
 * Elements, das Element selbst bleibt durchsichtig.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HIER = path.dirname(fileURLToPath(import.meta.url));

/** Maße des Bildschirmausschnitts – müssen zur Handy-Aufnahme passen. */
export const RAHMEN = {
  breite: 1920,
  hoehe: 1080,
  /** Bildschirm: 412×915 Punkte der Aufnahme, eins zu eins übernommen. */
  schirm: { breite: 412, hoehe: 915 },
  gehaeuse: 14,
  /** Links Platz für den Text, das Telefon steht rechts. */
  links: 1205,
};

RAHMEN.oben = Math.round((RAHMEN.hoehe - RAHMEN.schirm.hoehe) / 2);

export async function zeichneRahmen(ziel = HIER) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const ctx = await browser.newContext({
    viewport: { width: RAHMEN.breite, height: RAHMEN.hoehe },
    deviceScaleFactor: 1,
  });
  const seite = await ctx.newPage();

  const { schirm, gehaeuse, links, oben } = RAHMEN;

  const seiteHtml = (durchsichtig) => `
    <html><body style="margin:0;width:${RAHMEN.breite}px;height:${RAHMEN.hoehe}px;overflow:hidden;
      font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
      ${durchsichtig ? 'background:transparent' : 'background:#05060a'}">

      ${
        durchsichtig
          ? ''
          : `<div style="position:absolute;inset:0;
               background:
                 radial-gradient(70% 60% at 78% 45%, rgba(124,92,255,.20), rgba(0,0,0,0) 70%),
                 radial-gradient(60% 50% at 20% 70%, rgba(53,200,255,.10), rgba(0,0,0,0) 70%),
                 #05060a"></div>`
      }

      <!-- Text links. Er gehört in das durchsichtige Bild, damit er über der
           Fläche liegt und nicht vom Gehäuse verdeckt wird. -->
      ${
        durchsichtig
          ? `<div style="position:absolute;left:150px;top:50%;transform:translateY(-50%);max-width:820px">
               <div style="width:74px;height:4px;border-radius:2px;
                 background:linear-gradient(90deg,#7c5cff,#35c8ff);margin-bottom:26px"></div>
               <div style="font-size:72px;line-height:1.05;font-weight:700;letter-spacing:-.025em;color:#f4f6ff">
                 Auch am Telefon
               </div>
               <div style="margin-top:22px;font-size:29px;line-height:1.5;color:#9aa3c0">
                 Dieselben Server, dieselbe Konsole – in der Hand.<br>
                 Für kleine Bildschirme gebaut, nicht zurechtgestutzt.
               </div>
             </div>`
          : ''
      }

      <!-- Das Gehäuse. Der große Schatten füllt alles außerhalb; im Inneren
           bleibt das Bild durchsichtig, dort liegt später das Video. -->
      <div style="position:absolute;
        left:${links + gehaeuse}px;top:${oben + gehaeuse}px;
        width:${schirm.breite}px;height:${schirm.hoehe}px;
        border-radius:34px;
        border:${gehaeuse}px solid #14172a;
        box-sizing:content-box;
        margin:-${gehaeuse}px;
        box-shadow:
          0 0 0 2px #262b45,
          0 0 0 ${durchsichtig ? '0' : '9999'}px ${durchsichtig ? 'transparent' : 'rgba(5,6,10,0)'},
          0 46px 90px rgba(0,0,0,.66),
          0 0 120px rgba(124,92,255,.22);
        "></div>

      <!-- Seitenknöpfe – kleine Zeichen, die den Rahmen als Telefon lesbar
           machen. Bewusst kein Lautsprecherschlitz: Der Rand ist 14 Punkte
           schmal, der Schlitz läge im Bildschirm und deckte die Oberfläche ab. -->
      ${
        durchsichtig
          ? `<div style="position:absolute;left:${links - 4}px;top:${oben + 190}px;
               width:4px;height:64px;border-radius:2px;background:#1b1f33"></div>
             <div style="position:absolute;left:${links - 4}px;top:${oben + 272}px;
               width:4px;height:104px;border-radius:2px;background:#1b1f33"></div>`
          : ''
      }
    </body></html>`;

  await seite.setContent(seiteHtml(false));
  await seite.waitForTimeout(250);
  const hintergrund = path.join(ziel, 'hintergrund.png');
  await seite.screenshot({ path: hintergrund });

  await seite.setContent(seiteHtml(true));
  await seite.waitForTimeout(250);
  const rahmen = path.join(ziel, 'rahmen.png');
  await seite.screenshot({ path: rahmen, omitBackground: true });

  await browser.close();
  return { rahmen, hintergrund };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { rahmen, hintergrund } = await zeichneRahmen(process.argv[2] ?? HIER);
  console.log(`${rahmen}\n${hintergrund}`);
}
