'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/components/shared';
import { useArcadeAudio } from '@/lib/arcade/audio/ArcadeAudioProvider';

/**
 * Musik- und Effekt-Schalter der Spielhalle.
 *
 * Zwei Knöpfe zum schnellen An/Aus und ein kleines Aufklappfeld mit den
 * Reglern. Kompakt, weil es im Kopf des Spielbildschirms neben „Zurück" steht
 * und auf dem Smartphone nicht die Zeile sprengen darf.
 */

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      {muted ? (
        <path d="M17 9l5 6M22 9l-5 6" />
      ) : (
        <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
      )}
    </svg>
  );
}

function NoteIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
      {muted ? <path d="M3 3l18 18" /> : null}
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  );
}

const KNOPF =
  'inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand';

export function AudioControls({ className }: { className?: string }) {
  const { settings, updateSettings } = useArcadeAudio();
  const [offen, setOffen] = useState(false);
  const feldId = useId();
  const rahmen = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!offen) return;
    const draussen = (event: PointerEvent) => {
      if (rahmen.current && !rahmen.current.contains(event.target as Node)) setOffen(false);
    };
    const taste = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOffen(false);
    };
    document.addEventListener('pointerdown', draussen);
    document.addEventListener('keydown', taste);
    return () => {
      document.removeEventListener('pointerdown', draussen);
      document.removeEventListener('keydown', taste);
    };
  }, [offen]);

  const aktiv = 'border-brand-line bg-brand-soft text-brand';
  const aus = 'border-line-strong bg-fill text-ink-faint hover:text-ink';

  return (
    <div ref={rahmen} className={cn('relative flex items-center gap-1.5', className)}>
      <button
        type="button"
        className={cn(KNOPF, settings.musicOn ? aktiv : aus)}
        aria-pressed={settings.musicOn}
        title={settings.musicOn ? 'Musik ausschalten' : 'Musik einschalten'}
        aria-label="Musik"
        onClick={() => updateSettings({ musicOn: !settings.musicOn })}
      >
        <NoteIcon muted={!settings.musicOn} />
      </button>
      <button
        type="button"
        className={cn(KNOPF, settings.sfxOn ? aktiv : aus)}
        aria-pressed={settings.sfxOn}
        title={settings.sfxOn ? 'Effekte ausschalten' : 'Effekte einschalten'}
        aria-label="Effekte"
        onClick={() => updateSettings({ sfxOn: !settings.sfxOn })}
      >
        <SpeakerIcon muted={!settings.sfxOn} />
      </button>
      <button
        type="button"
        className={cn(KNOPF, offen ? aktiv : aus)}
        aria-expanded={offen}
        aria-controls={feldId}
        aria-label="Lautstärke"
        title="Lautstärke"
        onClick={() => setOffen((wert) => !wert)}
      >
        <SlidersIcon />
      </button>

      {offen ? (
        <div
          id={feldId}
          className="absolute right-0 top-full z-30 mt-2 flex w-60 flex-col gap-3 rounded-xl border border-line-strong bg-surface-deep p-3 shadow-lg"
        >
          <Regler
            label="Musik"
            value={settings.musicVolume}
            disabled={!settings.musicOn}
            onChange={(musicVolume) => updateSettings({ musicVolume })}
          />
          <Regler
            label="Effekte"
            value={settings.sfxVolume}
            disabled={!settings.sfxOn}
            onChange={(sfxVolume) => updateSettings({ sfxVolume })}
          />
        </div>
      ) : null}
    </div>
  );
}

function Regler({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange(value: number): void;
}) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1', disabled && 'opacity-50')}>
      <label htmlFor={id} className="flex justify-between text-sm text-ink-muted">
        <span>{label}</span>
        <span className="font-mono text-ink">{Math.round(value * 100)} %</span>
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(value * 100)}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        className="w-full accent-brand"
      />
    </div>
  );
}
