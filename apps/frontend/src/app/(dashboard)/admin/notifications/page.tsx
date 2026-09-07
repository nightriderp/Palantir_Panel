import { NotificationsView } from '@/components/admin/notifications/NotificationsView';

export const metadata = {
  title: 'Benachrichtigungs-Regeln · Palantir',
};

/** Benachrichtigungs-Regeln, Kanäle und Zustellungen (Arbeitspaket F10, Lastenheft §3.6). */
export default function AdminNotificationsPage() {
  return <NotificationsView />;
}
