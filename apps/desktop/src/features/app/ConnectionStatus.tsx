import { StatusDot, type Tone } from '../../components/Badge';
import type { ConnectionSlice, Health } from '../../ipc/contract';
import { useSlice } from '../../state/hooks';

const TONES: Record<Health, Tone> = {
  unconfigured: 'neutral',
  connecting: 'info',
  confirmed: 'success',
  stale: 'warning',
  disconnected: 'danger',
  authentication: 'danger',
  accessDenied: 'danger',
};

/** The tone of the connection's health dot (header, panel, settings). */
export function connectionTone(connection: ConnectionSlice | undefined): Tone {
  return connection ? TONES[connection.health] : 'neutral';
}

/** The page header's connection status (1.14 `ConnectionHealthView`). */
export function ConnectionStatus() {
  const connection = useSlice('connection');
  if (!connection) return <StatusDot tone="neutral" label="Connecting…" showLabel />;
  return (
    <span title={connection.detail ?? undefined}>
      <StatusDot
        tone={connectionTone(connection)}
        label={connection.status}
        showLabel
        pulse={connection.health === 'connecting'}
      />
    </span>
  );
}
