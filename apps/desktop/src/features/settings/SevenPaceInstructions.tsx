import { useId } from 'react';
import type { SevenPaceAuthMode } from '../../ipc/contract';
import { ExternalLink } from './ExternalLink';
import styles from './settings.module.css';

/**
 * Where to get the 7pace credential for each sign-in method. The menu names come from the
 * README's first-run steps ("7pace → Apps → Pair Mobile App" in Azure DevOps, "7pace → Settings
 * → Reporting & API"); the PIN's one-minute life from `session/pairing.rs`.
 */
export function SevenPaceInstructions({
  mode,
  workspace,
  credentials,
  open,
}: {
  mode: SevenPaceAuthMode;
  /** The workspace URL as typed, when it is valid: linked so 7pace opens in the browser. */
  workspace: string | null;
  /** Where secrets are kept: "Keychain", "Windows Credential Manager". */
  credentials: string;
  /** Shown expanded (nothing is connected yet), or folded away behind its summary. */
  open: boolean;
}) {
  const titleId = useId();
  const title = mode === 'mobilePIN' ? 'How to get a pairing PIN approved' : 'How to get a 7pace API token';
  return (
    <details className={styles.instructions} open={open}>
      <summary id={titleId} className={styles.instructionsSummary}>
        {title}
      </summary>
      <ol aria-labelledby={titleId} className={styles.steps}>
        {mode === 'mobilePIN' ? (
          <>
            <li>Check the workspace URL above, then choose Generate pairing PIN.</li>
            <li>
              In Azure DevOps, open 7pace Timetracker and go to <strong>Apps → Pair Mobile App</strong>.
            </li>
            <li>Enter the PIN there within one minute. It expires after that; generate a new one if it does.</li>
            <li>When this card says “Paired with …”, save your settings to use the connection.</li>
          </>
        ) : (
          <>
            <li>
              Open 7pace Timetracker
              {workspace ? (
                <>
                  {' ('}
                  <WorkspaceLink url={workspace} />
                  {')'}
                </>
              ) : null}{' '}
              and go to <strong>Settings → Reporting & API</strong>.
            </li>
            <li>Create a token there and copy it.</li>
            <li>{`Paste it in API token below. It is kept in ${credentials} once your settings are saved.`}</li>
          </>
        )}
      </ol>
      {mode === 'mobilePIN' && workspace ? (
        <p className={styles.hint}>
          Your workspace: <WorkspaceLink url={workspace} />
        </p>
      ) : null}
    </details>
  );
}

function WorkspaceLink({ url }: { url: string }) {
  return <ExternalLink href={url}>{url.replace(/^https:\/\//, '').replace(/\/$/, '')}</ExternalLink>;
}
