import { MyBackupsView } from '@/components/my-backups/MyBackupsView';

export const metadata = {
  title: 'Meine Backups · Palantir',
};

/** Globale Ansicht aller eigenen Sicherungen (Arbeitspaket F4, Lastenheft §3.3). */
export default function MyBackupsPage() {
  return <MyBackupsView />;
}
