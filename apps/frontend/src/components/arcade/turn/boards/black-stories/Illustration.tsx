/**
 * Kleine Bilder für die Vorderseite der Rätselkarte – je Schwierigkeit eins:
 * eine Kerze (leicht), ein Rabe vor dem Mond (mittel), eine Taschenuhr ohne
 * Zeiger (schwer). Mit Absicht schlicht und dunkel, damit die Schrift
 * darüber die Hauptrolle behält.
 */
export function Illustration({ stufe }: { stufe: 1 | 2 | 3 }) {
  return (
    <svg viewBox="0 0 240 110" className="mx-auto h-24 w-full max-w-[16rem]" aria-hidden>
      <defs>
        <radialGradient id="bs-glow" cx="50%" cy="45%" r="50%">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="bs-mond" cx="40%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#f4f4f5" />
          <stop offset="100%" stopColor="#a1a1aa" />
        </radialGradient>
        <linearGradient id="bs-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#d4d4d8" />
          <stop offset="100%" stopColor="#52525b" />
        </linearGradient>
      </defs>
      {stufe === 1 && (
        <g>
          <ellipse
            cx="120"
            cy="48"
            rx="60"
            ry="48"
            fill="url(#bs-glow)"
            style={{ animation: 'bs-flicker 3s infinite' }}
          />
          <rect x="108" y="52" width="24" height="46" rx="3" fill="#e7e5e4" />
          <path
            d="M108 60 q6 6 0 12 M132 64 q-5 5 0 10"
            stroke="#d6d3d1"
            strokeWidth="3"
            fill="none"
          />
          <line x1="120" y1="52" x2="120" y2="44" stroke="#27272a" strokeWidth="2" />
          <path
            d="M120 20 C128 32 128 40 120 45 C112 40 112 32 120 20Z"
            fill="#f59e0b"
            style={{ animation: 'bs-flicker 1.6s infinite' }}
          />
          <path d="M120 30 C123 36 123 40 120 43 C117 40 117 36 120 30Z" fill="#fef3c7" />
          <rect x="96" y="96" width="48" height="6" rx="3" fill="#3f3f46" />
        </g>
      )}
      {stufe === 2 && (
        <g>
          <circle cx="150" cy="46" r="34" fill="url(#bs-mond)" opacity="0.9" />
          <circle cx="160" cy="36" r="5" fill="#a1a1aa" opacity="0.5" />
          <circle cx="140" cy="58" r="7" fill="#a1a1aa" opacity="0.4" />
          <path
            d="M30 96 Q90 88 210 96"
            stroke="#3f3f46"
            strokeWidth="5"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M96 90 C92 76 96 64 108 60 C112 50 124 48 130 54 L142 52 L132 60 C134 70 128 82 116 88 L118 94 M108 90 L106 95"
            fill="#09090b"
            stroke="#09090b"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <circle cx="124" cy="56" r="1.8" fill="#fbbf24" />
          <path d="M100 76 C84 70 74 74 66 84 C80 80 90 82 100 84Z" fill="#18181b" />
        </g>
      )}
      {stufe === 3 && (
        <g>
          <path d="M120 14 v8" stroke="#a1a1aa" strokeWidth="4" />
          <circle cx="120" cy="10" r="6" fill="none" stroke="url(#bs-gold)" strokeWidth="3" />
          <circle cx="120" cy="60" r="40" fill="#18181b" stroke="url(#bs-gold)" strokeWidth="5" />
          {Array.from({ length: 12 }, (_, i) => {
            const w = (i * Math.PI) / 6;
            return (
              <line
                key={i}
                x1={120 + Math.sin(w) * 30}
                y1={60 - Math.cos(w) * 30}
                x2={120 + Math.sin(w) * 35}
                y2={60 - Math.cos(w) * 35}
                stroke="#71717a"
                strokeWidth={i % 3 === 0 ? 3 : 1.5}
              />
            );
          })}
          <path d="M104 44 L136 76 M110 80 L128 50" stroke="#3f3f46" strokeWidth="1.5" />
          <circle cx="120" cy="60" r="3" fill="#e11d48" />
        </g>
      )}
    </svg>
  );
}
