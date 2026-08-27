import { RolesView } from '@/components/admin/roles/RolesView';

export const metadata = {
  title: 'Rollen · Palantir',
};

/** Rollen- und Berechtigungsverwaltung (Arbeitspaket F10, Pflichtenheft §8). */
export default function AdminRolesPage() {
  return <RolesView />;
}
