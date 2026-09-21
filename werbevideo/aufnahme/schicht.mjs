/**
 * Die Regie-Schicht im Browser.
 *
 * Wird als Init-Skript in jedes Dokument gelegt und überlebt damit jeden
 * Seitenwechsel. Sie stellt zwei Dinge bereit:
 *
 *  1. **Die Kamera.** Ein `transform` auf `<body>`. Chromium rastert die Seite
 *     beim Bildschirmfoto in der Zielskalierung neu – ein Zoom ist deshalb
 *     gestochen scharf und nicht hochgerechnet. Deshalb wird die Kamera auch
 *     nicht im Schnitt gefahren, sondern hier.
 *  2. **Alles, was über der Seite liegt:** Blende, Titel, Untertitel,
 *     Mauszeiger und Klickring. Diese Schicht hängt bewusst **neben** `<body>`
 *     am Wurzelelement – läge sie darin, würde die Kamera sie mitzoomen, und
 *     ein Titel würde beim Heranfahren mitwachsen.
 *
 * Jedes Einzelbild setzt die Aufnahme den vollständigen Zustand über
 * `__regie.setze(...)`. Nichts hier animiert von selbst: Sonst liefe die
 * Bewegung nach der Wanduhr, während die Aufnahme in Einzelbildern arbeitet.
 */

export function schichtSkript() {
  return `(${aufbau.toString()})();`;
}

function aufbau() {
  const KENNUNG = '__regie_schicht';

  const zustand = {
    kamera: { zoom: 1, x: 0, y: 0 },
    blende: 0,
    titel: null,
    untertitel: null,
    zeiger: null,
    ring: null,
    markierung: null,
  };

  function schichtBauen() {
    const vorhanden = document.getElementById(KENNUNG);
    if (vorhanden) return vorhanden;
    if (!document.body) return null;

    const stil = document.createElement('style');
    stil.textContent = `
      #${KENNUNG} {
        position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        overflow: hidden;
      }
      #${KENNUNG} .blende { position: absolute; inset: 0; background: #05060a; }
      #${KENNUNG} .titel {
        position: absolute; inset: 0; display: flex; flex-direction: column;
        align-items: center; justify-content: center; gap: 18px;
        background: radial-gradient(120% 90% at 50% 45%, rgba(10,12,22,.68), rgba(5,6,10,.92));
      }
      #${KENNUNG} .titel .strich {
        width: 74px; height: 4px; border-radius: 2px;
        background: linear-gradient(90deg, #7c5cff, #35c8ff);
      }
      #${KENNUNG} .titel h1 {
        margin: 0; font-size: 76px; line-height: 1.05; font-weight: 700; letter-spacing: -.025em;
        color: #f4f6ff; text-align: center; max-width: 1400px;
      }
      #${KENNUNG} .titel p {
        margin: 0; font-size: 27px; font-weight: 400; color: #9aa3c0; text-align: center;
        max-width: 1100px; line-height: 1.45;
      }
      #${KENNUNG} .untertitel {
        position: absolute; left: 50%; bottom: 86px; transform: translateX(-50%);
        display: flex; align-items: center; gap: 14px;
        padding: 16px 30px; border-radius: 16px;
        background: rgba(10,12,20,.82); border: 1px solid rgba(124,92,255,.32);
        box-shadow: 0 24px 60px rgba(0,0,0,.55);
        color: #eef1ff; font-size: 30px; font-weight: 500; letter-spacing: -.01em;
        white-space: nowrap;
      }
      #${KENNUNG} .untertitel .punkt {
        width: 10px; height: 10px; border-radius: 50%; flex: none;
        background: linear-gradient(135deg, #7c5cff, #35c8ff);
      }
      #${KENNUNG} .markierung {
        position: absolute; border-radius: 16px;
        border: 2px solid rgba(124,92,255,.9);
        box-shadow: 0 0 0 9999px rgba(4,5,10,.55), 0 0 38px rgba(124,92,255,.55);
      }
      #${KENNUNG} .ring {
        position: absolute; border-radius: 50%; border: 3px solid rgba(124,92,255,.95);
        background: radial-gradient(circle, rgba(124,92,255,.22), rgba(124,92,255,0) 70%);
        transform: translate(-50%, -50%);
      }
      #${KENNUNG} .zeiger { position: absolute; transform: translate(-3px, -2px); }
      /* Das Entwickler-Abzeichen von Next.js gehört in kein Video. */
      nextjs-portal, #__next-build-watcher, [data-nextjs-toast] { display: none !important; }
    `;

    const schicht = document.createElement('div');
    schicht.id = KENNUNG;
    schicht.innerHTML = `
      <div class="markierung" style="display:none"></div>
      <div class="ring" style="display:none"></div>
      <div class="titel" style="display:none">
        <div class="strich"></div><h1></h1><p></p>
      </div>
      <div class="untertitel" style="display:none"><span class="punkt"></span><span class="text"></span></div>
      <div class="blende" style="opacity:0"></div>
      <svg class="zeiger" width="30" height="42" viewBox="0 0 30 42" style="display:none">
        <path d="M4 2 L4 32 L11.5 25 L16.5 37 L21.5 35 L16.5 23.5 L26 23 Z"
              fill="#ffffff" stroke="rgba(8,10,18,.85)" stroke-width="2.2" stroke-linejoin="round"/>
      </svg>
    `;

    (document.head ?? document.documentElement).appendChild(stil);
    document.documentElement.appendChild(schicht);
    /*
     * Bewusst **kein** `overflow: hidden` auf dem Wurzelelement. Hier stand es
     * einmal, damit ein Zoom keine Rollbalken erzeugt – und legte damit lange
     * Formulare lahm: Der Knopf unter dem sichtbaren Bereich war nicht mehr
     * erreichbar, die Aufnahme lief in den Zeitüberlauf. Die Rollbalken hält
     * Chromium ohnehin per `--hide-scrollbars` aus dem Bild.
     */
    document.body.style.transformOrigin = '0 0';
    document.body.style.willChange = 'transform';
    return schicht;
  }

  function anwenden() {
    const schicht = schichtBauen();
    if (!schicht) return;

    const { zoom, x, y } = zustand.kamera;
    // Der Punkt (x, y) der Seite landet in der Mitte des Bildes.
    const tx = window.innerWidth / 2 - x * zoom;
    const ty = window.innerHeight / 2 - y * zoom;
    document.body.style.transform =
      zoom === 1 && tx === 0 && ty === 0 ? '' : `translate(${tx}px, ${ty}px) scale(${zoom})`;

    const blende = schicht.querySelector('.blende');
    blende.style.opacity = String(zustand.blende);

    const titel = schicht.querySelector('.titel');
    if (zustand.titel === null) {
      titel.style.display = 'none';
    } else {
      titel.style.display = 'flex';
      titel.style.opacity = String(zustand.titel.deckkraft ?? 1);
      // Deckend für Tafeln, die für sich stehen (etwa der Platzhalter für
      // eigenes Spielmaterial): Dahinter soll nichts durchscheinen.
      titel.style.background = zustand.titel.deckend
        ? '#05060a'
        : 'radial-gradient(120% 90% at 50% 45%, rgba(10,12,22,.68), rgba(5,6,10,.92))';
      const h = titel.querySelector('h1');
      const p = titel.querySelector('p');
      h.textContent = zustand.titel.zeile ?? '';
      p.textContent = zustand.titel.unterzeile ?? '';
      p.style.display = zustand.titel.unterzeile ? 'block' : 'none';
      // Ein Hauch Bewegung: Der Titel steigt beim Aufblenden an.
      const hub = (1 - (zustand.titel.deckkraft ?? 1)) * 26;
      titel.style.transform = `translateY(${hub}px)`;
    }

    const unter = schicht.querySelector('.untertitel');
    if (zustand.untertitel === null) {
      unter.style.display = 'none';
    } else {
      unter.style.display = 'flex';
      unter.style.opacity = String(zustand.untertitel.deckkraft ?? 1);
      unter.querySelector('.text').textContent = zustand.untertitel.text ?? '';
      const hub = (1 - (zustand.untertitel.deckkraft ?? 1)) * 18;
      unter.style.transform = `translateX(-50%) translateY(${hub}px)`;
    }

    const zeiger = schicht.querySelector('.zeiger');
    if (zustand.zeiger === null) {
      zeiger.style.display = 'none';
    } else {
      zeiger.style.display = 'block';
      zeiger.style.left = `${zustand.zeiger.x}px`;
      zeiger.style.top = `${zustand.zeiger.y}px`;
      zeiger.style.opacity = String(zustand.zeiger.deckkraft ?? 1);
    }

    const ring = schicht.querySelector('.ring');
    if (zustand.ring === null) {
      ring.style.display = 'none';
    } else {
      const groesse = zustand.ring.radius * 2;
      ring.style.display = 'block';
      ring.style.left = `${zustand.ring.x}px`;
      ring.style.top = `${zustand.ring.y}px`;
      ring.style.width = `${groesse}px`;
      ring.style.height = `${groesse}px`;
      ring.style.opacity = String(zustand.ring.deckkraft ?? 1);
    }

    const markierung = schicht.querySelector('.markierung');
    if (zustand.markierung === null) {
      markierung.style.display = 'none';
    } else {
      const { rechteck, deckkraft } = zustand.markierung;
      markierung.style.display = 'block';
      markierung.style.left = `${rechteck.x - 10}px`;
      markierung.style.top = `${rechteck.y - 10}px`;
      markierung.style.width = `${rechteck.breite + 20}px`;
      markierung.style.height = `${rechteck.hoehe + 20}px`;
      markierung.style.opacity = String(deckkraft ?? 1);
    }
  }

  window.__regie = {
    setze(neu) {
      Object.assign(zustand, neu);
      anwenden();
    },
    /** Rechteck eines Elements in Seitenkoordinaten – also ohne die Kamera. */
    zielRechteck(wahl) {
      const element = document.querySelector(wahl);
      if (!element) return null;
      const r = element.getBoundingClientRect();
      const { zoom } = zustand.kamera;
      const tx = window.innerWidth / 2 - zustand.kamera.x * zoom;
      const ty = window.innerHeight / 2 - zustand.kamera.y * zoom;
      return {
        x: (r.left - tx) / zoom,
        y: (r.top - ty) / zoom,
        breite: r.width / zoom,
        hoehe: r.height / zoom,
      };
    },
    /** Dasselbe für die Stelle, an der der Zeiger klicken muss (Bildkoordinaten). */
    bildRechteck(wahl) {
      const element = document.querySelector(wahl);
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { x: r.left, y: r.top, breite: r.width, hoehe: r.height };
    },
    bereit: true,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', anwenden);
  } else {
    anwenden();
  }
}
