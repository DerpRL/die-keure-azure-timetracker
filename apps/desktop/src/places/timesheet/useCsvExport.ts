import { useState } from 'react';
import { useToast } from '../../components/Toast';
import { chooseSavePath } from '../../features/ticketContext/native';
import { useAction } from '../../state/hooks';

/**
 * Export CSV: asks where to save, then `history.exportCsv` writes the loaded range's worklogs.
 * `pending` covers the save dialog and the write.
 */
export function useCsvExport(): { exportCsv: () => Promise<void>; pending: boolean; error: string | null } {
  const toast = useToast();
  const exporter = useAction();
  const [choosing, setChoosing] = useState(false);
  const exportCsv = async () => {
    setChoosing(true);
    let path: string | null = null;
    try {
      path = await chooseSavePath({
        defaultPath: 'azure-time-history.csv',
        filters: [{ name: 'CSV', extensions: ['csv'] }],
        title: 'Export worklogs',
      });
    } catch (error) {
      toast.show({ title: 'Could not open the save dialog', description: error instanceof Error ? error.message : String(error), tone: 'error' });
    } finally {
      setChoosing(false);
    }
    if (!path) return;
    const result = await exporter.run({ type: 'history.exportCsv', path });
    if (result.ok) toast.show({ title: 'Worklogs exported', description: path, tone: 'success' });
  };
  return { exportCsv, pending: choosing || exporter.pending, error: exporter.error?.message ?? null };
}
