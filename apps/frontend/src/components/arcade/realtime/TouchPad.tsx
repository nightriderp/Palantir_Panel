'use client';

import { type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { cn } from '@/components/shared';
import { type RealtimeTouchScheme } from './types';

/**
 * Bildschirmtasten für Echtzeit-Spiele auf dem Smartphone.
 *
 * Jede Taste meldet Drücken und Loslassen mit einem **Tastennamen** (`ArrowLeft`,
 * ` ` …). Der Wirt schickt ihn durch dieselbe `keyInput`-Übersetzung wie die
 * echte Tastatur – so gibt es je Spiel genau eine Belegung, und Halten wirkt
 * auf dem Handy wie am Rechner (Schläger fährt, solange der Daumen liegt).
 */

interface PadKey {
  key: string;
  label: ReactNode;
  /** Barrierefreier Name. */
  name: string;
  /** Gitterfläche (CSS `grid-area`). */
  area?: string;
  wide?: boolean;
}

function Arrow({ rotate }: { rotate: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      aria-hidden
      style={{ transform: `rotate(${rotate}deg)` }}
    >
      <path d="M12 5l7 9H5z" fill="currentColor" />
    </svg>
  );
}

const LEFT: PadKey = { key: 'ArrowLeft', label: <Arrow rotate={-90} />, name: 'Links', area: 'l' };
const RIGHT: PadKey = {
  key: 'ArrowRight',
  label: <Arrow rotate={90} />,
  name: 'Rechts',
  area: 'r',
};
const UP: PadKey = { key: 'ArrowUp', label: <Arrow rotate={0} />, name: 'Hoch', area: 'u' };
const DOWN: PadKey = { key: 'ArrowDown', label: <Arrow rotate={180} />, name: 'Runter', area: 'd' };

export interface TouchPadProps {
  scheme: RealtimeTouchScheme;
  onPress(key: string): void;
  onRelease(key: string): void;
  accent: string;
}

export function TouchPad({ scheme, onPress, onRelease, accent }: TouchPadProps) {
  if (scheme === 'pointer') return null;

  const taste = (pad: PadKey, className?: string) => (
    <PadButton
      key={pad.key}
      pad={pad}
      onPress={onPress}
      onRelease={onRelease}
      accent={accent}
      className={className}
    />
  );

  if (scheme === 'tap') {
    return (
      <div className="flex justify-center">
        {taste({ key: ' ', label: 'Tippen', name: 'Aktion' }, 'h-24 w-full max-w-sm text-lg')}
      </div>
    );
  }

  if (scheme === 'horizontal') {
    return (
      <div className="grid grid-cols-3 gap-3">
        {taste(LEFT, 'h-20')}
        {taste({ key: ' ', label: 'Feuer', name: 'Aktion' }, 'h-20 text-base')}
        {taste(RIGHT, 'h-20')}
      </div>
    );
  }

  if (scheme === 'dpad') {
    return (
      <div
        className="mx-auto grid w-full max-w-[16rem] gap-2"
        style={{
          gridTemplateAreas: '". u ." "l . r" ". d ."',
          gridTemplateColumns: 'repeat(3, 1fr)',
        }}
      >
        {[UP, LEFT, RIGHT, DOWN].map((pad) => (
          <div key={pad.key} style={{ gridArea: pad.area }}>
            {taste(pad, 'h-16 w-full')}
          </div>
        ))}
      </div>
    );
  }

  // stack: Links, Rechts, Runter, Drehen, Harter Fall
  return (
    <div className="grid grid-cols-3 gap-2">
      {taste({ ...UP, label: 'Drehen', name: 'Drehen' }, 'h-14 text-sm')}
      {taste({ key: 'x', label: 'Halten', name: 'Halten' }, 'h-14 text-sm')}
      {taste({ key: ' ', label: 'Fallen', name: 'Harter Fall' }, 'h-14 text-sm')}
      {taste(LEFT, 'h-16')}
      {taste(DOWN, 'h-16')}
      {taste(RIGHT, 'h-16')}
    </div>
  );
}

function PadButton({
  pad,
  onPress,
  onRelease,
  accent,
  className,
}: {
  pad: PadKey;
  onPress(key: string): void;
  onRelease(key: string): void;
  accent: string;
  className?: string;
}) {
  const down = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // ältere Browser – dann eben ohne Einfangen
    }
    onPress(pad.key);
  };
  const up = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    onRelease(pad.key);
  };
  return (
    <button
      type="button"
      aria-label={pad.name}
      className={cn(
        'flex select-none items-center justify-center rounded-2xl border-2 bg-fill font-semibold text-ink',
        'touch-none transition-transform active:scale-95 motion-reduce:active:scale-100',
        className,
      )}
      style={{ borderColor: `${accent}66`, color: accent }}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(event) => event.preventDefault()}
    >
      {pad.label}
    </button>
  );
}
