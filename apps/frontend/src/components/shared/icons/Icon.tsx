import { type SVGProps } from 'react';
import { cn } from '../utils/cn';

/**
 * Icon-Set des Design-Systems (Arbeitspaket F2).
 *
 * Alle Symbole sind einheitliche 24×24-Strichzeichnungen aus dem Referenz-Mockup
 * (`docs/mockup/Palantir.dc.html`). Sie zeichnen mit `currentColor`, damit sie die
 * Textfarbe des Elternelements übernehmen.
 *
 * Neue Symbole werden **hier** ergänzt (gleiche Vorgabe: 24×24-Viewbox, reine
 * Kontur, keine Füllung) – keine eigenen SVGs in den Feature-Paketen F3–F11.
 */
export const ICON_PATHS = {
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  chat: 'M4 5h16v11H9l-4 4V16H4z',
  palette:
    'M12 3a9 9 0 100 18 3 3 0 010-6h2a3 3 0 003-3 6 6 0 00-5-9zM7.5 10.5h.01M10.5 8h.01M14.5 8.5h.01',
  bell: 'M12 3a5 5 0 015 5v3l2 4H5l2-4V8a5 5 0 015-5zM10 18a2 2 0 004 0',
  server: 'M4 4h16v6H4zM4 14h16v6H4zM7.5 7h.01M7.5 17h.01',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 104.9 12L21 21',
  logout: 'M15 4h4v16h-4M10 16l5-4-5-4M15 12H3',
  arrowLeft: 'M19 12H5M11 5l-6 7 6 7',
  arrowRight: 'M5 12h14M13 5l6 7-6 7',
  restart: 'M4 4v6h6M20 20v-6h-6M5 15a8 8 0 0014-4M19 9a8 8 0 00-14 4',
  copy: 'M9 9h11v11H9zM5 15V5h11v3',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  check: 'M5 12l5 5L19 8',
  close: 'M6 6l12 12M18 6L6 18',
  users: 'M8 12a4 4 0 100-8 4 4 0 000 8zM2 21a6 6 0 0112 0M17 8a3 3 0 010 6M22 21a5 5 0 00-6-5',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  clipboard: 'M9 3h6v3H9zM6 6h12v15H6zM9 11h6M9 15h6',
  inbox: 'M4 4h16l-2 10H6zM2 14h6l2 3h4l2-3h6',
  database:
    'M12 4c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 7v6c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 13v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l4 2',
  key: 'M15 7a4 4 0 100 8 4 4 0 000-8zM3 21l8-8',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1.5-2-3.4-2.3.9a7 7 0 00-2-1.2L14 4h-4l-.4 2.5a7 7 0 00-2 1.2L5.3 6.6l-2 3.4L5 12l-2 1.5 2 3.4 2.3-.9a7 7 0 002 1.2l.4 2.5h4l.4-2.5a7 7 0 002-1.2l2.3.9 2-3.4z',
  pin: 'M12 2l3 6 6 1-4.5 4.5L18 20l-6-3-6 3 1.5-6.5L2 9l6-1z',
  shield: 'M12 2l8 4v6c0 5-4 8-8 10-4-2-8-5-8-10V6z',
  gamepad: 'M4 8h16l1 8a3 3 0 01-5 2l-1-2H9l-1 2a3 3 0 01-5-2zM7 10v2m-1-1h2M15 10h.01M18 10h.01',
  terminal: 'M4 4h16v16H4zM8 9l3 3-3 3M13 15h4',
  image: 'M4 4h16v16H4zM8.5 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM6 18l4-5 3 3 3-4 4 6',
  smile: 'M12 2a10 10 0 100 20 10 10 0 000-20zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  warning: 'M12 3l10 18H2zM12 10v4M12 17h.01',
  menu: 'M4 6h16M4 12h16M4 18h16',
  lock: 'M6 11h12v10H6zM9 11V7a3 3 0 016 0v4',
  play: 'M7 4l13 8-13 8z',
  stop: 'M6 6h12v12H6z',
  download: 'M12 3v12M7 11l5 5 5-5M4 21h16',
  upload: 'M12 21V9M7 13l5-5 5 5M4 3h16',
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** Alle verfügbaren Symbolnamen – nützlich für Icon-Auswahl-Oberflächen. */
export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'children'> {
  name: IconName;
  /** Kantenlänge in Pixeln (Standard 16, wie in der Navigation des Mockups). */
  size?: number;
  /**
   * Beschriftung für Screenreader. Ohne Angabe gilt das Symbol als rein
   * dekorativ und wird per `aria-hidden` ausgeblendet – das ist der Normalfall,
   * weil daneben fast immer Text steht.
   */
  title?: string;
}

export function Icon({ name, size = 16, title, className, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={cn('shrink-0', className)}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
