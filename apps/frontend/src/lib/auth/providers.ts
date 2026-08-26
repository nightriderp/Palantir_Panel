import { OAUTH_PROVIDERS, type OAuthProvider } from '@palantir/contracts';

import { type IconName } from '@/components/shared';

/**
 * Anzeigeangaben zu den externen Anmeldeverfahren (Lastenheft §3.1).
 *
 * Die Liste selbst steht im Contract; hier stehen nur Beschriftung und Optik.
 * Die Markenfarben von Discord, Twitch und Steam sind bewusst literal: sie
 * gehören den jeweiligen Anbietern und sind deshalb keine Design-Tokens des
 * Panels (F2-Regel „keine literalen Farbwerte" zielt auf die eigene Palette).
 */
export interface OAuthProviderMeta {
  provider: OAuthProvider;
  /** Beschriftung der Schaltfläche. */
  label: string;
  /** Markenfarbe des Anbieters als Flächenfarbe der Schaltfläche. */
  brandColor: string;
  /** Textfarbe auf dieser Fläche. */
  textColor: string;
  /** Symbol aus dem F2-Icon-Set – das Set führt keine Anbieter-Logos. */
  icon: IconName;
}

export const OAUTH_PROVIDER_META: Record<OAuthProvider, OAuthProviderMeta> = {
  discord: {
    provider: 'discord',
    label: 'Mit Discord anmelden',
    brandColor: '#5865F2',
    textColor: '#ffffff',
    icon: 'chat',
  },
  twitch: {
    provider: 'twitch',
    label: 'Mit Twitch anmelden',
    brandColor: '#9146FF',
    textColor: '#ffffff',
    icon: 'image',
  },
  steam: {
    provider: 'steam',
    label: 'Mit Steam anmelden',
    brandColor: '#1b2838',
    textColor: '#ffffff',
    icon: 'gamepad',
  },
};

/** Anzeigereihenfolge auf der Login-Seite – wie im Contract festgelegt. */
export const OAUTH_PROVIDER_LIST: OAuthProviderMeta[] = OAUTH_PROVIDERS.map(
  (provider) => OAUTH_PROVIDER_META[provider],
);
