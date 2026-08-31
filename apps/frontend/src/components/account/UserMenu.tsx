'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type AccountDto } from '@palantir/contracts';
import { Badge, Icon, cn, useToast, type IconName } from '@/components/shared';
import { logout } from '@/lib/auth/api';
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
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5 text-base text-ink-muted',
          'hover:bg-fill hover:text-ink',
          open && 'bg-fill text-ink',
        )}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-fill-strong text-ink-muted">
          <Icon name="user" size={14} />
        </span>
        <span className="hidden max-w-[12rem] truncate sm:inline">{user.displayName}</span>
        <Icon name="menu" size={12} />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-lg border border-line bg-surface shadow-lg"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-base font-semibold text-ink">{user.displayName}</p>
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
           */}
          <nav className="py-1">
            <MenuLink href="/profil" icon="user" label="Profil" onNavigate={() => setOpen(false)} />
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
