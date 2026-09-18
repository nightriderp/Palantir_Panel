import { promises as fs } from 'node:fs';
import os from 'node:os';

/**
 * Arbeitsspeicher der Node: Rücklage, harte Notgrenze und Java-Heap
 * (Betreiber-Entscheidung 2026-09-18: „Server nehmen sich, was frei ist“).
 *
 * Bis dahin bekam jeder Container eine **harte** RAM-Grenze aus seiner
 * Zuweisung (`resources.memoryMb`), und der Java-Heap wurde daraus im Image
 * abgeleitet. Jetzt gilt:
 *
 * - Die Zuweisung ist eine **weiche** Grenze (`MemoryReservation`): Unter Druck
 *   drängt der Kernel den Container zuerst auf sie zurück, ohne ihn zu töten.
 * - Die **harte** Grenze ist für alle Container dieselbe: der Arbeitsspeicher
 *   der Node minus einer Rücklage für Node, Agent und frpc. Damit kann sich
 *   ein Server nehmen, was frei ist – aber keiner kann die Node umwerfen, und
 *   der OOM-Killer trifft den Verursacher statt den Agent.
 * - Der **Java-Heap** wird beim Start aus dem freien Speicher berechnet, nicht
 *   aus der Zuweisung: Ohne `-Xmx` nähme die JVM ein Viertel der Node und
 *   hörte dort auf, egal was frei ist.
 */

const MIB = 1024 * 1024;

/** Weniger als das behält die Node für sich – Agent, frpc, Kernel, Dateicache. */
export const MIN_RESERVE_MB = 2048;

/** Anteil der Node, der immer frei bleibt, wenn er über der Mindestrücklage liegt. */
export const RESERVE_SHARE = 0.1;

/** Unter dem startet kein Java-Spielserver sinnvoll. */
export const MIN_JAVA_HEAP_MB = 1024;

/**
 * Anteil der harten Grenze, den der Heap höchstens bekommt – der Rest ist
 * Metaspace, Threads, Netty-Puffer (dieselbe Rücklage wie im Image).
 */
export const MAX_JAVA_HEAP_SHARE = 0.75;

/** Rücklage der Node in MiB: ausdrücklich gesetzt oder 10 %, mindestens 2 GiB. */
export function nodeRamReserveMb(totalMb: number, konfiguriert?: number): number {
  if (konfiguriert !== undefined) {
    return Math.min(konfiguriert, Math.max(0, totalMb - MIN_JAVA_HEAP_MB));
  }

  return Math.min(Math.max(MIN_RESERVE_MB, Math.round(totalMb * RESERVE_SHARE)), totalMb);
}

/** Harte Grenze je Container in Byte: Node minus Rücklage. */
export function hardMemoryLimitBytes(totalMb: number, reserveMb: number): number {
  return Math.max(MIN_JAVA_HEAP_MB, totalMb - reserveMb) * MIB;
}

export interface JavaHeapInput {
  /** Gemessen frei (MemAvailable) in MiB. */
  readonly availableMb: number;
  readonly reserveMb: number;
  /** Laufende Palantir-Container – der neue teilt sich den Rest mit ihnen. */
  readonly runningContainers: number;
  /** Harte Grenze des Containers in MiB. */
  readonly hardLimitMb: number;
}

/**
 * Heap für einen Java-Server, der jetzt startet.
 *
 * Frei minus Rücklage, geteilt durch die laufenden Container plus diesen
 * einen: Starten drei Server nacheinander auf einer leeren Node, bekommt der
 * erste alles, der zweite die Hälfte des Rests, der dritte ein Drittel. Nach
 * oben begrenzt durch die harte Grenze (mit Rücklage für Nicht-Heap), nach
 * unten durch das Minimum – ein zu kleiner Heap ist besser als kein Start,
 * die weiche Grenze regelt den Rest.
 */
export function javaHeapMib(input: JavaHeapInput): number {
  const teiler = Math.max(1, input.runningContainers + 1);
  const frei = Math.max(0, input.availableMb - input.reserveMb);
  const anteil = Math.floor(frei / teiler);
  const obergrenze = Math.floor(input.hardLimitMb * MAX_JAVA_HEAP_SHARE);

  return Math.max(MIN_JAVA_HEAP_MB, Math.min(anteil, obergrenze));
}

/**
 * Verfügbarer Arbeitsspeicher in MiB – `MemAvailable` aus `/proc/meminfo`.
 *
 * `os.freemem()` zählt den Dateicache als belegt und unterschätzt damit
 * grob, was ein neuer Prozess bekäme; der Kernel rechnet das in `MemAvailable`
 * schon heraus. Ohne `/proc` (Windows, Tests) bleibt `freemem` der Rückfall.
 */
export async function leseVerfuegbarenSpeicherMb(): Promise<number> {
  try {
    const inhalt = await fs.readFile('/proc/meminfo', 'utf8');
    const treffer = /^MemAvailable:\s+(\d+)\s+kB/m.exec(inhalt);
    if (treffer?.[1] !== undefined) {
      return Math.round(Number(treffer[1]) / 1024);
    }
  } catch {
    // kein /proc – Rückfall unten
  }

  return Math.round(os.freemem() / MIB);
}

/** Gesamter Arbeitsspeicher der Node in MiB. */
export function gesamterSpeicherMb(): number {
  return Math.round(os.totalmem() / MIB);
}

/** Alles, was der Runtime für weiche Grenze und Heap-Planung zu wissen braucht. */
export interface SpeicherPlanung {
  readonly reserveMb: number;
  readonly hardLimitMb: number;
  readonly verfuegbarMb: () => Promise<number>;
}

/** Planung aus der Node ableiten – einmal beim Start des Agents. */
export function speicherPlanungAusNode(konfigurierteReserveMb?: number): SpeicherPlanung {
  const totalMb = gesamterSpeicherMb();
  const reserveMb = nodeRamReserveMb(totalMb, konfigurierteReserveMb);

  return {
    reserveMb,
    hardLimitMb: Math.round(hardMemoryLimitBytes(totalMb, reserveMb) / MIB),
    verfuegbarMb: leseVerfuegbarenSpeicherMb,
  };
}
