/**
 * Gesten-Physik für ziehbare Flächen – zwei reine Funktionen, keine Bibliothek.
 *
 * Übernommen aus dem Schwesterprojekt `hafenmeister` (`lib/gesture.ts`), das
 * sie seinerseits aus Apples „Designing Fluid Interfaces" hat. Sie sind so
 * klein, dass eine Abhängigkeit dafür nicht zu rechtfertigen wäre – und sie
 * sind rein, also direkt testbar.
 */

/**
 * Ruhepunkt aus der Abwurfgeschwindigkeit.
 *
 * Die exponentielle Abklingform aus Apples Beispielcode, **nicht** die
 * Schulformel `v²/2a`: Sie trifft, wohin ein Finger eine Fläche „geworfen"
 * hätte. `velocity` in px/s, Rückgabe der Restweg in px.
 */
export function project(velocity: number, decel = 0.998): number {
  return ((velocity / 1000) * decel) / (1 - decel);
}

/**
 * Weicher Widerstand jenseits einer Grenze.
 *
 * Statt hart zu stoppen folgt die Fläche dem Finger immer weniger, je weiter
 * sie über die Kante gezogen wird. `overshoot` ist die Strecke über der Grenze,
 * `dimension` die Bezugsgröße (Breite oder Höhe der Fläche).
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}
