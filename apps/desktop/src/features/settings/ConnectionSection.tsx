import { useEffect, useRef, type ReactNode } from 'react';
import { announce } from '../../components/Announcer';
import { Badge, StatusDot, type Tone } from '../../components/Badge';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Fields';
import { CheckIcon, RefreshIcon } from '../../components/icons';
import { SegmentedControl } from '../../components/Segmented';
import { useToast } from '../../components/Toast';
import type { Configuration, SevenPaceAuthMode } from '../../ipc/contract';
import { dispatch } from '../../ipc/engine';
import { useAction, useNow, useSlice } from '../../state/hooks';
import { connectionTone } from '../app/ConnectionStatus';
import { formatDateTime, formatTime, osWords } from './labels';
import { copyText } from './platform';
import { Hint, InlineIssue, SettingsSection } from './SettingsSection';
import { useSettingsForm } from './SettingsForm';
import { issueFor } from './validation';
import styles from './settings.module.css';

interface SecretFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  stored: boolean;
  /** Where secrets are kept: "Keychain", "Windows Credential Manager". */
  store: string;
  emptyText: ReactNode;
  emptyPlaceholder: string;
  isDisabled?: boolean;
}

/** A credential: never shown, blank keeps the stored one. */
function SecretField({ label, value, onChange, stored, store, emptyText, emptyPlaceholder, isDisabled }: SecretFieldProps) {
  const description: ReactNode = stored ? (
    <span className={styles.chipLine}>
      <Badge tone="success" icon={CheckIcon}>
        {`Stored in ${store}`}
      </Badge>
      <span>Leave empty to keep it.</span>
    </span>
  ) : (
    emptyText
  );
  return (
    <TextField
      label={label}
      type="password"
      autoComplete="off"
      value={value}
      onChange={onChange}
      placeholder={stored ? 'Paste a new token to replace the stored one' : emptyPlaceholder}
      description={description}
      isDisabled={isDisabled}
      width="full"
    />
  );
}

/** "Connected" and its siblings, next to a card title. */
function ConnectionChip({ tone, label }: { tone: Tone; label: string }) {
  return (
    <Badge tone={tone} icon={tone === 'success' ? CheckIcon : undefined}>
      {label}
    </Badge>
  );
}

/** Seconds until `expiresAt` at `now`, never negative. */
export function secondsLeft(expiresAt: string, now: number): number {
  const end = Date.parse(expiresAt);
  return Number.isNaN(end) ? 0 : Math.max(0, Math.ceil((end - now) / 1000));
}

function PairingCountdown({ expiresAt }: { expiresAt: string }) {
  const now = useNow(true);
  const left = secondsLeft(expiresAt, now);
  return (
    <>
      <dt>Valid until</dt>
      <dd>
        {formatTime(expiresAt)}
        {' · '}
        {/* Updated every second for sighted users; never announced (no live region). */}
        <span className={styles.countdown}>{left > 0 ? `${left} ${left === 1 ? 'second' : 'seconds'} left` : 'Expired'}</span>
      </dd>
    </>
  );
}

/** 1.14 `PinPairingView`: request a PIN, show it with its expiry, wait for approval. */
function PinPairing() {
  const { settings, draft, busy, preview, os } = useSettingsForm();
  const pairing = settings.pairing;
  const generate = useAction();
  const cancel = useAction();
  const toast = useToast();
  const words = osWords(os);
  // The workspace as typed: 1.14 paired with the unsaved form, and so does `pairing.generatePin`.
  const workspace = draft.sevenPaceUrl.trim();

  // 1.14 cancelled pairing when the workspace changed or the view disappeared.
  const busyRef = useRef(pairing.busy);
  const startedHere = useRef(false);
  useEffect(() => {
    busyRef.current = pairing.busy;
  }, [pairing.busy]);
  const previousWorkspace = useRef(workspace);
  const runCancel = cancel.run;
  useEffect(() => {
    if (previousWorkspace.current === workspace) return;
    previousWorkspace.current = workspace;
    if (busyRef.current) void runCancel({ type: 'pairing.cancel' });
  }, [workspace, runCancel]);
  useEffect(
    () => () => {
      if (startedHere.current && busyRef.current) void dispatch({ type: 'pairing.cancel' }).catch(() => undefined);
    },
    [],
  );

  // Status changes (PIN ready, paired, expired, failed) are announced politely.
  const status = pairing.status;
  useEffect(() => {
    if (status) announce(status);
  }, [status]);

  const canGenerate = !preview && !busy && !pairing.busy && workspace !== '';

  return (
    <div className={styles.pairing}>
      <Hint>
        Pair this {words.device} using 7pace’s mobile PIN flow. Generate a PIN here, then enter it on the 7pace Apps page in Azure
        DevOps.
      </Hint>
      {pairing.pin ? (
        <dl className={styles.pinDetails}>
          <dt>7pace pairing PIN</dt>
          <dd className={styles.pin}>{pairing.pin}</dd>
          {pairing.expiresAt ? <PairingCountdown expiresAt={pairing.expiresAt} /> : null}
        </dl>
      ) : pairing.pairedHost ? (
        <dl className={styles.pinDetails}>
          <dt>Paired with</dt>
          <dd>{pairing.pairedHost}</dd>
        </dl>
      ) : null}
      <div className={styles.row}>
        <Button
          variant="primary"
          onPress={() => {
            startedHere.current = true;
            void generate.run({ type: 'pairing.generatePin', workspace });
          }}
          isDisabled={!canGenerate}
          isPending={generate.pending}
        >
          {pairing.busy ? 'Requesting / waiting…' : 'Generate pairing PIN'}
        </Button>
        {pairing.pin ? (
          <Button
            onPress={() => {
              const pin = pairing.pin ?? '';
              copyText(pin).then(
                () => toast.show({ title: 'PIN copied', tone: 'success' }),
                () => toast.show({ title: 'The PIN could not be copied', tone: 'error' }),
              );
            }}
          >
            Copy PIN
          </Button>
        ) : null}
        {pairing.busy ? (
          <Button onPress={() => void cancel.run({ type: 'pairing.cancel' })} isPending={cancel.pending}>
            Cancel pairing
          </Button>
        ) : null}
      </div>
      {workspace === '' ? <Hint>Enter your 7pace workspace above to pair.</Hint> : null}
      {status ? (
        <p className={styles.status}>
          {pairing.pairedHost ? <CheckIcon className={styles.statusIcon} /> : null}
          <span>{status}</span>
        </p>
      ) : null}
      {generate.error ? <InlineIssue>{generate.error.message}</InlineIssue> : null}
      {cancel.error ? <InlineIssue>{cancel.error.message}</InlineIssue> : null}
      <Hint>
        The PIN lasts one minute. After approval, sign-in and renewal credentials are saved in {words.credentials} immediately.
        Your Azure PAT is still used for ticket details.
      </Hint>
    </div>
  );
}

const AUTH_MODES: ReadonlyArray<{ id: SevenPaceAuthMode; label: string }> = [
  { id: 'mobilePIN', label: 'Mobile PIN pairing' },
  { id: 'apiToken', label: 'API token' },
];

function unconfigured(configuration: Configuration): boolean {
  return configuration.sevenPaceUrl.trim() === '' && configuration.organization.trim() === '';
}

/** Settings → Azure DevOps & 7pace → Azure DevOps: organization, project and the PAT. */
export function AzureSection() {
  const form = useSettingsForm();
  const { draft, update, settings, issues, preview, os } = form;
  const connection = useSlice('connection');
  const organizationIssue = issueFor(issues, 'organization');
  const chip: { tone: Tone; label: string } = !settings.hasAzurePat
    ? { tone: 'neutral', label: 'Not connected yet' }
    : connection?.azureIssue
      ? { tone: 'warning', label: 'Needs attention' }
      : connection?.connected
        ? { tone: 'success', label: 'Connected' }
        : { tone: 'neutral', label: 'Token stored' };
  return (
    <SettingsSection id="azure" actions={<ConnectionChip {...chip} />}>
      <div className={styles.fieldPair}>
        <TextField
          label="Organization"
          description="The name in dev.azure.com/your-organization"
          placeholder="your-organization"
          value={draft.organization}
          onChange={(organization) => update((current) => ({ ...current, organization }))}
          isInvalid={organizationIssue !== undefined}
          errorMessage={organizationIssue}
          autoComplete="off"
          spellCheck="false"
        />
        <TextField
          label="Project (optional)"
          description="Leave empty to find tickets in every project."
          placeholder="Project name"
          value={draft.project}
          onChange={(project) => update((current) => ({ ...current, project }))}
          autoComplete="off"
          spellCheck="false"
        />
      </div>
      <SecretField
        label="Personal access token"
        value={form.azurePat}
        onChange={form.setAzurePat}
        stored={settings.hasAzurePat}
        store={osWords(os).credentials}
        emptyText="Needs “Work Items (Read)”. That is enough for ticket lookup."
        emptyPlaceholder="Paste your Azure PAT"
        isDisabled={preview}
      />
      {connection?.azureIssue ? <InlineIssue tone="warning">{`Azure tickets: ${connection.azureIssue}`}</InlineIssue> : null}
    </SettingsSection>
  );
}

/** Settings → Azure DevOps & 7pace → 7pace Timetracker: workspace and sign-in. */
export function SevenPaceSection() {
  const form = useSettingsForm();
  const { draft, update, settings, issues, preview, os } = form;
  const connection = useSlice('connection');
  const mode = draft.sevenPaceAuthMode;
  const urlIssue = issueFor(issues, 'sevenPaceUrl');
  const chip: { tone: Tone; label: string } =
    !connection || connection.health === 'unconfigured'
      ? { tone: 'neutral', label: 'Not connected yet' }
      : connection.health === 'confirmed'
        ? { tone: 'success', label: 'Connected' }
        : { tone: connectionTone(connection), label: connection.status };
  return (
    <SettingsSection id="sevenPace" actions={<ConnectionChip {...chip} />}>
      <TextField
        label="Workspace URL"
        description="Without /api at the end."
        placeholder="https://your-organization.timehub.7pace.com"
        value={draft.sevenPaceUrl}
        onChange={(sevenPaceUrl) => update((current) => ({ ...current, sevenPaceUrl }))}
        isInvalid={urlIssue !== undefined}
        errorMessage={urlIssue}
        type="url"
        autoComplete="off"
        spellCheck="false"
      />
      <SegmentedControl
        label="Sign in with"
        options={AUTH_MODES}
        selectedKey={mode}
        onSelectionChange={(sevenPaceAuthMode) => update((current) => ({ ...current, sevenPaceAuthMode }))}
      />
      {mode === 'mobilePIN' ? (
        <PinPairing />
      ) : (
        <SecretField
          label="API token"
          value={form.sevenPaceToken}
          onChange={form.setSevenPaceToken}
          stored={settings.hasSevenPaceToken}
          store={osWords(os).credentials}
          emptyText={`Saved in ${osWords(os).credentials} when you save. Or choose Mobile PIN pairing to connect without a token.`}
          emptyPlaceholder="Paste your 7pace API token"
          isDisabled={preview}
        />
      )}
    </SettingsSection>
  );
}

/** Settings → Azure DevOps & 7pace → Connection: when things were checked, and Test connection. */
export function ConnectionCardSection() {
  const { settings, draft, busy, preview } = useSettingsForm();
  const connection = useSlice('connection');
  const retry = useAction();
  const checked = connection?.lastSync
    ? `Timer checked ${formatDateTime(connection.lastSync)}${connection.worklogSync ? ` · time entries checked ${formatTime(connection.worklogSync)}` : ''}`
    : 'The timer has not been checked yet.';
  return (
    <SettingsSection
      id="connection"
      actions={
        <Button
          icon={RefreshIcon}
          onPress={() => void retry.run({ type: 'connection.retry' })}
          isDisabled={busy || preview || !connection}
          isPending={retry.pending || (connection?.connecting ?? false)}
        >
          Test connection
        </Button>
      }
    >
      {connection ? (
        <div className={styles.detailsText}>
          <StatusDot tone={connectionTone(connection)} label={connection.status} showLabel />
          {connection.detail ? <Hint>{connection.detail}</Hint> : null}
          <ul role="list" className={styles.details}>
            <li className={styles.hint}>{checked}</li>
            {connection.connectionIssue ? <li className={styles.warning}>{connection.connectionIssue}</li> : null}
            {connection.progressIssue ? <li className={styles.warning}>{`Time totals: ${connection.progressIssue}`}</li> : null}
            {draft.completionReminders && !settings.hasAzurePat ? (
              <li className={styles.hint}>Add an Azure PAT above to enable ticket completion reminders.</li>
            ) : null}
          </ul>
        </div>
      ) : (
        <Hint>Connecting…</Hint>
      )}
      {retry.error ? <InlineIssue>{retry.error.message}</InlineIssue> : null}
    </SettingsSection>
  );
}

/** Is the draft's saved configuration still empty (the first run)? */
export function useAccountsUnconfigured(): boolean {
  return unconfigured(useSettingsForm().settings.configuration);
}
