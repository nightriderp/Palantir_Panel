'use client';

import { cn } from '@/components/shared/utils/cn';

/**
 * Ein Würfel als echter CSS-Würfel: sechs Seiten im 3D-Raum, gedreht wird der
 * ganze Körper. Damit er beim Wurf sichtbar rollt, wächst die Drehung mit jedem
 * Wurf um volle Umdrehungen (`spins`) – die Transition rechnet dann über mehrere
 * Runden bis zur Zielseite, statt den kürzesten Weg zu nehmen.
 */

/** Augen je Seite im 3×3-Raster (Index 0 … 8, zeilenweise). */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** Lage jeder Seite am Körper und die Gegendrehung, die sie nach vorn bringt. */
const FACES: { value: number; place: string; show: [number, number] }[] = [
  { value: 1, place: 'rotateY(0deg)', show: [0, 0] },
  { value: 6, place: 'rotateY(180deg)', show: [0, -180] },
  { value: 3, place: 'rotateY(90deg)', show: [0, -90] },
  { value: 4, place: 'rotateY(-90deg)', show: [0, 90] },
  { value: 5, place: 'rotateX(90deg)', show: [-90, 0] },
  { value: 2, place: 'rotateX(-90deg)', show: [90, 0] },
];

export function Die({
  value,
  spins,
  index,
  held,
  size,
}: {
  /** 1–6; 0 = noch nicht gewürfelt. */
  value: number;
  spins: number;
  index: number;
  held: boolean;
  size: number;
}) {
  const face = FACES.find((f) => f.value === value) ?? FACES[0]!;
  const dirX = index % 2 === 0 ? 1 : -1;
  const dirY = index % 3 === 0 ? -1 : 1;
  const rx = face.show[0] + 360 * spins * dirX;
  const ry = face.show[1] + 360 * spins * dirY + (value === 0 ? 20 : 0);
  const half = size / 2;
  return (
    <div className="relative" style={{ width: size, height: size, perspective: size * 6 }}>
      <div
        className="kniffel-die absolute inset-0"
        style={{
          transformStyle: 'preserve-3d',
          transform: `rotateX(${rx - 12}deg) rotateY(${ry + 14}deg)`,
          transition: 'transform 900ms cubic-bezier(.15,.9,.25,1.05)',
        }}
      >
        {FACES.map((f) => (
          <div
            key={f.value}
            className={cn(
              'absolute inset-0 grid grid-cols-3 grid-rows-3 rounded-[22%] p-[14%]',
              held ? 'border-2 border-violet-300' : 'border border-white/40',
            )}
            style={{
              transform: `${f.place} translateZ(${half}px)`,
              background: held
                ? 'linear-gradient(145deg, #ede9fe, #c4b5fd)'
                : 'linear-gradient(145deg, #ffffff, #e4e4e7)',
              boxShadow: 'inset 0 -3px 6px rgba(0,0,0,0.18), inset 0 2px 4px rgba(255,255,255,0.9)',
              backfaceVisibility: 'hidden',
            }}
          >
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} className="flex items-center justify-center">
                {PIPS[f.value]?.includes(i) ? (
                  <span
                    className="block rounded-full"
                    style={{
                      width: size * 0.15,
                      height: size * 0.15,
                      background:
                        f.value === 1
                          ? 'radial-gradient(circle at 35% 35%, #c084fc, #6d28d9)'
                          : 'radial-gradient(circle at 35% 35%, #52525b, #09090b)',
                    }}
                  />
                ) : null}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
