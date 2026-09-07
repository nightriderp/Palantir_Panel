import { AdminLanding } from '@/components/admin/AdminLanding';

export const metadata = {
  title: 'Administration · Palantir',
};

/** Einstieg `/admin` – leitet zum ersten erlaubten Bereich weiter (Arbeitspaket F10). */
export default function AdminIndexPage() {
  return <AdminLanding />;
}
