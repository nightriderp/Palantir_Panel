'use client';

import { type ReactNode } from 'react';
import { type GameControl, type TouchScheme } from './types';

/**
 * Bildschirmtasten für die Touch-Bedienung der Minispiele (Mobile-First,
 * Lastenheft §4). Auf dem Desktop bleiben sie sichtbar und ergänzen die
 * Tastatur – gedrückt wird per Zeiger, damit Halten (schneller Fall, Schläger
 * bewegen) funktioniert.
 */

export interface TouchControlsProps {
  scheme: TouchScheme;
  disabled: boolean;
  onControl(control: GameControl, phase: 'press' | 'release'): void;
}

interface PadButtonProps {
  control: GameControl;
  label: string;
  glyph: ReactNode;
  disabled: boolean;
  onControl: TouchControlsProps['onControl'];
  className?: string;
}

function PadButton({ control, label, glyph, disabled, onControl, className }: PadButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      className={`flex h-14 w-14 select-none items-center justify-center rounded-tile border border-line-strong bg-fill text-xl text-ink transition active:scale-95 active:bg-brand-soft active:text-brand-bright disabled:opacity-40 ${className ?? ''}`}
      onPointerDown={(event) => {
        event.preventDefault();
        onControl(control, 'press');
      }}
      onPointerUp={(event) => {
        event.preventDefault();
        onControl(control, 'release');
      }}
      onPointerLeave={() => onControl(control, 'release')}
      onPointerCancel={() => onControl(control, 'release')}
      // Verhindert, dass ein Halten den Kontextmenü-/Auswahl-Modus auslöst.
      onContextMenu={(event) => event.preventDefault()}
    >
      {glyph}
    </button>
  );
}

export function TouchControls({ scheme, disabled, onControl }: TouchControlsProps) {
  if (scheme === 'horizontal') {
    return (
      <div className="flex items-center justify-center gap-4">
        <PadButton
          control="left"
          label="Nach links"
          glyph="←"
          disabled={disabled}
          onControl={onControl}
          className="w-24"
        />
        <PadButton
          control="right"
          label="Nach rechts"
          glyph="→"
          disabled={disabled}
          onControl={onControl}
          className="w-24"
        />
      </div>
    );
  }

  if (scheme === 'stack') {
    return (
      <div className="flex items-center justify-center gap-4">
        <PadButton
          control="left"
          label="Nach links"
          glyph="←"
          disabled={disabled}
          onControl={onControl}
        />
        <PadButton
          control="down"
          label="Schneller fallen"
          glyph="↓"
          disabled={disabled}
          onControl={onControl}
        />
        <PadButton
          control="right"
          label="Nach rechts"
          glyph="→"
          disabled={disabled}
          onControl={onControl}
        />
        <PadButton
          control="action"
          label="Drehen"
          glyph="⟳"
          disabled={disabled}
          onControl={onControl}
          className="text-brand-bright"
        />
      </div>
    );
  }

  // dpad
  return (
    <div className="grid grid-cols-3 grid-rows-3 gap-1.5">
      <span />
      <PadButton
        control="up"
        label="Nach oben"
        glyph="↑"
        disabled={disabled}
        onControl={onControl}
      />
      <span />
      <PadButton
        control="left"
        label="Nach links"
        glyph="←"
        disabled={disabled}
        onControl={onControl}
      />
      <span />
      <PadButton
        control="right"
        label="Nach rechts"
        glyph="→"
        disabled={disabled}
        onControl={onControl}
      />
      <span />
      <PadButton
        control="down"
        label="Nach unten"
        glyph="↓"
        disabled={disabled}
        onControl={onControl}
      />
      <span />
    </div>
  );
}
