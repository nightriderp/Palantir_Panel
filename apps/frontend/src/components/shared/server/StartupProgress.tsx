'use client';

import { useEffect, useState } from 'react';
import { cn } from '../utils/cn';

export interface StartupProgressProps {
  /** Beschriftung des Zustands, z. B. „Startet …" – kommt aus `serverStatusMeta`. */
  label: string;
  /**
   * Was das Panel zuletzt über den Vorgang weiß (`statusMessage` des DTO),
   * etwa „Startprüfung läuft". Ohne Angabe steht nur die Beschriftung da.
   */
  note?: string | null;
  /** Zeitpunkt, seit dem der Übergang läuft (ISO). Ohne ihn entfällt die Uhr. */
  since?: string | null;
  /** Gedrängte Version für die Kachel der Übersicht. */
  compact?: boolean;
  className?: string;
}

/** `45 s`, danach `1:12 min`. */
function verstrichen(seit: string): string | null {
  const start = new Date(seit).getTime();
  if (!Number.isFinite(start)) return null;

  const sekunden = Math.max(0, Math.floor((Date.now() - start) / 1000));
  if (sekunden < 60) return `${sekunden} s`;

  const minuten = Math.floor(sekunden / 60);
  return `${minuten}:${String(sekunden % 60).padStart(2, '0')} min`;
}

/**
 * Lebenszeichen für einen Server im Übergang (startet, stoppt, wird angelegt).
 *
 * Bis hierher stand an dieser Stelle nur die gelbe Pille „Startet …". Beim
 * ersten Start eines großen Spiels bleibt sie minutenlang stehen, und niemand
 * sieht, ob noch etwas passiert oder ob es hängt. Dazu kommt jetzt die Uhr –
 * „seit 2:14 min" beantwortet genau diese Frage – und, sofern das Panel eine
 * hat, die letzte Meldung zum Vorgang.
 *
 * **Bewusst ohne Prozentzahl.** Ein Start besteht aus Abbild laden, auspacken,
 * einrichten und Welt aufbauen; ein Balken darüber wäre eine erfundene Zahl,
 * die kurz vor Schluss minutenlang auf 99 % stünde. Der wandernde Streifen
 * sagt „hier passiert etwas", mehr behauptet er nicht. Wer Bewegung
 * abgeschaltet hat, bekommt über `globals.css` einen ruhig gefüllten Balken –
 * die Auskunft steht ohnehin im Text daneben.
 */
export function StartupProgress({
  label,
  note,
  since,
  compact = false,
  className,
}: StartupProgressProps) {
  /*
   * Die Uhr läuft im Sekundentakt weiter, solange die Komponente steht. Ohne
   * eigenen Takt bliebe sie auf dem Wert des letzten Renderns stehen – und
   * genau das Stillstehen war der Anlass für diese Anzeige.
   */
  const [jetzt, setJetzt] = useState(() => Date.now());
  useEffect(() => {
    if (since == null) return;
    const timer = window.setInterval(() => setJetzt(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [since]);

  const dauer = since == null ? null : verstrichen(since);
  // `jetzt` wird nur gelesen, damit der Takt ein neues Rendern auslöst.
  void jetzt;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="relative h-1 overflow-hidden rounded-sm bg-fill-strong">
        <div className="absolute inset-y-0 left-0 w-[30%] animate-startup-sweep bg-gradient-to-r from-transparent via-warning to-transparent" />
      </div>

      <p
        className={cn(
          'flex flex-wrap items-baseline gap-x-2 text-warning',
          compact ? 'text-xs' : 'text-sm',
        )}
      >
        <span className="font-semibold">{label}</span>
        {note ? <span className="text-ink-muted">{note}</span> : null}
        {dauer === null ? null : <span className="font-mono text-ink-faint">seit {dauer}</span>}
      </p>
    </div>
  );
}
