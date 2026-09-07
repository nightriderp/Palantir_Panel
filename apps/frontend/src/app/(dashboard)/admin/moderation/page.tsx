import { ModerationView } from '@/components/admin/moderation/ModerationView';

export const metadata = {
  title: 'Moderation · Palantir',
};

/** Moderation gemeldeter Nachrichten (Arbeitspaket F10, Pflichtenheft §15). */
export default function AdminModerationPage() {
  return <ModerationView />;
}
