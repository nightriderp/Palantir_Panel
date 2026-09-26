import { KachelnView } from '@/components/admin/kacheln/KachelnView';

export const metadata = {
  title: 'Kacheln · Palantir',
};

/** Übersichts-Kacheln ohne Server (Betreiber-Wunsch 26.09.2026). */
export default function AdminKachelnPage() {
  return <KachelnView />;
}
