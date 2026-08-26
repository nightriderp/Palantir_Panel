'use client';

import { Icon } from '@/components/shared';
import { AUTH_ENDPOINTS, apiUrl } from '@/lib/auth/api';
import { OAUTH_PROVIDER_LIST } from '@/lib/auth/providers';

/**
 * Anmeldung über Discord, Twitch und Steam (Lastenheft §3.1).
 *
 * Bewusst echte Links statt `fetch`: der Provider-Ablauf ist eine Kette von
 * Weiterleitungen (Panel → Provider → Backend-Callback → Panel), die der Browser
 * selbst gehen muss. Der Cookie-Rückweg funktioniert nur deshalb, weil das
 * Sitzungs-Cookie auf `SameSite=Lax` steht (Pflichtenheft §7).
 *
 * `rel="nofollow"`: Suchmaschinen sollen dem Anmeldeweg nicht folgen.
 */
export function OAuthButtons() {
  return (
    <div className="flex flex-col gap-2.5">
      {OAUTH_PROVIDER_LIST.map((meta) => (
        <a
          key={meta.provider}
          href={apiUrl(AUTH_ENDPOINTS.oauthStart(meta.provider))}
          rel="nofollow"
          className="flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-base font-semibold no-underline hover:brightness-110"
          style={{ backgroundColor: meta.brandColor, color: meta.textColor }}
        >
          <Icon name={meta.icon} size={14} />
          {meta.label}
        </a>
      ))}
    </div>
  );
}

/** Trenner „oder" zwischen Passwort-Formular und Provider-Schaltflächen. */
export function AuthDivider({ label = 'oder' }: { label?: string }) {
  return (
    <div className="my-5.5 flex items-center gap-2.5">
      <div className="h-px flex-1 bg-line" />
      <span className="text-xs text-ink-faint">{label}</span>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}
