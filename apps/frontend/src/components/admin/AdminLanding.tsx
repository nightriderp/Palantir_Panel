'use client';

import { type AccountDto } from '@palantir/contracts';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { PageHeader } from '@/components/shared';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import { AdminAccessNotice, AdminLoading } from './common';

/**
 * Einstieg `/admin` (Arbeitspaket F10).
 *
 * Zeigt selbst nichts, sondern leitet zum ersten Bereich weiter, für den das
 * Konto eine Berechtigung hat. Welche Bereiche in Frage kommen, entscheidet
 * allein das `permissions`-Objekt (Pflichtenheft §5.2) – dieselbe Reihenfolge
 * wie in der Seitenleiste. Hat das Konto für keinen Bereich eine Berechtigung,
 * bleibt der Zugriffshinweis stehen.
 */

const SECTIONS: Array<{ flag: keyof AccountDto['permissions']; href: string }> = [
  { flag: 'canManageUsers', href: '/admin/users' },
  { flag: 'canManageRoles', href: '/admin/roles' },
  { flag: 'canModerateMessages', href: '/admin/moderation' },
  { flag: 'canManageNotifications', href: '/admin/notifications' },
  { flag: 'canViewAuditLog', href: '/admin/audit' },
  { flag: 'canManageAnyBackup', href: '/admin/backups' },
  { flag: 'canViewNodes', href: '/admin/storage' },
  { flag: 'canManageAddresses', href: '/admin/addresses' },
];

export function AdminLanding() {
  const router = useRouter();
  const { user, loading } = useSession();

  const target = user
    ? SECTIONS.find((section) => user.permissions[section.flag])?.href
    : undefined;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (loading) {
    return <AdminLoading label="Administration wird geöffnet …" />;
  }

  if (!target) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Administration" className="-mx-5 -mt-5 px-5" />
        <AdminAccessNotice area="den Admin-Bereich" />
      </div>
    );
  }

  return <AdminLoading label="Administration wird geöffnet …" />;
}
