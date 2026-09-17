'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { project, rubberband } from '../utils/gesture';
import { haptic } from '../utils/haptics';

/**
 * Ziehbare Navigations-Schublade fürs Telefon.
 *
 * Bis hierher war die Schublade ein Umschalter: Knopf drücken, sie springt auf,
 * irgendwo hintippen, sie springt zu. Auf dem Telefon ist die Geste die
 * natürliche Bedienung – und ohne sie fühlt sich das Panel dort an wie eine
 * Webseite, nicht wie eine App. Übernommen aus dem Schwesterprojekt
 * `hafenmeister` (`useDrawerDrag.ts`), das dafür Apples „Designing Fluid
 * Interfaces" folgt:
 *
 * - der Zug folgt 1:1 dem Finger,
 * - eine laufende Bewegung lässt sich jederzeit greifen und weiterführen,
 * - beim Loslassen zählt der Schwung: Der Zielpunkt wird aus der
 *   Geschwindigkeit projiziert, nicht aus der erreichten Strecke,
 * - über „ganz offen" hinaus bremst ein Gummiband, statt hart zu stoppen.
 *
 * Eine Achse (X). `x`: 0 = ganz offen, `-width` = ganz geschlossen. Panel und
 * Schleier werden **direkt über Refs** gesetzt und nicht über React-Zustand –
 * sonst liefe je Bild ein Rendern des ganzen Rahmens samt Seitenleiste mit.
 */

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Reagiert auf eine Media-Query und liefert ihren aktuellen Stand. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const media = window.matchMedia(query);
    const update = (): void => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}

export interface DrawerDragOptions {
  /** Soll die Schublade offen sein? Setzt der Menü-Knopf bzw. der Schleier. */
  open: boolean;
  /** Wird gerufen, sobald die Schublade (per Wisch oder Feder) zu ist. */
  onClose: () => void;
  panelRef: RefObject<HTMLElement | null>;
  scrimRef: RefObject<HTMLElement | null>;
  /** Breite der Schublade in Bildpunkten – die Strecke zwischen offen und zu. */
  width: number;
  /** Nur unterhalb der md-Schwelle; darüber ist die Leiste eine feste Spalte. */
  enabled: boolean;
}

export interface DrawerDragHandlers {
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: (event: ReactPointerEvent) => void;
}

/**
 * Ab welcher Strecke eine Geste als waagerechter Zug gilt.
 *
 * Darunter bleibt es ein Tipp – sonst würde jeder Klick auf einen Navigationslink
 * als angefangener Zug gewertet und der Link führte nicht mehr.
 */
const THRESHOLD = 10;

export function useDrawerDrag({
  open,
  onClose,
  panelRef,
  scrimRef,
  width,
  enabled,
}: DrawerDragOptions): DrawerDragHandlers {
  const x = useRef<number>(open ? 0 : -width);
  const velocity = useRef<number>(0);
  const target = useRef<number>(open ? 0 : -width);
  const raf = useRef<number | null>(null);

  const pointerId = useRef<number | null>(null);
  const dragging = useRef<boolean>(false);
  const decided = useRef<boolean>(false);
  const startX = useRef<number>(0);
  const startY = useRef<number>(0);
  const startTx = useRef<number>(0);
  const lastX = useRef<number>(0);
  const lastT = useRef<number>(0);

  // `onClose` bekommt bei jedem Rendern eine neue Identität; die Feder soll
  // trotzdem die aktuelle rufen. Nachgezogen im Layout-Effekt, weil der vor
  // dem Öffnen/Schließen-Effekt unten läuft und ein Schreiben während des
  // Renderns vom React-Compiler verboten ist.
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  /** Transform und Schleier auf den aktuellen Stand setzen. */
  const apply = useCallback((): void => {
    const panel = panelRef.current;
    const scrim = scrimRef.current;
    if (panel) panel.style.transform = `translateX(${x.current}px)`;
    if (scrim) {
      const fortschritt = Math.max(0, Math.min(1, 1 + x.current / width));
      scrim.style.opacity = String(fortschritt);
      scrim.style.pointerEvents = fortschritt > 0.01 ? 'auto' : 'none';
    }
  }, [panelRef, scrimRef, width]);

  const stopSpring = useCallback((): void => {
    if (raf.current !== null) {
      cancelAnimationFrame(raf.current);
      raf.current = null;
    }
  }, []);

  /**
   * Feder auf `target.current` zu, kritisch gedämpft – eine Umsetzbewegung
   * soll ankommen, nicht nachwippen. Startet immer beim aktuellen Stand und
   * trägt die Geschwindigkeit aus der Geste mit.
   */
  const startSpring = useCallback((): void => {
    if (raf.current !== null) return;

    const stiffness = 300;
    const damping = 2 * Math.sqrt(stiffness);
    let last = performance.now();

    const tick = (now: number): void => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;

      const accel = -stiffness * (x.current - target.current) - damping * velocity.current;
      velocity.current += accel * dt;
      x.current += velocity.current * dt;

      if (Math.abs(x.current - target.current) < 0.5 && Math.abs(velocity.current) < 5) {
        x.current = target.current;
        velocity.current = 0;
        apply();
        raf.current = null;
        // Einrasten ist der Moment, an dem etwas passiert – dort sitzt die
        // Vibration, nicht bei jedem Bild der Bewegung.
        haptic('tick');
        if (target.current <= -width + 0.5) onCloseRef.current();
        return;
      }

      apply();
      raf.current = requestAnimationFrame(tick);
    };

    raf.current = requestAnimationFrame(tick);
  }, [apply, width]);

  /** Auf ein Ziel zufahren – mit dem Schwung aus der Geste als Anfangswert. */
  const animateTo = useCallback(
    (to: number, initialVelocity = 0): void => {
      target.current = to;
      velocity.current = initialVelocity;

      if (prefersReducedMotion()) {
        x.current = to;
        apply();
        if (to <= -width + 0.5) onCloseRef.current();
        return;
      }

      startSpring();
    },
    [apply, startSpring, width],
  );

  /*
   * Auf den Knopf, den Schleier und den Wechsel zwischen Telefon und
   * Schreibtisch reagieren. `useLayoutEffect`, weil der Transform vor dem
   * ersten Zeichnen stehen muss – sonst blitzt die Schublade offen auf.
   */
  useLayoutEffect(() => {
    if (!enabled) {
      stopSpring();
      const panel = panelRef.current;
      const scrim = scrimRef.current;
      // Inline-Reste räumen, damit ab `md` wieder die feste Spalte greift.
      if (panel) panel.style.transform = '';
      if (scrim) {
        scrim.style.opacity = '';
        scrim.style.pointerEvents = '';
      }
      x.current = open ? 0 : -width;
      return;
    }

    if (dragging.current) return;

    const to = open ? 0 : -width;
    if (Math.abs(x.current - to) < 0.5) {
      x.current = to;
      apply();
      return;
    }

    animateTo(to);
  }, [open, enabled, width, animateTo, apply, stopSpring, panelRef, scrimRef]);

  useEffect(() => stopSpring, [stopSpring]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent): void => {
      if (!enabled) return;
      // Nur der erste Zeiger; ein zweiter Finger fasst nicht mit an.
      if (pointerId.current !== null) return;

      pointerId.current = event.pointerId;
      dragging.current = false;
      decided.current = false;
      startX.current = event.clientX;
      startY.current = event.clientY;
      startTx.current = x.current;
      lastX.current = event.clientX;
      lastT.current = performance.now();
      velocity.current = 0;
    },
    [enabled],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent): void => {
      if (!enabled || pointerId.current !== event.pointerId) return;

      const dx = event.clientX - startX.current;
      const dy = event.clientY - startY.current;

      if (!decided.current) {
        if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
        decided.current = true;

        // Senkrecht gemeint? Dann gehört die Geste der Liste, nicht uns.
        if (Math.abs(dy) > Math.abs(dx)) {
          dragging.current = false;
          return;
        }

        dragging.current = true;
        // Ab jetzt gehört der Zeiger uns, auch außerhalb der Fläche.
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        // Eine laufende Feder wird gegriffen und weitergeführt.
        stopSpring();
      }

      if (!dragging.current) return;

      let next = startTx.current + dx;
      if (next > 0) next = rubberband(next, width);
      if (next < -width) next = -width;
      x.current = next;
      apply();

      const now = performance.now();
      const dt = now - lastT.current;
      if (dt > 0) velocity.current = ((event.clientX - lastX.current) / dt) * 1000;
      lastX.current = event.clientX;
      lastT.current = now;
    },
    [enabled, apply, stopSpring, width],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent): void => {
      if (!enabled || pointerId.current !== event.pointerId) return;
      pointerId.current = null;

      // War es nur ein Tipp, macht der Klick auf Link oder Schleier seine Arbeit.
      if (!dragging.current) return;
      dragging.current = false;

      // Zielpunkt aus dem Schwung projizieren, dann die nähere Kante wählen.
      const projected = x.current + project(velocity.current);
      animateTo(projected > -width / 2 ? 0 : -width, velocity.current);
    },
    [enabled, animateTo, width],
  );

  return { onPointerDown, onPointerMove, onPointerUp };
}
