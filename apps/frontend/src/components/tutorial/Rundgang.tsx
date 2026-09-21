'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Button, Icon, cn } from '@/components/shared';
import { useRundgang } from './RundgangProvider';
import {
  RUNDGANG_SCHRITTE,
  ZETTEL_BREITE,
  abbruchBeendet,
  abbruchStufe,
  ausschnittFlaechen,
  istSichtbar,
  naechsterSichtbarer,
  zettelPlatz,
  type Fenster,
  type Rechteck,
} from './rundgangSchritte';

/**
 * Der Rundgang: Scheinwerfer auf ein Element, Zettel daneben, weiter.
 *
 * Er liegt über der ganzen Anwendung und zeigt auf **echte** Bedienelemente –
 * Navigationseinträge, die Glocke, das Kontomenü –, statt sie nachzubauen. Die
 * Verbindung dorthin ist ein `data-rundgang`-Attribut am Element; was es nicht
 * gibt oder was gerade nicht im Bild steht, wird übersprungen
 * ({@link naechsterSichtbarer}). Dadurch stimmt der Rundgang automatisch mit den
 * Berechtigungen des Kontos überein: Wer keine Nodes sehen darf, hat den
 * Eintrag nicht, und der Rundgang zeigt ihn nicht.
 *
 * **Gemessen wird über `useSyncExternalStore`**, nicht in einem Effekt: Die
 * Lage eines fremden Elements ist ein Wert außerhalb von React, der sich beim
 * Scrollen, beim Ändern der Fenstergröße und beim Aufklappen der Schublade
 * ändert. Als abonnierte Quelle angebunden, kommt er beim Rendern an, ohne dass
 * ein Effekt Zustand nachzieht (und ohne die Kaskade, vor der
 * `react-hooks/set-state-in-effect` warnt).
 *
 * Während der Rundgang läuft, nehmen die vier Verdunklungsflächen jeden Klick
 * an: Es soll niemand aus Versehen einen Server starten, während er einen
 * Zettel liest. Der Stand landet im `localStorage` – gezeigt wird der Rundgang
 * von selbst nur beim ersten Mal.
 *
 * **Zwei Ausgänge, und das ist Absicht.** Der Knopf „Nicht jetzt" gibt erst
 * nach mehreren Klicks nach und wird mit jedem davon frecher – die Leiter
 * steht als `ABBRUCH_STUFEN` in `rundgangSchritte.ts`, wie lang sie ist,
 * entscheidet sie dort selbst. Das ist der Scherz, den sich ein Panel für einen
 * festen Freundeskreis erlauben darf (Lastenheft §1). Escape beendet dagegen
 * sofort und ohne jede Rückfrage – ein Ding, das sich über die ganze
 * Anwendung legt, braucht einen Ausgang, der nicht verhandelt, und auf den
 * verlassen sich Tastaturbedienung und die e2e-Tests.
 */

/** Wie oft die Lage der Ziele neu gemessen wird, solange der Rundgang läuft. */
const MESS_TAKT_MS = 120;

/** Höhe des Zettels, bevor er einmal gemessen wurde. */
const ZETTEL_HOEHE_VORGABE = 210;

function zielElement(ziel: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-rundgang="${ziel}"]`);
}

/**
 * Ein Schnappschuss der Lage als Text: `ziel|fenster|zettelhöhe`.
 *
 * Text und nicht Objekt, weil `useSyncExternalStore` den Wert mit `Object.is`
 * vergleicht: Ein frisch gebautes Objekt wäre bei jedem Abruf „neu" und würde
 * endlos neu rendern, eine gleich gebliebene Zeichenkette ist gleich.
 */
function schnappschuss(ziel: string | null): string {
  const fenster = `${window.innerWidth},${window.innerHeight}`;
  const zettel = document.querySelector<HTMLElement>('[data-rundgang-zettel]');
  const hoehe = zettel ? Math.round(zettel.getBoundingClientRect().height) : ZETTEL_HOEHE_VORGABE;

  const element = ziel === null ? null : zielElement(ziel);
  if (element === null) return `-|${fenster}|${hoehe}`;

  const r = element.getBoundingClientRect();

  return `${Math.round(r.top)},${Math.round(r.left)},${Math.round(r.width)},${Math.round(r.height)}|${fenster}|${hoehe}`;
}

function aufDemServer(): string {
  return `-|0,0|${ZETTEL_HOEHE_VORGABE}`;
}

function lies(roh: string): { ziel: Rechteck | null; fenster: Fenster; zettelHoehe: number } {
  const [zielTeil = '-', fensterTeil = '0,0', hoeheTeil = ''] = roh.split('|');
  const [fb = 0, fh = 0] = fensterTeil.split(',').map(Number);
  const fenster: Fenster = { breite: fb, hoehe: fh };
  const zettelHoehe = Number(hoeheTeil) || ZETTEL_HOEHE_VORGABE;

  if (zielTeil === '-') return { ziel: null, fenster, zettelHoehe };

  const [top = 0, left = 0, breite = 0, hoehe = 0] = zielTeil.split(',').map(Number);
  const ziel: Rechteck = { top, left, breite, hoehe };

  return { ziel: istSichtbar(ziel, fenster) ? ziel : null, fenster, zettelHoehe };
}

/** Hängt den Rundgang ein, sobald er läuft – sonst steht hier nichts im DOM. */
export function Rundgang() {
  const { laeuft, beenden } = useRundgang();

  // Eigene Komponente darunter: Beim Start fängt sie frisch an, ohne dass ein
  // Schritt aus dem letzten Durchlauf zurückgesetzt werden müsste.
  return laeuft ? <RundgangLauf onBeenden={beenden} /> : null;
}

function RundgangLauf({ onBeenden }: { onBeenden: () => void }) {
  const [index, setIndex] = useState(0);
  /** Wie oft schon auf „Nicht jetzt" geklickt wurde – siehe {@link ABBRUCH_STUFEN}. */
  const [abbruchKlicks, setAbbruchKlicks] = useState(0);

  const schritt = RUNDGANG_SCHRITTE[index];
  const zielName = schritt?.ziel ?? null;

  const abonnieren = useCallback((melden: () => void) => {
    window.addEventListener('resize', melden);
    // Die Anwendung scrollt in einem eigenen Bereich, nicht im Fenster –
    // deshalb in der Erfassungsphase am Dokument.
    document.addEventListener('scroll', melden, true);
    const takt = window.setInterval(melden, MESS_TAKT_MS);

    return () => {
      window.removeEventListener('resize', melden);
      document.removeEventListener('scroll', melden, true);
      window.clearInterval(takt);
    };
  }, []);

  const lesen = useCallback(() => schnappschuss(zielName), [zielName]);
  const gemessen = useSyncExternalStore(abonnieren, lesen, aufDemServer);
  const { ziel, fenster, zettelHoehe } = lies(gemessen);

  // Das Ziel ins Bild holen – ein Navigationseintrag kann in der Seitenleiste
  // weit unten liegen. Kein Zustand, nur ein Anstoß an den Browser.
  useEffect(() => {
    if (zielName === null) return;
    zielElement(zielName)?.scrollIntoView({ block: 'nearest' });
  }, [zielName]);

  // Escape beendet immer und ohne Rückfrage. Das ist der Ausgang, den es in
  // einem Ding geben muss, das sich über die ganze Anwendung legt.
  useEffect(() => {
    function beiTaste(event: KeyboardEvent): void {
      if (event.key === 'Escape') onBeenden();
    }

    document.addEventListener('keydown', beiTaste);
    return () => document.removeEventListener('keydown', beiTaste);
  }, [onBeenden]);

  function sichtbar(name: string): boolean {
    const element = zielElement(name);
    if (element === null) return false;

    const r = element.getBoundingClientRect();
    return istSichtbar({ top: r.top, left: r.left, breite: r.width, hoehe: r.height }, fenster);
  }

  function springe(richtung: 1 | -1): void {
    const naechster = naechsterSichtbarer(RUNDGANG_SCHRITTE, index + richtung, richtung, sichtbar);

    // Nach vorn kann das nicht passieren – die Schlussstation hat kein Ziel und
    // ist damit immer erreichbar. Nach hinten schon: Steht man auf der zweiten
    // Station und die erste ist verschwunden, bleibt man eben stehen.
    if (naechster === null) {
      if (richtung === 1) onBeenden();
      return;
    }

    // Wer weiterliest, fängt die Leiter beim nächsten Fluchtversuch von vorn
    // an. Sonst sammelt jemand über elf Stationen hinweg heimlich Klicks und
    // steht plötzlich ohne Rückfrage draußen.
    setAbbruchKlicks(0);
    setIndex(naechster);
  }

  function abbrechen(): void {
    if (abbruchBeendet(abbruchKlicks)) {
      onBeenden();
      return;
    }

    setAbbruchKlicks(abbruchKlicks + 1);
  }

  if (!schritt) return null;

  const flaechen = ausschnittFlaechen(ziel, fenster);
  const platz = zettelPlatz(ziel, fenster, zettelHoehe);
  const letzter = index === RUNDGANG_SCHRITTE.length - 1;
  const stufe = abbruchStufe(abbruchKlicks);

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      {/*
        Vier Flächen statt eines Lochs: Sie verdunkeln alles außer dem Ziel und
        fangen dabei jeden Klick ab. Derselbe Schleier wie hinter der mobilen
        Schublade.
      */}
      {flaechen.map((flaeche, nummer) => (
        <div
          key={nummer}
          aria-hidden
          onClick={abbrechen}
          className="absolute bg-black/60"
          style={{
            top: flaeche.top,
            left: flaeche.left,
            width: flaeche.breite,
            height: flaeche.hoehe,
          }}
        />
      ))}

      {ziel ? (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-md ring-2 ring-brand"
          style={{
            top: ziel.top - 6,
            left: ziel.left - 6,
            width: ziel.breite + 12,
            height: ziel.hoehe + 12,
          }}
        />
      ) : null}

      <div
        data-rundgang-zettel
        role="dialog"
        aria-modal="true"
        aria-label={`Rundgang: ${schritt.titel}`}
        className={cn(
          'absolute max-w-[calc(100vw-1.5rem)] rounded-xl border border-brand-line bg-surface p-4 shadow-modal',
          'motion-safe:animate-materialize',
        )}
        style={{ top: platz.top, left: platz.left, width: ZETTEL_BREITE }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-2xs uppercase tracking-[0.1em] text-ink-soft">
            <Icon name="cap" size={12} className="text-brand" />
            Rundgang
          </span>
          {/*
            Punkte statt „3 von 11": Übersprungene Stationen (der Menü-Knopf am
            Rechner, ein Eintrag ohne Berechtigung) würden die Zahl springen
            lassen, und eine Zahl, die von 1 auf 3 geht, sieht nach Fehler aus.
          */}
          <span aria-hidden className="flex items-center gap-1">
            {RUNDGANG_SCHRITTE.map((punkt, nummer) => (
              <span
                key={punkt.key}
                className={cn(
                  'h-1 w-1 rounded-full',
                  nummer === index ? 'bg-brand' : 'bg-fill-strong',
                )}
              />
            ))}
          </span>
        </div>

        <h2 className="mt-2 text-md font-bold text-ink">{schritt.titel}</h2>
        <p className="mt-1.5 text-base text-ink-muted">{schritt.text}</p>

        {/*
          `aria-live`, weil sich hier Text ändert, ohne dass der Fokus
          umspringt: Der Knopf bleibt unter dem Finger, nur seine Beschriftung
          und diese Zeile werden eine Stufe frecher. Ohne Ansage bekäme das
          niemand mit, der den Zettel vorgelesen bekommt.
        */}
        <p aria-live="polite" className="mt-2 text-sm text-caution empty:hidden">
          {stufe.frage}
        </p>

        <div className="mt-4 flex items-center justify-between gap-2">
          {/*
            Auf der Schlussstation gibt es nichts mehr abzubrechen – „Nicht
            jetzt" und „Verstanden" täten dasselbe, und die Rückfrage („Es sind
            noch keine 30 Sekunden") wäre dort schlicht falsch.

            `whitespace-nowrap`, weil die Beschriftung mit jeder Stufe wechselt:
            „Ja, wirklich" brach im schmalen Zettel sonst auf zwei Zeilen um und
            riss die Knopfreihe auseinander.
          */}
          {letzter ? (
            <span />
          ) : (
            <Button variant="ghost" size="sm" className="whitespace-nowrap" onClick={abbrechen}>
              {stufe.knopf}
            </Button>
          )}

          <div className="flex items-center gap-2">
            {index > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                iconLeft="arrowLeft"
                onClick={() => springe(-1)}
              >
                Zurück
              </Button>
            ) : null}
            <Button
              variant="primary"
              size="sm"
              iconRight={letzter ? 'check' : 'arrowRight'}
              autoFocus
              onClick={() => (letzter ? onBeenden() : springe(1))}
            >
              {letzter ? 'Verstanden' : 'Weiter'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
