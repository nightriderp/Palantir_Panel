/**
 * Regie: führt das Panel vor und nimmt es in Einzelbildern auf.
 *
 * **Warum Einzelbilder und nicht die Bildschirmaufnahme von Playwright?**
 * Weil eine Aufnahme nach der Wanduhr auf einem beliebig ausgelasteten Rechner
 * ruckelt. Hier läuft stattdessen Chromiums virtuelle Uhr: Vor jedem Bild wird
 * die Seitenzeit um genau ein Bild weitergestellt, dann wird fotografiert.
 * Ob ein Bild 20 ms oder 500 ms braucht, ändert am Ergebnis nichts – jede
 * Bewegung im Video ist exakt gleichmäßig, auch die der Oberfläche selbst.
 *
 * **Warum die Kamera im Browser und nicht im Schnitt?** Ein Zoom im Schnitt
 * rechnet Bildpunkte hoch. Ein `transform` auf der Seite lässt Chromium den
 * Text in der Zielgröße neu rastern – der Zoom ist so scharf wie das
 * Standbild.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { schichtSkript } from './schicht.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const WURZEL = path.resolve(HIER, '..', '..');

export const BILDRATE = 30;
const BILDDAUER = 1000 / BILDRATE;

/** Weiche Beschleunigung – Start und Ende ohne Ruck. */
export const weich = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Schnell los, sanft aus – für Kamerafahrten die natürlichere Kurve. */
export const auslaufend = (t) => 1 - (1 - t) ** 3;
export const linear = (t) => t;

const mische = (von, nach, t) => von + (nach - von) * t;

export class Regie {
  static async oeffnen(optionen = {}) {
    const regie = new Regie(optionen);
    await regie.#start();
    return regie;
  }

  constructor(optionen) {
    this.breite = optionen.breite ?? 1920;
    this.hoehe = optionen.hoehe ?? 1080;
    this.ziel = optionen.ziel ?? path.join(WURZEL, 'werbevideo', 'aufnahmen');
    this.basis = optionen.basis ?? 'http://127.0.0.1:3000';
    this.steuer = optionen.steuer ?? 'http://127.0.0.1:4500';
    this.gueteBild = optionen.gueteBild ?? 94;
    this.ffmpeg = optionen.ffmpeg ?? process.env.FFMPEG ?? 'ffmpeg';

    /**
     * Bildpunkte je CSS-Punkt. Für die Handy-Aufnahme auf 2 gesetzt: Das Bild
     * wird später auf die halbe Größe in den Telefonrahmen gesetzt und ist
     * dadurch überabgetastet – also schärfer als eine 1:1-Aufnahme.
     */
    this.bildskala = optionen.bildskala ?? 1;
    this.mobil = optionen.mobil ?? false;
    /** `maus` zeichnet einen Mauszeiger, `finger` nur den Tippkreis. */
    this.zeigerArt = optionen.zeigerArt ?? 'maus';

    this.szenenName = null;
    this.bildNummer = 0;
    this.bilderOrdner = null;
    this.geschrieben = [];

    /**
     * Bewegungen, die im Hintergrund weiterlaufen, während etwas anderes die
     * Einzelbilder erzeugt – etwa eine langsame Kamerafahrt unter einer
     * Titelkarte.
     *
     * Der erste Anlauf ließ dafür zwei Aufnahmeschleifen gleichzeitig laufen.
     * Beide zählten dieselbe Bildnummer hoch und fotografierten übereinander;
     * im fertigen Clip fehlten Bilder, und das Kodieren brach an der ersten
     * Lücke ab. Es gibt deshalb genau **eine** Schleife, und alles Bewegte
     * hängt sich hier ein.
     */
    this.hintergrund = [];

    /**
     * Maße, mit denen die **Seite** rechnet.
     *
     * Nicht dasselbe wie `breite`/`hoehe`: Im Handy-Modus wertet Chromium die
     * Viewport-Angabe der Seite aus, und `window.innerWidth` weicht dann vom
     * Aufnahmefenster ab (hier 622 statt 412). Die Kamera rechnete mit den
     * Fenstermaßen und verschob das Bild um über hundert Punkte nach rechts
     * unten – im fertigen Clip lagen schwarze Balken oben und links.
     */
    this.mass = { breite: this.breite, hoehe: this.hoehe };

    this.zustand = {
      kamera: { zoom: 1, x: this.breite / 2, y: this.hoehe / 2 },
      blende: 1,
      blitz: null,
      schlagwort: null,
      titel: null,
      untertitel: null,
      zeiger: null,
      ring: null,
      markierung: null,
    };
  }

  async #start() {
    this.browser = await chromium.launch({
      executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
      args: ['--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none'],
    });
    this.ctx = await this.browser.newContext({
      viewport: { width: this.breite, height: this.hoehe },
      deviceScaleFactor: this.bildskala,
      ...(this.mobil ? { isMobile: true, hasTouch: true } : {}),
      locale: 'de-DE',
      timezoneId: 'Europe/Berlin',
      colorScheme: 'dark',
      bypassCSP: true,
      reducedMotion: 'no-preference',
    });
    await this.ctx.addInitScript(schichtSkript());
    /*
     * Der Rundgang für neue Konten legt sich über die Seite und wäre in jeder
     * Szene im Bild. Sein Stand liegt im Browserspeicher; hier wird er vor dem
     * ersten Laden auf „erledigt" gesetzt.
     */
    await this.ctx.addInitScript(() => {
      try {
        window.localStorage.setItem('palantir.rundgang', 'erledigt');
      } catch {
        /* Ohne Speicher bleibt die Führung sichtbar. */
      }
    });
    this.seite = await this.ctx.newPage();
    this.cdp = await this.ctx.newCDPSession(this.seite);
    fs.mkdirSync(this.ziel, { recursive: true });
  }

  // -------------------------------------------------------------------------
  // Uhr
  // -------------------------------------------------------------------------

  /**
   * Die Seitenzeit anhalten – ab hier bewegt sich nur noch, was wir schalten.
   *
   * Mit `gleichstellen` wird sie zugleich auf die echte Uhr gesetzt. Das ist
   * nötig, weil die virtuelle Uhr langsamer läuft als die Wanduhr: Jedes Bild
   * stellt sie um 33 ms weiter, das Aufnehmen eines Bildes dauert aber das
   * Doppelte. Über eine ganze Aufnahme summiert sich das zu Minuten, und das
   * Panel rechnet seine Zeitangaben gegen diese Uhr – im Bild stand dann
   * „seit 3:21 min" an einem Server, der eben erst gestartet war.
   */
  async #uhrAnhalten({ gleichstellen = false } = {}) {
    await this.cdp.send('Emulation.setVirtualTimePolicy', {
      policy: 'pause',
      ...(gleichstellen ? { initialVirtualTime: Date.now() / 1000 } : {}),
    });
  }

  /** Die Seitenzeit um `ms` weiterstellen und warten, bis die Seite fertig ist. */
  async #uhrWeiter(ms) {
    const abgelaufen = new Promise((loesen) => {
      this.cdp.once('Emulation.virtualTimeBudgetExpired', loesen);
    });
    await this.cdp.send('Emulation.setVirtualTimePolicy', {
      policy: 'pauseIfNetworkFetchesPending',
      budget: ms,
      maxVirtualTimeTaskStarvationCount: 8000,
    });
    // Notbremse: Hängt eine Anfrage, darf die Aufnahme nicht mit ihr stehen
    // bleiben – ein Bild zu viel ist besser als ein Abbruch nach zehn Minuten.
    await Promise.race([abgelaufen, new Promise((r) => setTimeout(r, 8000))]);
  }

  /**
   * Etwas tun, das echte Zeit braucht (anmelden, laden, auf die API warten),
   * ohne dabei aufzunehmen.
   *
   * Die Seitenzeit läuft hier **in kleinen Schritten** weiter, nicht mit der
   * Richtlinie `advance`. Die lässt Chromium die virtuelle Uhr so schnell
   * laufen, wie die Aufgabenschlange es zulässt – in einem einzigen Anmeldevorgang
   * vergingen so Tage. Im Bild stand danach „Laufzeit 3 d 14 h" an einem Server,
   * der vor Minuten angelegt worden war. Jeder Schritt hier entspricht ungefähr
   * der Zeit, die er wirklich braucht; die Uhr der Seite bleibt damit plausibel.
   */
  async imVorlauf(auftrag) {
    let fertig = false;
    let ergebnis;
    let fehler = null;
    const lauf = Promise.resolve()
      .then(auftrag)
      .then(
        (wert) => {
          ergebnis = wert;
        },
        (problem) => {
          fehler = problem;
        },
      )
      .finally(() => {
        fertig = true;
      });

    while (!fertig) {
      await this.#uhrWeiter(50);
    }
    await lauf;
    if (fehler !== null) throw fehler;
    return ergebnis;
  }

  // -------------------------------------------------------------------------
  // Aufnahme
  // -------------------------------------------------------------------------

  /**
   * Die Maße der Seite übernehmen.
   *
   * Nach jedem Seitenwechsel und zu Beginn jeder Szene – eine andere Seite
   * kann eine andere Viewport-Angabe tragen.
   */
  async masseLesen() {
    const gemessen = await this.seite.evaluate(() => ({
      breite: window.innerWidth,
      hoehe: window.innerHeight,
    }));
    if (gemessen.breite > 0 && gemessen.hoehe > 0) this.mass = gemessen;
    // Kamera in Ruhestellung auf die Mitte der Seite setzen.
    if (this.zustand.kamera.zoom === 1) {
      this.zustand.kamera = { zoom: 1, x: this.mass.breite / 2, y: this.mass.hoehe / 2 };
    }
    return this.mass;
  }

  async szene(name) {
    await this.masseLesen();
    this.szenenName = name;
    this.bildNummer = 0;
    this.bilderOrdner = path.join(this.ziel, '.bilder', name);
    fs.rmSync(this.bilderOrdner, { recursive: true, force: true });
    fs.mkdirSync(this.bilderOrdner, { recursive: true });
    await this.#uhrAnhalten({ gleichstellen: true });
    process.stdout.write(`\nSzene „${name}" `);
  }

  /** Hintergrund-Bewegungen um ein Bild weiterstellen. */
  #hintergrundWeiter() {
    for (const bewegung of this.hintergrund) {
      bewegung.verstrichen += BILDDAUER;
      const t = Math.min(1, bewegung.verstrichen / bewegung.dauer);
      bewegung.anwenden(bewegung.kurve(t));
    }
    this.hintergrund = this.hintergrund.filter((b) => b.verstrichen < b.dauer);
  }

  /** Ein Einzelbild: Zustand setzen, Uhr ein Bild weiter, fotografieren. */
  async #bild() {
    this.#hintergrundWeiter();
    await this.seite.evaluate((z) => window.__regie?.setze(z), this.zustand);
    await this.#uhrWeiter(BILDDAUER);
    const datei = path.join(this.bilderOrdner, String(this.bildNummer).padStart(6, '0') + '.jpeg');
    await this.seite.screenshot({ path: datei, type: 'jpeg', quality: this.gueteBild });
    this.bildNummer += 1;
    if (this.bildNummer % 30 === 0) process.stdout.write('.');
  }

  /** Über eine Dauer hinweg aufnehmen und dabei je Bild `auftrag(t)` aufrufen. */
  async #ueber(dauer, auftrag, kurve = weich) {
    const bilder = Math.max(1, Math.round(dauer / BILDDAUER));
    for (let i = 1; i <= bilder; i += 1) {
      await auftrag(kurve(i / bilder), i / bilder);
      await this.#bild();
    }
  }

  /** Stillstand – die Seite läuft weiter, die Kamera nicht. */
  async halten(dauer) {
    await this.#ueber(dauer, () => {}, linear);
  }

  // -------------------------------------------------------------------------
  // Kamera
  // -------------------------------------------------------------------------

  /**
   * Kamerafahrt. Ziel ist entweder ein Element (`auf`) oder ein Punkt
   * (`x`/`y`) in Seitenkoordinaten, dazu ein Zoomfaktor.
   */
  async kamera({ auf = null, zoom = 1, dauer = 1200, kurve = auslaufend, rand = 40 } = {}) {
    await this.kameraFahrtStarten({ auf, zoom, dauer, kurve, rand });
    await this.halten(dauer);
  }

  /**
   * Kamerafahrt anstoßen, ohne selbst Bilder zu erzeugen.
   *
   * Für Fahrten, die unter etwas anderem weiterlaufen sollen – eine langsame
   * Rückfahrt unter der Titelkarte etwa. Die Bilder erzeugt dann das, was
   * danach kommt.
   */
  async kameraFahrtStarten({
    auf = null,
    zoom = 1,
    dauer = 1200,
    kurve = auslaufend,
    rand = 40,
  } = {}) {
    const ziel = await this.#kameraZiel({ auf, zoom, rand });
    const von = { ...this.zustand.kamera };
    this.hintergrund.push({
      dauer,
      verstrichen: 0,
      kurve,
      anwenden: (t) => {
        this.zustand.kamera = {
          zoom: mische(von.zoom, ziel.zoom, t),
          x: mische(von.x, ziel.x, t),
          y: mische(von.y, ziel.y, t),
        };
      },
    });
  }

  /** Kamera ohne Fahrt setzen (für den ersten Bildausschnitt einer Szene). */
  async kameraSetzen({ auf = null, zoom = 1, rand = 40 } = {}) {
    this.zustand.kamera = await this.#kameraZiel({ auf, zoom, rand });
  }

  /**
   * Bildschirmrechteck eines Ziels. `ziel` ist ein Playwright-Selektor (auch
   * `text=`/`:has-text()`) oder ein fertiger Locator – bewusst nicht
   * `querySelector`: Die Oberfläche wird über sichtbaren Text angesprochen,
   * nicht über Klassennamen, die sich beim nächsten Umbau ändern.
   */
  async rechteck(ziel, { sichtbar = true } = {}) {
    const locator = typeof ziel === 'string' ? this.seite.locator(ziel).first() : ziel;
    if (sichtbar) await locator.waitFor({ state: 'visible', timeout: 15_000 });
    const kasten = await locator.boundingBox();
    if (kasten === null) throw new Error(`Ziel ohne Ausdehnung: ${String(ziel)}`);
    return { x: kasten.x, y: kasten.y, breite: kasten.width, hoehe: kasten.height };
  }

  /** Dasselbe Rechteck in Seitenkoordinaten – also ohne die Kamera. */
  async seitenRechteck(ziel) {
    const r = await this.rechteck(ziel);
    const { zoom, x, y } = this.zustand.kamera;
    const tx = this.mass.breite / 2 - x * zoom;
    const ty = this.mass.hoehe / 2 - y * zoom;
    return {
      x: (r.x - tx) / zoom,
      y: (r.y - ty) / zoom,
      breite: r.breite / zoom,
      hoehe: r.hoehe / zoom,
    };
  }

  /**
   * Hält den Bildausschnitt innerhalb der Seite.
   *
   * Ohne das schiebt eine Fahrt auf ein Element am Rand schwarze Flächen ins
   * Bild – die Seite hört dort auf, die Kamera nicht.
   */
  #einfangen({ zoom, x, y }) {
    const halbeBreite = this.breite / (2 * zoom);
    const halbeHoehe = this.hoehe / (2 * zoom);
    const klemme = (wert, min, max) =>
      min > max ? (min + max) / 2 : Math.min(max, Math.max(min, wert));
    return {
      zoom,
      x: klemme(x, halbeBreite, this.breite - halbeBreite),
      y: klemme(y, halbeHoehe, this.hoehe - halbeHoehe),
    };
  }

  async #kameraZiel({ auf, zoom, rand }) {
    if (auf === null) {
      return this.#einfangen({ zoom, x: this.mass.breite / 2, y: this.mass.hoehe / 2 });
    }
    const rechteck = await this.seitenRechteck(auf);

    // Ohne ausdrücklichen Zoom so nah heran, wie das Element es zulässt.
    const passend = Math.min(
      this.mass.breite / (rechteck.breite + rand * 2),
      this.mass.hoehe / (rechteck.hoehe + rand * 2),
    );
    const z = zoom === 'passend' ? Math.min(2.2, Math.max(1, passend)) : zoom;
    return this.#einfangen({
      zoom: z,
      x: rechteck.x + rechteck.breite / 2,
      y: rechteck.y + rechteck.hoehe / 2,
    });
  }

  /**
   * Weich zu einer Stelle rollen.
   *
   * Gerollt wird der **nächste rollbare Vorfahre**, nicht das Fenster: Das
   * Panel hält seinen Inhalt in einem eigenen Bereich, das Fenster selbst
   * rollt nie. Ein `window.scrollTo` bewegte deshalb gar nichts, und ein Knopf
   * unterhalb des Bereichs blieb unerreichbar.
   *
   * Nur bei Zoom 1 sinnvoll: Unter einer skalierten Seite verschieben sich
   * Rollweite und Bildausschnitt gegeneinander.
   */
  async scrolleZu(ziel, { dauer = 900, abstand = 200 } = {}) {
    const locator = typeof ziel === 'string' ? this.seite.locator(ziel).first() : ziel;
    await locator.waitFor({ state: 'attached', timeout: 15_000 });

    const plan = await locator.evaluate((element, luft) => {
      function rollbarerVorfahre(knoten) {
        let lauf = knoten.parentElement;
        while (lauf) {
          const stil = getComputedStyle(lauf);
          const rollbar = /(auto|scroll|overlay)/.test(stil.overflowY);
          if (rollbar && lauf.scrollHeight > lauf.clientHeight + 4) return lauf;
          lauf = lauf.parentElement;
        }
        return document.scrollingElement ?? document.documentElement;
      }

      const behaelter = rollbarerVorfahre(element);
      const eigen = behaelter.getBoundingClientRect
        ? behaelter.getBoundingClientRect()
        : { top: 0 };
      const oben = behaelter === document.scrollingElement ? 0 : eigen.top;
      const r = element.getBoundingClientRect();
      const ziel = Math.max(
        0,
        Math.min(
          behaelter.scrollTop + (r.top - oben) - luft,
          behaelter.scrollHeight - behaelter.clientHeight,
        ),
      );
      behaelter.dataset.regieRollt = '1';
      return { von: behaelter.scrollTop, nach: ziel };
    }, abstand);

    if (Math.abs(plan.nach - plan.von) < 4) return;

    await this.#ueber(dauer, async (t) => {
      await this.seite.evaluate(
        (y) => {
          const behaelter = document.querySelector('[data-regie-rollt="1"]');
          if (behaelter) behaelter.scrollTop = y;
        },
        mische(plan.von, plan.nach, t),
      );
    });

    await this.seite.evaluate(() => {
      const behaelter = document.querySelector('[data-regie-rollt="1"]');
      if (behaelter) delete behaelter.dataset.regieRollt;
    });
  }

  // -------------------------------------------------------------------------
  // Blenden, Titel, Untertitel
  // -------------------------------------------------------------------------

  async aufblenden(dauer = 700) {
    await this.#ueber(dauer, (t) => {
      this.zustand.blende = 1 - t;
    });
    this.zustand.blende = 0;
  }

  async abblenden(dauer = 700) {
    await this.#ueber(dauer, (t) => {
      this.zustand.blende = t;
    });
    this.zustand.blende = 1;
  }

  /** Titelkarte: kommt, steht, geht. */
  async titelkarte(
    zeile,
    unterzeile = '',
    { ein = 600, stand = 1600, aus = 500, deckend = false } = {},
  ) {
    const karte = (deckkraft) => ({ zeile, unterzeile, deckkraft, deckend });
    this.zustand.titel = karte(0);
    await this.#ueber(ein, (t) => {
      this.zustand.titel = karte(t);
    });
    await this.halten(stand);
    await this.#ueber(aus, (t) => {
      this.zustand.titel = karte(1 - t);
    });
    this.zustand.titel = null;
  }

  /** Erklärzeile am unteren Bildrand. */
  async untertitel(text, { ein = 380, stand = 1800, aus = 320 } = {}) {
    await this.untertitelEin(text, ein);
    await this.halten(stand);
    await this.untertitelAus(aus);
  }

  async untertitelEin(text, dauer = 380) {
    await this.#ueber(dauer, (t) => {
      this.zustand.untertitel = { text, deckkraft: t };
    });
    this.zustand.untertitel = { text, deckkraft: 1 };
  }

  async untertitelAus(dauer = 320) {
    const text = this.zustand.untertitel?.text ?? '';
    await this.#ueber(dauer, (t) => {
      this.zustand.untertitel = { text, deckkraft: 1 - t };
    });
    this.zustand.untertitel = null;
  }

  /** Eine Stelle hervorheben und den Rest abdunkeln. */
  async markiere(wahl, { ein = 400 } = {}) {
    const rechteck = await this.rechteck(wahl);
    await this.#ueber(ein, (t) => {
      this.zustand.markierung = { rechteck, deckkraft: t };
    });
  }

  async markierungAus(dauer = 300) {
    const markierung = this.zustand.markierung;
    if (!markierung) return;
    await this.#ueber(dauer, (t) => {
      this.zustand.markierung = { ...markierung, deckkraft: 1 - t };
    });
    this.zustand.markierung = null;
  }

  // -------------------------------------------------------------------------
  // Effekte
  // -------------------------------------------------------------------------

  /**
   * Kurzer Stoß nach vorn und zurück.
   *
   * Der Klick bekommt damit Gewicht, ohne dass der Bildausschnitt wandert:
   * Die Kamera geht ein Stück heran und sofort wieder auf ihren Stand zurück.
   */
  async stoss({ staerke = 0.045, hin = 110, zurueck = 190 } = {}) {
    const von = { ...this.zustand.kamera };
    const ziel = this.#einfangen({ ...von, zoom: von.zoom * (1 + staerke) });
    await this.#ueber(
      hin,
      (t) => {
        this.zustand.kamera = {
          zoom: mische(von.zoom, ziel.zoom, t),
          x: mische(von.x, ziel.x, t),
          y: mische(von.y, ziel.y, t),
        };
      },
      auslaufend,
    );
    await this.#ueber(zurueck, (t) => {
      this.zustand.kamera = {
        zoom: mische(ziel.zoom, von.zoom, t),
        x: mische(ziel.x, von.x, t),
        y: mische(ziel.y, von.y, t),
      };
    });
    this.zustand.kamera = von;
  }

  /**
   * Wackeln – für den Moment, in dem etwas anspringt.
   *
   * Die Auslenkung folgt zwei überlagerten Schwingungen statt dem Zufall:
   * So sieht jede Aufnahme gleich aus, und das Bild zittert, statt zu zucken.
   */
  async wackeln({ dauer = 420, staerke = 7 } = {}) {
    const von = { ...this.zustand.kamera };
    await this.#ueber(
      dauer,
      (_t, roh) => {
        const abklang = 1 - roh;
        const phase = roh * dauer;
        this.zustand.kamera = {
          zoom: von.zoom,
          x: von.x + Math.sin(phase * 0.09) * staerke * abklang,
          y: von.y + Math.sin(phase * 0.13 + 1.1) * staerke * 0.7 * abklang,
        };
      },
      linear,
    );
    this.zustand.kamera = von;
  }

  /** Ein heller Schlag über das ganze Bild – der Übergang zwischen zwei Teilen. */
  async blitz({ farbe = '#ffffff', hoehe = 0.85, ein = 70, aus = 260 } = {}) {
    await this.#ueber(
      ein,
      (t) => {
        this.zustand.blitz = { farbe, deckkraft: t * hoehe };
      },
      linear,
    );
    await this.#ueber(aus, (t) => {
      this.zustand.blitz = { farbe, deckkraft: (1 - t) * hoehe };
    });
    this.zustand.blitz = null;
  }

  /**
   * Schlagwort: ein großes Wort mitten ins Bild.
   *
   * Ein `|` im Text trennt ab, was im Farbverlauf stehen soll –
   * „Ein Klick.|Mehr nicht." setzt den zweiten Teil farbig.
   */
  async schlagwort(text, { ein = 260, stand = 1_100, aus = 240, groesse = 104, y = 380 } = {}) {
    await this.#ueber(
      ein,
      (t) => {
        this.zustand.schlagwort = {
          text,
          groesse,
          y: y - (1 - t) * 14,
          skala: mische(1.06, 1, t),
          deckkraft: t,
        };
      },
      auslaufend,
    );
    await this.halten(stand);
    await this.#ueber(aus, (t) => {
      this.zustand.schlagwort = {
        text,
        groesse,
        y,
        skala: mische(1, 1.03, t),
        deckkraft: 1 - t,
      };
    });
    this.zustand.schlagwort = null;
  }

  // -------------------------------------------------------------------------
  // Zeiger und Eingaben
  // -------------------------------------------------------------------------

  /** Den Zeiger zu einem Punkt im Bild führen. */
  async zeigerZu(x, y, dauer = 620) {
    const von = this.zustand.zeiger ?? {
      x: this.breite * 0.62,
      y: this.hoehe * 0.86,
      deckkraft: 0,
    };
    await this.#ueber(dauer, (t) => {
      this.zustand.zeiger = {
        x: mische(von.x, x, t),
        y: mische(von.y, y, t),
        deckkraft: Math.min(1, (von.deckkraft ?? 0) + t * 2),
      };
    });
    this.zustand.zeiger = { x, y, deckkraft: 1 };
    await this.seite.mouse.move(x, y);
  }

  async zeigerAus(dauer = 300) {
    const von = this.zustand.zeiger;
    if (!von) return;
    await this.#ueber(dauer, (t) => {
      this.zustand.zeiger = { ...von, deckkraft: 1 - t };
    });
    this.zustand.zeiger = null;
  }

  /**
   * Auf ein Element klicken: hinfahren, kurz innehalten, Klickring, klicken.
   * Der Ring ist das, was im Video den Klick sichtbar macht – ein echter
   * Mauszeiger steht auf einem Bildschirmfoto nicht mit drauf.
   */
  async klicke(wahl, { hin = 620, nach = 260 } = {}) {
    const anfang = await this.rechteck(wahl);

    /*
     * Am Telefon gibt es keinen Zeiger, der irgendwo herkommt – da erscheint
     * nur der Tippkreis. Ein Mauspfeil auf einem Handybildschirm sieht falsch
     * aus, und zwar sofort.
     */
    if (this.zeigerArt === 'maus') {
      await this.zeigerZu(anfang.x + anfang.breite / 2, anfang.y + anfang.hoehe / 2, hin);
      await this.halten(120);
    } else {
      await this.halten(160);
    }

    /*
     * **Direkt vor dem Klick noch einmal messen.**
     *
     * Zwischen dem Messen und dem Klick vergehen ein paar hundert Millisekunden
     * Seitenzeit – die Zeigerbewegung. Baut die Oberfläche in dieser Spanne
     * etwas um (eine Liste füllt sich, eine Karte wächst), liegt unter der
     * alten Stelle etwas anderes. In der Handy-Szene öffnete der Klick auf das
     * Suchfeld so das Navigationsmenü.
     */
    const jetztHier = await this.rechteck(wahl);
    const x = jetztHier.x + jetztHier.breite / 2;
    const y = jetztHier.y + jetztHier.hoehe / 2;
    if (this.zustand.zeiger !== null && this.zeigerArt === 'maus') {
      this.zustand.zeiger = { x, y, deckkraft: 1 };
      await this.seite.mouse.move(x, y);
    }

    // Ring aufziehen, gleichzeitig klicken.
    await this.seite.mouse.click(x, y);
    await this.#ueber(
      420,
      (t) => {
        this.zustand.ring = { x, y, radius: 12 + t * 44, deckkraft: 1 - t };
      },
      linear,
    );
    this.zustand.ring = null;
    if (nach > 0) await this.halten(nach);
  }

  /**
   * In ein Feld tippen – Zeichen für Zeichen, mit ungleichmäßigem Takt.
   *
   * Wird das Feld nicht gefunden, bricht die Aufnahme ab. Hier stand vorher
   * ein stiller Rückfall („dann eben ohne Klick weitertippen"): Der
   * Benutzername landete im Nichts, das Formular meldete „Bitte gib deinen
   * Benutzernamen ein", und im fertigen Clip sah man eine fehlgeschlagene
   * Anmeldung. Ein Abbruch kostet einen Lauf, ein stiller Fehlgriff kostet
   * einen Schnitt.
   */
  /**
   * In ein Feld tippen – Zeichen für Zeichen, mit ungleichem Takt.
   *
   * `leeren` räumt das Feld vorher aus. Das ist die Vorgabe, weil Felder mit
   * einer sinnvollen Vorbelegung die Regel sind, nicht die Ausnahme: Der
   * Zeitplan einer neuen Aufgabe steht schon auf `0 4 * * *`, und das
   * Angetippte landete dahinter. Heraus kam `0 4 * * *0 4 * * *`, und das
   * Panel wies die Aufgabe zu Recht ab – im Bild eine rote Fehlermeldung.
   *
   * Geleert wird über die Tastatur (alles markieren, überschreiben) und nicht
   * über `fill()`: Ein `fill()` setzt den Wert in einem Rutsch, ohne dass die
   * Aufnahme etwas davon sieht.
   */
  async tippe(wahl, text, { proZeichen = 62, leeren = true } = {}) {
    const anfang = await this.rechteck(wahl);
    if (this.zeigerArt === 'maus') {
      await this.zeigerZu(
        anfang.x + Math.min(anfang.breite - 30, 40),
        anfang.y + anfang.hoehe / 2,
        450,
      );
    }
    // Erneut messen (siehe klicke()): Die Bewegung dauert, die Seite wartet nicht.
    const r = await this.rechteck(wahl);
    const x = r.x + Math.min(r.breite - 30, 40);
    const y = r.y + r.hoehe / 2;
    if (this.zeigerArt !== 'maus') await this.#tippkreis(x, y);
    await this.seite.mouse.click(x, y);

    if (leeren) {
      const inhalt = await this.#feldInhalt(wahl);
      if (inhalt !== '') {
        await this.seite.keyboard.press('ControlOrMeta+a');
        await this.halten(120);
        await this.seite.keyboard.press('Backspace');
        await this.halten(180);
      }
    }

    for (const zeichen of text) {
      await this.seite.keyboard.type(zeichen);
      // Menschen tippen nicht im Metronom.
      const takt = proZeichen * (0.62 + Math.random() * 0.85);
      await this.#ueber(takt, () => {}, linear);
    }
  }

  /** Der Kreis, der eine Berührung sichtbar macht. */
  async #tippkreis(x, y) {
    await this.#ueber(
      380,
      (t) => {
        this.zustand.ring = { x, y, radius: 10 + t * 38, deckkraft: 1 - t };
      },
      linear,
    );
    this.zustand.ring = null;
  }

  /**
   * Einen Eintrag aus einem Auswahlfeld wählen.
   *
   * Der Zeiger fährt hin und klickt sichtbar; die Auswahl selbst setzt
   * Playwright. Das aufgeklappte Menü eines `<select>` zeichnet das
   * Betriebssystem und nicht die Seite – auf einem Bildschirmfoto wäre es
   * ohnehin nicht zu sehen.
   */
  /** Was in einem Eingabefeld steht – leer, wenn es keines ist. */
  async #feldInhalt(wahl) {
    const locator = typeof wahl === 'string' ? this.seite.locator(wahl).first() : wahl.first();
    return locator.inputValue().catch(() => '');
  }

  async waehle(ziel, wert, { hin = 560, nach = 500 } = {}) {
    const r = await this.rechteck(ziel);
    const x = r.x + r.breite / 2;
    const y = r.y + r.hoehe / 2;
    if (this.zeigerArt === 'maus') await this.zeigerZu(x, y, hin);
    await this.#tippkreis(x, y);

    const locator = typeof ziel === 'string' ? this.seite.locator(ziel).first() : ziel;
    await locator.selectOption(wert);
    if (nach > 0) await this.halten(nach);
  }

  // -------------------------------------------------------------------------
  // Navigation und Bühnensteuerung
  // -------------------------------------------------------------------------

  /**
   * Seite aufrufen und zur Ruhe kommen lassen.
   *
   * Bewusst `domcontentloaded` statt `networkidle`: Das Panel hält einen
   * Live-Kanal und den Benachrichtigungskanal offen, im Entwicklungsbetrieb
   * kommt die Aktualisierungsverbindung von Next.js dazu. „Kein Netzverkehr
   * mehr" tritt damit nie ein – `networkidle` läuft in den Zeitüberlauf,
   * obwohl die Seite längst steht.
   */
  async gehe(pfad, { beruhigen = 1800, warteAuf = null } = {}) {
    await this.imVorlauf(async () => {
      await this.seite.goto(`${this.basis}${pfad}`, { waitUntil: 'domcontentloaded' });
      if (warteAuf !== null) {
        await this.seite.locator(warteAuf).first().waitFor({ state: 'visible', timeout: 30_000 });
      }
      await this.seite.waitForTimeout(beruhigen);
    });
    await this.masseLesen();
  }

  /** Anmelden – gehört zum Aufbau, nicht ins Video. */
  async anmelden(benutzer, passwort) {
    await this.imVorlauf(async () => {
      await this.seite.goto(`${this.basis}/login`, { waitUntil: 'domcontentloaded' });
      await this.seite.waitForTimeout(600);
      // Wer schon angemeldet ist, sieht den Anmeldebildschirm nie: Das Panel
      // schickt ihn weiter zur Übersicht. Dann ist hier nichts zu tun.
      if (/\/servers/.test(this.seite.url())) return;
      await this.seite.getByLabel('Benutzername').fill(benutzer);
      await this.seite.getByLabel('Passwort', { exact: true }).fill(passwort);
      await this.seite.getByText('Sicherheitsprüfung bestanden.').waitFor({ timeout: 40_000 });

      /*
       * Abgeschickt wird mit der Eingabetaste, nicht mit einem Klick.
       *
       * Im Hochformat steht der Knopf unterhalb des sichtbaren Bereichs.
       * Playwright rollt dorthin – und weil die Seitenzeit hier in kleinen
       * Schritten mitläuft, rollt die Seite noch, während der Klick gesetzt
       * wird. Getroffen wird dann das, was gerade darunterliegt
       * („<main …> intercepts pointer events"). Die Eingabetaste braucht keine
       * Stelle auf dem Bildschirm.
       */
      await this.seite.getByLabel('Passwort', { exact: true }).press('Enter');
      await this.seite.waitForURL(/\/servers/, { timeout: 40_000 });
      await this.seite.waitForTimeout(2500);
    });
  }

  /**
   * Sitzung verwerfen.
   *
   * Der Anmeldebildschirm ist nur zu sehen, solange niemand angemeldet ist –
   * sonst schickt das Panel jeden Aufruf von `/login` weiter zur Übersicht.
   */
  async abmelden() {
    await this.imVorlauf(async () => {
      await this.ctx.clearCookies();
      await this.seite.goto(`${this.basis}/login`, { waitUntil: 'domcontentloaded' });
      await this.seite.waitForTimeout(800);
    });
  }

  /**
   * Warten, bis eine Bedingung auf der Seite zutrifft.
   *
   * Für alles, was die Oberfläche als Folge einer Eingabe neu aufbaut – etwa
   * eine gefilterte Liste. Ohne dieses Warten klickt die Aufnahme auf den
   * Stand von vorhin: In der Handy-Szene wurde nach der Suche noch die erste
   * Karte der **ungefilterten** Liste geöffnet, also der falsche Server.
   */
  async warteAuf(bedingung, { frist = 15_000, beschreibung = 'Bedingung' } = {}) {
    await this.imVorlauf(async () => {
      await this.seite.waitForFunction(bedingung, null, { timeout: frist }).catch((fehler) => {
        throw new Error(`${beschreibung} trat nicht ein: ${fehler.message.split('\n')[0]}`);
      });
    });
  }

  /** Die Demo-Node steuern (Konsolenzeilen, Spielerzahlen). */
  async buehne(pfad) {
    return this.imVorlauf(async () => {
      const antwort = await fetch(`${this.steuer}${pfad}`);
      return antwort.json();
    });
  }

  // -------------------------------------------------------------------------
  // Schnitt der Szene
  // -------------------------------------------------------------------------

  /** Die aufgenommenen Bilder zu einem Clip zusammenfassen. */
  async schnitt() {
    const name = this.szenenName;
    const datei = path.join(this.ziel, `${name}.mp4`);

    /*
     * Lückenlos? `ffmpeg` hört bei der ersten fehlenden Nummer einfach auf und
     * schreibt einen kürzeren Clip – mit einer Meldung, die im Rest der
     * Ausgabe untergeht. Ein abgeschnittener Clip fällt erst im Schnitt auf,
     * da ist die Bühne längst weitergelaufen.
     */
    const vorhanden = fs.readdirSync(this.bilderOrdner).filter((d) => d.endsWith('.jpeg')).length;
    if (vorhanden !== this.bildNummer) {
      throw new Error(
        `Szene „${name}": ${String(this.bildNummer)} Bilder aufgenommen, aber ${String(vorhanden)} auf der Platte. ` +
          'Läuft eine Bewegung neben der Aufnahmeschleife? Hintergrund-Fahrten gehören in kameraFahrtStarten().',
      );
    }

    process.stdout.write(` ${this.bildNummer} Bilder → kodiere `);

    await neuerLauf(this.ffmpeg, [
      '-y',
      '-loglevel',
      'error',
      '-framerate',
      String(BILDRATE),
      '-i',
      path.join(this.bilderOrdner, '%06d.jpeg'),
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '16',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      datei,
    ]);

    fs.rmSync(this.bilderOrdner, { recursive: true, force: true });
    this.geschrieben.push({ name, datei, bilder: this.bildNummer });
    process.stdout.write(`fertig (${(this.bildNummer / BILDRATE).toFixed(1)} s)`);
    this.szenenName = null;
    return datei;
  }

  async schliessen() {
    await this.browser?.close();
  }
}

export function neuerLauf(befehl, argumente) {
  return new Promise((loesen, ablehnen) => {
    const lauf = spawn(befehl, argumente, { stdio: ['ignore', 'inherit', 'inherit'] });
    lauf.on('error', ablehnen);
    lauf.on('close', (code) =>
      code === 0 ? loesen() : ablehnen(new Error(`${befehl} endete mit ${code}`)),
    );
  });
}
