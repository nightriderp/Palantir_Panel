import { UsersView } from '@/components/admin/users/UsersView';

export const metadata = {
  title: 'Nutzer · Palantir',
};

/** Nutzerverwaltung (Arbeitspaket F10, Lastenheft §3.1 und §3.7). */
export default function AdminUsersPage() {
  return <UsersView />;
}
