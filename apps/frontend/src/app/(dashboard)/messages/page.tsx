import { MessagesView } from '@/components/messages/MessagesView';

export const metadata = {
  title: 'Nachrichten · Palantir',
};

/** Nachrichten/Chat (Arbeitspaket F5, Lastenheft §3.6). */
export default function MessagesPage() {
  return <MessagesView />;
}
