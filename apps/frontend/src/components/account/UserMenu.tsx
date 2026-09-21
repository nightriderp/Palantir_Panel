'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type AccountDto } from '@palantir/contracts';
import { Badge, Icon, cn, useToast, type IconName } from '@/components/shared';
import { avatarUrl, logout } from '@/lib/auth/api';
import { messageForThrown } from '@/lib/auth/errors';

/**
 * Konto-Menü oben rechts (Lastenheft §3.1).
 *
 * Zeigt den Namen des angemeldeten Kontos und öffnet auf Klick ein kleines Menü
 * mit Profil, Einstellungen und Abmelden. Bewusst leichtgewichtig: ein
 * Auf/Zu-Zustand, Schließen bei Klick nach außen und mit Escape. Die eigentliche
 * Rechteprüfung bleibt beim Backend – hier geht es nur um die Navigation.
 */
export function UserMenu({ user }: { user: AccountDto | null }) {
  const [open, setOpen] = useState(false);
  const bild = user === null ? null : avatarUrl(user.id, user.avatarUpdatedAt);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!user) {
    return null;
  }

  async function onLogout() {
    setOpen(false);
    try {
      await logout();
      // Nach dem Abmelden zurück zur Anmeldung; refresh, damit die Middleware
      // die nun fehlende Sitzung sieht.
      router.push('/login');
      router.refresh();
    } catch (error) {
      toast.error(messageForThrown(error));
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        data-rundgang="konto"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5 text-base text-ink-muted',
          'hover:bg-fill hover:text-ink',
          open && 'bg-fill text-ink',
        )}
      >
        {/*
          Das eigene Profilbild, sonst wie bisher das Sinnbild. Es steht hier,
          weil das Kontomenü die einzige Stelle ist, an der das eigene Konto auf
          jeder Seite sichtbar ist – wer eins hochlädt, will es dort sehen.
        */}
        <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-fill-strong text-ink-muted">
          {bild === null ? (
            <Icon name="user" size={14} />
          ) : (
            /* Adresse der API, zur Bauzeit unbekannt – `next/image` bräuchte
               dafür eine konfigurierte Domain. */
            // eslint-disable-next-line @next/next/no-img-element
            <img src={bild} alt="" className="h-full w-full object-cover" />
          )}
        </span>
        <span className="hidden max-w-[12rem] truncate sm:inline">{user.displayName}</span>
        <Icon name="menu" size={12} />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-60 animate-materialize overflow-hidden rounded-lg border border-line bg-surface shadow-panel"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-base font-semibold text-ink">
              {user.displayName}
              {/*
                Der eigene Titel (Betreiber-Wunsch 21.09.2026). Er steht dort,
                wo andere ihn sehen – in der Bestenliste, im Chat, an der
                Server-Kachel –, und war bis hierher ausgerechnet dem eigenen
                Konto nirgends sichtbar.
              */}
              {user.title ? (
                <span className="ml-1.5 text-sm font-normal text-ink-faint">{user.title}</span>
              ) : null}
            </p>
            <div className="mt-1 flex items-center gap-2">
              {user.username ? (
                <span className="truncate text-xs text-ink-faint">@{user.username}</span>
              ) : null}
              {user.isOwner ? <Badge tone="brand">Owner</Badge> : null}
            </div>
          </div>

          {/*
           * Ein Ziel, vier Einstiege: Seit Profil und Einstellungen eine Seite
           * sind (Abgleich 11.1), springen die Punkte in die Abschnitte – so
           * steht es auch im Entwurf.
           *
           * „Erfolge" ist die Ausnahme und führt auf eine eigene Seite
           * (Betreiber-Wunsch 21.09.2026). Es steht trotzdem hier und nicht
           * nur in der Seitenleiste: Abzeichen, Stufe und Titel gehören zum
           * eigenen Konto, und hier sucht man, was einem selbst gehört.
           */}
          <nav className="py-1">
            <MenuLink href="/profil" icon="user" label="Profil" onNavigate={() => setOpen(false)} />
            <MenuLink
              href="/erfolge"
              icon="medal"
              label="Erfolge"
              onNavigate={() => setOpen(false)}
            />
            <MenuLink
              href="/profil#passwort"
              icon="lock"
              label="Passwort ändern"
              onNavigate={() => setOpen(false)}
            />
            <MenuLink
              href="/profil#zweifaktor"
              icon="shield"
              label="Zwei-Faktor"
              onNavigate={() => setOpen(false)}
            />
            <MenuLink
              href="/profil#konten"
              icon="gear"
              label="Verbundene Konten"
              onNavigate={() => setOpen(false)}
            />
            <MenuLink
              href="/profil#sitzungen"
              icon="clock"
              label="Aktive Sitzungen"
              onNavigate={() => setOpen(false)}
            />
            <MenuLink
              href="/profil#rundgang"
              icon="cap"
              label="Rundgang & Tutorial"
              onNavigate={() => setOpen(false)}
            />
          </nav>

          <div className="border-t border-line py-1">
            <button
              type="button"
              role="menuitem"
              onClick={onLogout}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-base text-ink-muted hover:bg-fill hover:text-ink"
            >
              <Icon name="logout" size={14} />
              Abmelden
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Auf der Zielseite selbst zum Anker scrollen.
 *
 * Steht man schon auf `/profil`, setzt der Link den Anker über die
 * History-API – darauf scrollt der Browser nicht, und ein Sprung des Fensters
 * hülfe ohnehin nicht, weil der Inhaltsbereich des Rahmens scrollt und nicht
 * das Fenster. Kommt man von einer anderen Seite, gibt es das Ziel hier noch
 * nicht; dann übernimmt die Profil-Ansicht den Sprung nach dem Laden.
 */
function springeZuAnker(href: string) {
  const id = href.split('#')[1];
  if (id === undefined) return;

  window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 0);
}

function MenuLink({
  href,
  icon,
  label,
  onNavigate,
}: {
  href: string;
  icon: IconName;
  label: string;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={() => {
        onNavigate();
        springeZuAnker(href);
      }}
      className="flex items-center gap-2.5 px-4 py-2 text-base text-ink-muted no-underline hover:bg-fill hover:text-ink"
    >
      <Icon name={icon} size={14} />
      {label}
    </Link>
  );
}
