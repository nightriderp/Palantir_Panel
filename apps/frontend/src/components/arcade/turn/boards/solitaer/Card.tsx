'use client';

import { cn } from '@/components/shared';
import { isRed, rankOf, RANK_LABELS, suitOf, SUIT_SYMBOLS } from './rules';

/**
 * Eigene Spielkarten: schlicht, gut lesbar auch bei 46 px Breite. Bildkarten
 * tragen statt Figuren ein Monogramm im Rahmen – keine Anlehnung an
 * bekannte Kartendesigns.
 */

const CARD_BOX = 'relative w-full overflow-hidden rounded-[6px] aspect-[5/7]';

export function CardFace({ card, selected }: { card: number; selected?: boolean }) {
  const rank = rankOf(card);
  const label = RANK_LABELS[rank - 1] ?? '?';
  const suit = SUIT_SYMBOLS[suitOf(card)] ?? '?';
  const red = isRed(card);
  const court = rank > 10;
  return (
    <div
      className={cn(
        CARD_BOX,
        'border bg-gradient-to-b from-white to-slate-100 shadow-[0_1px_3px_rgba(0,0,0,0.45)]',
        red ? 'text-rose-600' : 'text-slate-900',
        selected ? 'border-emerald-400 ring-2 ring-emerald-300' : 'border-slate-300',
      )}
    >
      <span className="absolute left-[6%] top-[2%] text-[clamp(10px,3.2vw,15px)] font-extrabold leading-none">
        {label}
        <span className="block text-[0.9em]">{suit}</span>
      </span>
      <span className="absolute inset-0 flex items-center justify-center pt-[18%]">
        {court ? (
          <span
            className={cn(
              'flex aspect-square w-[58%] items-center justify-center rounded-full border-2 text-[clamp(12px,4.2vw,22px)] font-black',
              red ? 'border-rose-300 bg-rose-50' : 'border-slate-300 bg-slate-50',
            )}
          >
            {label}
          </span>
        ) : (
          <span className="text-[clamp(16px,6vw,32px)] leading-none">{suit}</span>
        )}
      </span>
    </div>
  );
}

export function CardBack() {
  return (
    <div
      className={cn(CARD_BOX, 'border border-emerald-200/40 shadow-[0_1px_3px_rgba(0,0,0,0.5)]')}
      style={{
        background:
          'repeating-linear-gradient(45deg, rgba(255,255,255,0.12) 0 3px, transparent 3px 9px), repeating-linear-gradient(-45deg, rgba(255,255,255,0.08) 0 3px, transparent 3px 9px), linear-gradient(160deg, #16a34a, #065f46)',
      }}
    >
      <span className="absolute inset-[12%] rounded-[4px] border border-white/30" />
    </div>
  );
}

export function EmptySlot({ label }: { label: string }) {
  return (
    <div
      className={cn(
        CARD_BOX,
        'flex items-center justify-center border-2 border-dashed border-white/25 text-[clamp(12px,4vw,20px)] font-bold text-white/35',
      )}
    >
      {label}
    </div>
  );
}
