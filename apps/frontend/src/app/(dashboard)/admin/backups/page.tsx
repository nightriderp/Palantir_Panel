import { BackupsView } from '@/components/admin/backups/BackupsView';

export const metadata = {
  title: 'Backups · Palantir',
};

/** Globale Backup-Übersicht (Arbeitspaket F10, Lastenheft §3.7). */
export default function AdminBackupsPage() {
  return <BackupsView />;
}
