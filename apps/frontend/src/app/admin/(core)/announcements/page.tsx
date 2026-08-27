import { AnnouncementsView } from '@/components/admin/announcements/AnnouncementsView';

export const metadata = {
  title: 'Ankündigungen · Palantir',
};

/** Systemweite Ankündigungen (Arbeitspaket F10, Lastenheft §3.6). */
export default function AdminAnnouncementsPage() {
  return <AnnouncementsView />;
}
