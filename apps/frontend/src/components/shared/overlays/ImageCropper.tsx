'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../primitives/Button';
import { rubberband } from '../utils/gesture';
import { cn } from '../utils/cn';

/**
 * Bildzuschnitt vor dem Hochladen.
 *
 * ⚠️ **Ohne Bibliothek.** Die üblichen Zuschneide-Pakete bringen eigene Gesten,
 * eigenes Aussehen und ein paar hundert Kilobyte mit. Gebraucht wird hier:
 * verschieben, zoomen, fertig – zwei Zeiger-Ereignisse und ein Aufruf auf der
 * Leinwand.
 *
 * ⚠️ Und **im Browser**, nicht im Panel: So braucht das Backend keine
 * Bildbibliothek, um ein Urlaubsfoto auf Kachelgröße zu bringen – und keinen
 * Dekodierer für fremde Daten, was die unangenehmere Hälfte davon wäre. Das
 * Backend prüft nur Typ, Größe und Signatur.
 *
 * Das Ergebnis ist WebP: kleiner als JPEG bei gleicher Anmutung, und jeder
 * Browser, der dieses Panel überhaupt lädt, kann es schreiben.
 */

export interface ImageCropperProps {
  /** Die gewählte Datei. Ändert sie sich, beginnt der Zuschnitt von vorn. */
  file: File;
  /** Breite geteilt durch Höhe. 1 = quadratisch (Profilbild). */
  aspect?: number;
  title: string;
  hint?: string;
  /** Lange Kante des Ergebnisses, sofern die Vorlage sie hergibt. */
  maxLongEdge?: number;
  /** Obergrenze der Datei. Wird über die Qualität eingehalten, nicht über Pixel. */
  maxBytes?: number;
  onCancel: () => void;
  onDone: (file: File) => void;
}

const DEFAULT_LONG_EDGE = 512;

/**
 * Bytebudget des Ergebnisses.
 *
 * Etwas unter der Grenze des Backends (512 KiB): Ein Ergebnis, das die Grenze
 * exakt ausreizt, wäre beim kleinsten Aufschlag abgelehnt worden – und das
 * erst nach dem Hochladen.
 */
const DEFAULT_MAX_BYTES = 400 * 1024;

/** Qualitätsstufen, absteigend durchprobiert, bis das Budget passt. */
const QUALITY_STEPS = [0.92, 0.82, 0.7, 0.58, 0.45] as const;

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

export function ImageCropper({
  file,
  aspect = 1,
  title,
  hint,
  maxLongEdge = DEFAULT_LONG_EDGE,
  maxBytes = DEFAULT_MAX_BYTES,
  onCancel,
  onDone,
}: ImageCropperProps) {
  const [bild, setBild] = useState<HTMLImageElement | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [versatz, setVersatz] = useState({ x: 0, y: 0 });
  const [laeuft, setLaeuft] = useState(false);
  const [rahmen, setRahmen] = useState({ width: 0, height: 0 });
  const rahmenRef = useRef<HTMLDivElement>(null);
  const zug = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  // Eine neue Datei beginnt von vorn – noch im Rendern, damit das erste Bild
  // der neuen Vorlage nicht mit dem alten Ausschnitt gezeichnet wird.
  const [letzteDatei, setLetzteDatei] = useState(file);
  if (letzteDatei !== file) {
    setLetzteDatei(file);
    setZoom(1);
    setVersatz({ x: 0, y: 0 });
  }

  /*
   * Das Bild einmal laden – für die Vorschau und später zum Zeichnen. Die
   * Vorschau-Adresse hängt am geladenen Element (`bild.src`) und wird beim
   * Wechsel der Datei wieder freigegeben; der Zustand ändert sich erst in
   * den Rückrufen des Ladens, nicht im Effekt selbst.
   */
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const element = new Image();
    let abgebrochen = false;

    element.onload = () => {
      if (!abgebrochen) setBild(element);
    };
    element.onerror = () => {
      if (!abgebrochen) setFehler('Diese Datei lässt sich nicht als Bild öffnen.');
    };
    element.src = url;

    return () => {
      abgebrochen = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  // Maße des Rahmens – Grundlage jeder Umrechnung zwischen Anzeige und Ergebnis.
  useEffect(() => {
    const element = rahmenRef.current;
    if (!element) return;

    const messen = (): void => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0) setRahmen({ width: rect.width, height: rect.height });
    };

    messen();
    if (typeof ResizeObserver === 'undefined') return;

    const beobachter = new ResizeObserver(messen);
    beobachter.observe(element);

    return () => beobachter.disconnect();
  }, [bild]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onCancel();
    }

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  /** Maßstab, bei dem das Bild den Rahmen gerade füllt. */
  const deckung = useCallback((): number => {
    if (bild === null || rahmen.width === 0) return 1;

    return Math.max(rahmen.width / bild.width, rahmen.height / bild.height);
  }, [bild, rahmen]);

  /** Wie weit darf das Bild bei diesem Zoom verschoben werden? */
  const grenzen = useCallback(
    (z: number): { x: number; y: number } => {
      if (bild === null) return { x: 0, y: 0 };

      const skaliert = deckung() * z;

      return {
        x: Math.max(0, (bild.width * skaliert - rahmen.width) / 2),
        y: Math.max(0, (bild.height * skaliert - rahmen.height) / 2),
      };
    },
    [bild, deckung, rahmen],
  );

  /** Hart auf die Grenze klemmen – nach dem Loslassen. */
  const klemmen = useCallback(
    (punkt: { x: number; y: number }, z: number): { x: number; y: number } => {
      const g = grenzen(z);

      return {
        x: Math.max(-g.x, Math.min(g.x, punkt.x)),
        y: Math.max(-g.y, Math.min(g.y, punkt.y)),
      };
    },
    [grenzen],
  );

  /** Über die Grenze hinaus federnd bremsen – solange der Finger zieht. */
  const federn = useCallback(
    (punkt: { x: number; y: number }, z: number): { x: number; y: number } => {
      const g = grenzen(z);
      const achse = (wert: number, grenze: number, bezug: number): number => {
        if (wert > grenze) return grenze + rubberband(wert - grenze, bezug);
        if (wert < -grenze) return -grenze - rubberband(-grenze - wert, bezug);

        return wert;
      };

      return {
        x: achse(punkt.x, g.x, rahmen.width || 1),
        y: achse(punkt.y, g.y, rahmen.height || 1),
      };
    },
    [grenzen, rahmen],
  );

  function zeigerRunter(event: React.PointerEvent): void {
    event.currentTarget.setPointerCapture(event.pointerId);
    zug.current = { x: event.clientX, y: event.clientY, ox: versatz.x, oy: versatz.y };
  }

  function zeigerBewegt(event: React.PointerEvent): void {
    const start = zug.current;
    if (start === null) return;

    setVersatz(
      federn(
        { x: start.ox + (event.clientX - start.x), y: start.oy + (event.clientY - start.y) },
        zoom,
      ),
    );
  }

  function zeigerHoch(): void {
    if (zug.current === null) return;
    zug.current = null;
    setVersatz((aktuell) => klemmen(aktuell, zoom));
  }

  /*
   * Beim Herauszoomen wird die alte Verschiebung zu groß – dann stünde ein
   * Rand frei. Deshalb mit dem **neuen** Zoom neu klemmen, nicht mit dem alten
   * aus dem Zustand: Der ist hier noch nicht gesetzt.
   */
  function zoomGeaendert(naechster: number): void {
    setZoom(naechster);
    setVersatz((aktuell) => klemmen(aktuell, naechster));
  }

  /** Zeichnet den gewählten Ausschnitt und packt ihn mit der gegebenen Güte. */
  async function zeichne(quality: number): Promise<Blob | null> {
    if (bild === null || rahmen.width === 0) return null;

    const breite = aspect >= 1 ? maxLongEdge : Math.round(maxLongEdge * aspect);
    const hoehe = aspect >= 1 ? Math.round(maxLongEdge / aspect) : maxLongEdge;

    const leinwand = document.createElement('canvas');
    leinwand.width = breite;
    leinwand.height = hoehe;

    const ctx = leinwand.getContext('2d');
    if (ctx === null) throw new Error('Der Browser kann das Bild nicht zuschneiden.');

    // Beim Verkleinern zählt die Glättung – ohne sie wird ein großes Foto krisselig.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Vom Rahmen auf das Ergebnis hochrechnen: Was im Rahmen zu sehen ist,
    // soll im Ergebnis stehen – nur in voller Auflösung.
    const faktor = breite / rahmen.width;
    const skaliert = deckung() * zoom * faktor;
    const zeichenBreite = bild.width * skaliert;
    const zeichenHoehe = bild.height * skaliert;

    ctx.drawImage(
      bild,
      (breite - zeichenBreite) / 2 + versatz.x * faktor,
      (hoehe - zeichenHoehe) / 2 + versatz.y * faktor,
      zeichenBreite,
      zeichenHoehe,
    );

    return new Promise<Blob | null>((resolve) => leinwand.toBlob(resolve, 'image/webp', quality));
  }

  async function uebernehmen(): Promise<void> {
    setLaeuft(true);
    setFehler(null);

    try {
      /*
       * Erst die Güte senken, nicht die Pixel: Ein Profilbild soll scharf
       * bleiben; sichtbar wird zuerst die fehlende Auflösung, nicht die
       * stärkere Kompression.
       */
      for (const quality of QUALITY_STEPS) {
        const blob = await zeichne(quality);

        if (blob === null) {
          setFehler('Der Browser konnte das Bild nicht zuschneiden.');
          return;
        }

        if (blob.size <= maxBytes || quality === QUALITY_STEPS[QUALITY_STEPS.length - 1]) {
          onDone(new File([blob], 'profilbild.webp', { type: 'image/webp' }));
          return;
        }
      }
    } catch (error) {
      setFehler(error instanceof Error ? error.message : 'Das Bild ließ sich nicht zuschneiden.');
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 flex w-full max-w-[420px] flex-col gap-4 rounded-2xl border border-line-strong bg-surface p-6 shadow-modal"
      >
        <div>
          <h2 className="text-xl font-bold">{title}</h2>
          {hint ? <p className="mt-1 text-sm text-ink-soft">{hint}</p> : null}
        </div>

        {fehler ? (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {fehler}
          </p>
        ) : null}

        {/*
          Der Rahmen zeigt genau den Ausschnitt, der später im Ergebnis steht –
          deshalb rechnet das Zeichnen unten von seinen Maßen hoch. Das Bild
          liegt darunter und wird verschoben, nicht der Rahmen.
        */}
        <div
          ref={rahmenRef}
          onPointerDown={zeigerRunter}
          onPointerMove={zeigerBewegt}
          onPointerUp={zeigerHoch}
          onPointerCancel={zeigerHoch}
          style={{ aspectRatio: String(aspect) }}
          className={cn(
            'relative w-full cursor-grab touch-none select-none overflow-hidden bg-canvas',
            // Quadratisch heisst hier: rund. Der Rahmen zeigt denselben
            // Ausschnitt, in dem das Bild spaeter steht – und ein Profilbild
            // steht ueberall im Panel in einem Kreis.
            aspect === 1 ? 'rounded-full' : 'rounded-xl',
          )}
        >
          {bild === null ? null : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={bild.src}
              alt=""
              draggable={false}
              style={{
                transform: `translate(calc(-50% + ${versatz.x}px), calc(-50% + ${versatz.y}px)) scale(${deckung() * zoom})`,
              }}
              className="absolute left-1/2 top-1/2 max-w-none origin-center"
            />
          )}
        </div>

        <label className="flex items-center gap-3 text-xs text-ink-soft">
          Zoom
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(event) => zoomGeaendert(Number(event.target.value))}
            aria-label="Bildausschnitt vergrößern"
            className="flex-1"
          />
        </label>

        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} disabled={laeuft}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            disabled={bild === null || laeuft}
            onClick={() => void uebernehmen()}
          >
            {laeuft ? 'Wird zugeschnitten …' : 'Übernehmen'}
          </Button>
        </div>
      </div>
    </div>
  );
}
