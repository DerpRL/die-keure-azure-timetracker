import { useEffect, useRef, type ReactNode } from 'react';
import { announce } from '../../components/Announcer';
import { Badge, StatusDot } from '../../components/Badge';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Fields';
import { CheckIcon, RefreshIcon } from '../../components/icons';
import { SegmentedControl } from '../../components/Segmented';
import { useToast } from '../../components/Toast';
import type { SevenPaceAuthMode } from '../../ipc/contract';
import { dispatch } from '../../ipc/engine';
import { useAction, useNow, useSlice } from '../../state/hooks';
import { connectionTone } from '../app/ConnectionStatus';
import { formatDateTime, formatTime, osWords } from './labels';
import { copyText } from './platform';
import { Divider, Hint, InlineIssue, SettingsGroup, SettingsSection } from './SettingsSection';
import { useSettingsForm } from './SettingsForm';
import { issueFor } from './validation';
import styles from './settings.module.css';

interface SecretFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  stored: boolean;
  storedText: string;
  emptyText: string;
  placeholder: string;
  isDisabled?: boolean;
}

/** A credential: never shown, blank keeps the stored one (1.14 `SecureField`). */
function SecretField({ label, value, onChange, stored, storedText, emptyText, placeholder, isDisabled }: SecretFieldProps) {
  const description: ReactNode = stored ? (
    <span className={styles.secretDescription}>
      <Badge tone="success" icon={CheckIcon}>
        Stored
      </Badge>
      <span>{storedText}</span>
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
      placeholder={placeholder}
      description={description}
      isDisabled={isDisabled}
      width="full"
    />
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
  const savedWorkspace = settings.configuration.sevenPaceUrl.trim();
  const workspace = draft.sevenPaceUrl.trim();
  const unsavedWorkspace = workspace !== savedWorkspace;

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

  const canGenerate = !preview && !busy && !pairing.busy && workspace !== '' && !unsavedWorkspace;

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
            void generate.run({ type: 'pairing.generatePin' });
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
      {workspace !== '' && unsavedWorkspace ? (
        <Hint>Save changes first: pairing uses the saved 7pace workspace.</Hint>
      ) : null}
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

/** 1.14 `ConnectionDetailsView`. */
function ConnectionDetails() {
  const { settings, draft, busy, preview } = useSettingsForm();
  const connection = useSlice('connection');
  const retry = useAction();
  if (!connection) return null;
  return (
    <SettingsGroup title="Connection details">
      <StatusDot tone={connectionTone(connection)} label={connection.status} showLabel />
      {connection.detail ? <Hint>{connection.detail}</Hint> : null}
      <ul role="list" className={styles.details}>
        <li>{connection.lastSync ? `Timer checked ${formatDateTime(connection.lastSync)}` : 'The timer has not been checked yet.'}</li>
        {connection.worklogSync ? <li>{`Time entries checked ${formatDateTime(connection.worklogSync)}`}</li> : null}
        {connection.connectionIssue ? <li className={styles.warning}>{connection.connectionIssue}</li> : null}
        {connection.azureIssue ? <li className={styles.warning}>{`Azure tickets: ${connection.azureIssue}`}</li> : null}
        {connection.progressIssue ? <li className={styles.warning}>{`Time totals: ${connection.progressIssue}`}</li> : null}
        {draft.completionReminders && !settings.hasAzurePat ? (
          <li>Add an Azure PAT in Accounts to enable ticket completion reminders.</li>
        ) : null}
      </ul>
      <div className={styles.row}>
        <Button
          icon={RefreshIcon}
          onPress={() => void retry.run({ type: 'connection.retry' })}
          isDisabled={busy || preview}
          isPending={retry.pending || connection.connecting}
        >
          Refresh connection
        </Button>
      </div>
      {retry.error ? <InlineIssue>{retry.error.message}</InlineIssue> : null}
    </SettingsGroup>
  );
}

const AUTH_MODES: ReadonlyArray<{ id: SevenPaceAuthMode; label: string }> = [
  { id: 'mobilePIN', label: 'Mobile PIN pairing' },
  { id: 'apiToken', label: 'API token' },
];

/** Settings → Accounts (1.14 `accountSection` + `connectionSection`). */
export function ConnectionSection() {
  const form = useSettingsForm();
  const { draft, update, settings, issues, preview, os } = form;
  const words = osWords(os);
  const unconfigured = settings.configuration.sevenPaceUrl.trim() === '' && settings.configuration.organization.trim() === '';
  const mode = draft.sevenPaceAuthMode;
  const organizationIssue = issueFor(issues, 'organization');
  const urlIssue = issueFor(issues, 'sevenPaceUrl');

  return (
    <SettingsSection id="connection" subtitle="Azure DevOps provides ticket details; 7pace Timetracker records your time.">
      {unconfigured ? (
        <Banner tone="info" title="Connect your accounts to start tracking" live="off">
          Enter your Azure organization and 7pace workspace, add your credentials, then choose Save changes.
        </Banner>
      ) : null}
      <SettingsGroup title="Azure DevOps">
        <TextField
          label="Azure organization"
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
          label="Azure project"
          description="Optional. Leave empty to find tickets across your organization."
          placeholder="Project name"
          value={draft.project}
          onChange={(project) => update((current) => ({ ...current, project }))}
          autoComplete="off"
          spellCheck="false"
        />
        <SecretField
          label="Azure DevOps PAT"
          value={form.azurePat}
          onChange={form.setAzurePat}
          stored={settings.hasAzurePat}
          storedText={`Saved in ${words.credentials}. Leave blank to keep it.`}
          emptyText="Work Items (Read) permission is enough for ticket lookup."
          placeholder="Paste your Azure PAT"
          isDisabled={preview}
        />
      </SettingsGroup>
      <Divider />
      <SettingsGroup title="7pace Timetracker">
        <TextField
          label="7pace workspace"
          description="Use your organization’s 7pace workspace URL, without /api."
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
          label="7pace sign-in"
          options={AUTH_MODES}
          selectedKey={mode}
          onSelectionChange={(sevenPaceAuthMode) => update((current) => ({ ...current, sevenPaceAuthMode }))}
        />
        {mode === 'mobilePIN' ? (
          <PinPairing />
        ) : (
          <>
            <SecretField
              label="7pace API token"
              value={form.sevenPaceToken}
              onChange={form.setSevenPaceToken}
              stored={settings.hasSevenPaceToken}
              storedText={`Saved in ${words.credentials}. Leave blank to keep the existing API token.`}
              emptyText={`Saved in ${words.credentials} when you save.`}
              placeholder="Paste your 7pace API token"
              isDisabled={preview}
            />
            <Hint>Or choose Mobile PIN pairing above to connect without creating an API token.</Hint>
          </>
        )}
      </SettingsGroup>
      <Divider />
      <ConnectionDetails />
    </SettingsSection>
  );
}
