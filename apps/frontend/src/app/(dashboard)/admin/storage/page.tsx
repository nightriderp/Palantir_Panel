import { StorageView } from '@/components/admin/storage/StorageView';

export const metadata = {
  title: 'Node-Platz · Palantir',
};

/** Node-Platz / Storage-Explorer (Arbeitspaket F10, Lastenheft §3.8). */
export default function AdminStoragePage() {
  return <StorageView />;
}
