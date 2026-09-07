import { RequestsView } from '@/components/admin/requests/RequestsView';

export const metadata = {
  title: 'Anfragen · Palantir',
};

/** Freischalt-Warteliste (Arbeitspaket F10, Lastenheft §3.1 und §3.7). */
export default function AdminRequestsPage() {
  return <RequestsView />;
}
