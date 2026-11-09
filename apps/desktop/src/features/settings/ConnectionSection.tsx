import { useEffect, useRef, useState, type ReactNode } from 'react';
import { announce } from '../../components/Announcer';
import { Badge, type Tone } from '../../components/Badge';
import { Button } from '../../components/Button';
import { TextField } from '../../components/Fields';
import { Dialog } from '../../components/Dialog';
import { CheckIcon, RefreshIcon, WarningIcon } from '../../components/icons';
import { SegmentedControl } from '../../components/Segmented';
import { useToast } from '../../components/Toast';
import type { ConnectionSlice, SevenPaceAuthMode } from '../../ipc/contract';
import { accountSetupUnfinished } from './accountDefaults';
import { dispatch } from '../../ipc/engine';
import { useAction, useNow, useSlice } from '../../state/hooks';
import { connectionTone } from '../app/ConnectionStatus';
import { formatDateTime, formatTime, osWords } from './labels';
import { copyText } from './platform';
import { KeyIcon } from './icons';
import { sectionAnchorId } from './sections';
import { FullRow, Hint, InlineIssue, IssueRow, SectionFooter, SettingRow, SettingsSection } from './SettingsSection';
import { StatusTiles } from './StatusTiles';
import { useSettingsForm } from './SettingsForm';
import { issueFor } from './validation';
import { mark, t, tn } from '../../i18n';
import { AzureTokenTest, useAzureTokenTest } from './AzureTokenTest';
import { SevenPaceInstructions } from './SevenPaceInstructions';
import styles from './settings.module.css';

interface SecretRowProps {
  title: string;
  help: ReactNode;
  value: string;
  onChange: (value: string) => void;
  stored: boolean;
  /** Where secrets are kept: "Keychain", "Windows Credential Manager". */
  store: string;
  emptyPlaceholder: string;
  isDisabled?: boolean;
  /** Enter in the field (Test and save for the Azure token). */
  onEnter?: () => void;
}

/**
 * A credential row: never shown, blank keeps the stored one. A stored credential shows
 * "Stored in Keychain" and Replace…, which opens the field to paste a new one.
 */
function SecretRow({ title, help, value, onChange, stored, store, emptyPlaceholder, isDisabled, onEnter }: SecretRowProps) {
  const [replacing, setReplacing] = useState(false);
  const showField = !stored || replacing || value !== '';
  return (
    <SettingRow title={title} help={help} stacked={showField}>
      {({ helpId }) =>
        showField ? (
          <div className={styles.secretControl}>
            {stored ? (
              <Badge tone="success" icon={CheckIcon}>
                {t('Stored in {store}', { store })}
              </Badge>
            ) : null}
            <TextField
              label={title}
              hideLabel
              aria-describedby={helpId}
              type="password"
              autoComplete="off"
              value={value}
              onChange={onChange}
              placeholder={stored ? t('Paste a new token to replace the stored one') : emptyPlaceholder}
              isDisabled={isDisabled}
              width="full"
              autoFocus={replacing && value === ''}
              onKeyDown={
                onEnter
                  ? (event) => {
                      if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
                        event.continuePropagation();
                        return;
                      }
                      onEnter();
                    }
                  : undefined
              }
            />
            {stored ? (
              <Button
                size="small"
                variant="plain"
                onPress={() => {
                  onChange('');
                  setReplacing(false);
                }}
              >
                {t('Keep the stored one')}
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <Badge tone="success" icon={CheckIcon}>
              {t('Stored in {store}', { store })}
            </Badge>
            <Button size="small" onPress={() => setReplacing(true)} isDisabled={isDisabled}>
              {t('Replace…')}
            </Button>
          </>
        )
      }
    </SettingRow>
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
      <dt>{t('Valid until')}</dt>
      <dd>
        {formatTime(expiresAt)}
        {' · '}
        {/* Updated every second for sighted users; never announced (no live region). */}
        <span className={styles.countdown}>{left > 0 ? tn(left, '{count} second left', '{count} seconds left') : t('Expired')}</span>
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
    <FullRow tone="sunken" className={styles.pairing}>
      <div className={styles.pairingSteps}>
        <SevenPaceInstructions mode="mobilePIN" workspace={null} credentials={words.credentials} open collapsible={false} />
        {workspace === '' ? <Hint>{t('Enter your 7pace workspace above to pair.')}</Hint> : null}
        {status ? (
          <p className={styles.status}>
            {pairing.pairedHost ? <CheckIcon className={styles.statusIcon} /> : null}
            <span>{status}</span>
          </p>
        ) : null}
        {generate.error ? <InlineIssue>{generate.error.message}</InlineIssue> : null}
        {cancel.error ? <InlineIssue>{cancel.error.message}</InlineIssue> : null}
      </div>
      <div className={styles.pairingActions}>
        {pairing.pin ? (
          <dl className={styles.pinDetails}>
            <dt>{t('7pace pairing PIN')}</dt>
            <dd className={styles.pin}>{pairing.pin}</dd>
            {pairing.expiresAt ? <PairingCountdown expiresAt={pairing.expiresAt} /> : null}
          </dl>
        ) : null}
        <div className={styles.buttonRow}>
          <Button
            variant={pairing.pairedHost ? 'secondary' : 'primary'}
            onPress={() => {
              startedHere.current = true;
              void generate.run({ type: 'pairing.generatePin', workspace });
            }}
            isDisabled={!canGenerate}
            isPending={generate.pending}
          >
            {pairing.busy ? t('Requesting / waiting…') : t('Generate pairing PIN')}
          </Button>
          {pairing.pin ? (
            <Button
              onPress={() => {
                const pin = pairing.pin ?? '';
                copyText(pin).then(
                  () => toast.show({ title: t('PIN copied'), tone: 'success' }),
                  () => toast.show({ title: t('The PIN could not be copied'), tone: 'error' }),
                );
              }}
            >
              {t('Copy PIN')}
            </Button>
          ) : null}
          {pairing.busy ? (
            <Button onPress={() => void cancel.run({ type: 'pairing.cancel' })} isPending={cancel.pending}>
              {t('Cancel pairing')}
            </Button>
          ) : null}
        </div>
      </div>
    </FullRow>
  );
}

const AUTH_MODES: ReadonlyArray<{ id: SevenPaceAuthMode; label: string }> = [
  { id: 'mobilePIN', label: mark('Mobile PIN pairing') },
  { id: 'apiToken', label: mark('API token') },
];

/** Settings → Azure DevOps & 7pace → Azure DevOps: organization, project and the PAT. */
export function AzureSection() {
  const form = useSettingsForm();
  const { draft, update, settings, issues, preview, os } = form;
  const connection = useSlice('connection');
  const organizationIssue = issueFor(issues, 'organization');
  const tester = useAzureTokenTest();
  const chip = azureChip(settings.hasAzurePat, connection);
  return (
    <SettingsSection id="azure" subtitle={t('Used to find tickets, titles and states.')} actions={<ConnectionChip {...chip} />}>
      <SettingRow title={t('Organization')} help={<>{t('The name in dev.azure.com/')}<b>{t('organization')}</b></>}>
        {({ helpId }) => (
          <TextField
            label={t('Organization')}
            hideLabel
            aria-describedby={helpId}
            placeholder={t('your-organization')}
            value={draft.organization}
            onChange={(organization) => update((current) => ({ ...current, organization }))}
            isInvalid={organizationIssue !== undefined}
            errorMessage={organizationIssue}
            autoComplete="off"
            spellCheck="false"
            className={styles.fieldMedium}
          />
        )}
      </SettingRow>
      <SettingRow
        title={
          <>
            {t('Project')} <span className={styles.optional}>{t('(optional)')}</span>
          </>
        }
        help={t('Leave empty to search tickets in every project.')}
      >
        {({ helpId }) => (
          <TextField
            label={t('Project (optional)')}
            hideLabel
            aria-describedby={helpId}
            placeholder={t('Project name')}
            value={draft.project}
            onChange={(project) => update((current) => ({ ...current, project }))}
            autoComplete="off"
            spellCheck="false"
            className={styles.fieldMedium}
          />
        )}
      </SettingRow>
      <SecretRow
        title={t('Personal access token')}
        help={settings.hasAzurePat ? t('Needs Work Items (Read). Paste a new one only to replace it.') : t('Needs “Work Items (Read)”. That is enough for ticket lookup.')}
        value={form.azurePat}
        onChange={form.setAzurePat}
        stored={settings.hasAzurePat}
        store={osWords(os).credentials}
        emptyPlaceholder={t('Paste your Azure PAT')}
        isDisabled={preview}
        onEnter={() => void tester.run()}
      />
      {connection?.azureIssue ? <IssueRow tone="warning">{t('Azure tickets: {issue}', { issue: connection.azureIssue })}</IssueRow> : null}
      <AzureTokenTest tester={tester} />
    </SettingsSection>
  );
}

function azureChip(hasAzurePat: boolean, connection: ConnectionSlice | undefined): { tone: Tone; label: string } {
  if (!hasAzurePat) return { tone: 'neutral', label: t('Not connected yet') };
  if (connection?.azureIssue) return { tone: 'warning', label: t('Needs attention') };
  if (connection?.connected) return { tone: 'success', label: t('Connected') };
  return { tone: 'neutral', label: t('Token stored') };
}

function sevenPaceChip(connection: ConnectionSlice | undefined): { tone: Tone; label: string } {
  if (!connection || connection.health === 'unconfigured') return { tone: 'neutral', label: t('Not connected yet') };
  if (connection.health === 'confirmed') return { tone: 'success', label: t('Connected') };
  return { tone: connectionTone(connection), label: connection.status };
}

/** "Timer checked 14:59:40 · time entries checked 14:55", or why nothing was checked. */
function checkedLine(connection: ConnectionSlice | undefined): string {
  if (!connection?.lastSync) return t('The timer has not been checked yet.');
  const timer = t('Timer checked {time}', { time: formatDateTime(connection.lastSync) });
  if (!connection.worklogSync) return timer;
  return `${timer} · ${t('time entries checked {time}', { time: formatTime(connection.worklogSync) })}`;
}

/** Settings → Azure DevOps & 7pace → 7pace Timetracker: workspace, sign-in and Unpair. */
export function SevenPaceSection() {
  const form = useSettingsForm();
  const { draft, update, settings, issues, preview, busy, os } = form;
  const connection = useSlice('connection');
  const mode = draft.sevenPaceAuthMode;
  const urlIssue = issueFor(issues, 'sevenPaceUrl');
  const workspace = draft.sevenPaceUrl.trim();
  const words = osWords(os);
  const hasCredential = mode === 'mobilePIN' ? (connection?.hasSevenPaceToken ?? false) : settings.hasSevenPaceToken;
  const unpair = useAction();
  const [confirming, setConfirming] = useState(false);
  const paired = settings.pairing.pairedHost;
  return (
    <SettingsSection id="sevenPace" subtitle={t('Where your time entries are stored.')} actions={<ConnectionChip {...sevenPaceChip(connection)} />}>
      <SettingRow title={t('Workspace URL')} help={t('Without /api at the end.')}>
        {({ helpId }) => (
          <TextField
            label={t('Workspace URL')}
            hideLabel
            aria-describedby={helpId}
            placeholder={t('https://your-organization.timehub.7pace.com')}
            value={draft.sevenPaceUrl}
            onChange={(sevenPaceUrl) => update((current) => ({ ...current, sevenPaceUrl }))}
            isInvalid={urlIssue !== undefined}
            errorMessage={urlIssue}
            type="url"
            autoComplete="off"
            spellCheck="false"
            className={styles.fieldWide}
          />
        )}
      </SettingRow>
      <SettingRow title={t('Sign in with')} help={t('PIN pairing works without an API token.')}>
        <SegmentedControl
          label={t('Sign in with')}
          hideLabel
          options={AUTH_MODES.map(({ id, label }) => ({ id, label: t(label) }))}
          selectedKey={mode}
          onSelectionChange={(sevenPaceAuthMode) => update((current) => ({ ...current, sevenPaceAuthMode }))}
        />
      </SettingRow>
      {mode === 'mobilePIN' ? (
        <PinPairing />
      ) : (
        <>
          <FullRow tone="sunken">
            <SevenPaceInstructions
              key={mode}
              mode={mode}
              workspace={workspace !== '' && urlIssue === undefined ? workspace : null}
              credentials={words.credentials}
              open
              collapsible={false}
            />
          </FullRow>
          <SecretRow
            title={t('API token')}
            help={
              settings.hasSevenPaceToken
                ? t('Paste a new one only to replace it.')
                : t('Saved in {store} when you save. Or choose Mobile PIN pairing to connect without a token.', { store: words.credentials })
            }
            value={form.sevenPaceToken}
            onChange={form.setSevenPaceToken}
            stored={settings.hasSevenPaceToken}
            store={words.credentials}
            emptyPlaceholder={t('Paste your 7pace API token')}
            isDisabled={preview}
          />
        </>
      )}
      {connection?.connectionIssue ? <IssueRow tone="warning">{connection.connectionIssue}</IssueRow> : null}
      {unpair.error ? <IssueRow>{unpair.error.message}</IssueRow> : null}
      <SectionFooter
        actions={
          hasCredential ? (
            <Button size="small" variant="plain" className={styles.dangerButton} onPress={() => setConfirming(true)} isDisabled={busy || preview}>
              {mode === 'mobilePIN' ? t('Unpair') : t('Remove token')}
            </Button>
          ) : null
        }
      >
        <span>{[paired && mode === 'mobilePIN' ? t('Paired with {host}', { host: paired }) : null, checkedLine(connection)].filter(Boolean).join(' · ')}</span>
      </SectionFooter>
      <Dialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        role="alertdialog"
        size="small"
        title={mode === 'mobilePIN' ? t('Unpair 7pace?') : t('Remove the 7pace API token?')}
        description={t('The 7pace sign-in is removed from {store}. Your time entries in 7pace and the rest of your settings stay. Pair again or paste a token to reconnect.', { store: words.credentials })}
        primaryAction={{
          label: mode === 'mobilePIN' ? t('Unpair') : t('Remove token'),
          variant: 'destructive',
          isPending: unpair.pending,
          onAction: () => {
            void unpair.run({ type: 'pairing.unpair' }).then((result) => {
              if (result.ok) setConfirming(false);
            });
          },
        }}
      />
    </SettingsSection>
  );
}

/**
 * The tiles at the top of Settings → Azure DevOps & 7pace (also the `#settings/connection`
 * anchor): Azure, 7pace and the stored credentials, plus what went wrong.
 */
export function AccountTiles() {
  const { settings, draft, os } = useSettingsForm();
  const connection = useSlice('connection');
  const words = osWords(os);
  const azure = azureChip(settings.hasAzurePat, connection);
  const sevenPace = sevenPaceChip(connection);
  const tokens = (settings.hasAzurePat ? 1 : 0) + (connection?.hasSevenPaceToken || settings.hasSevenPaceToken ? 1 : 0);
  const account = [draft.organization.trim(), draft.project.trim()].filter(Boolean).join(' · ');
  const tileTone = (tone: Tone) => (tone === 'success' ? 'success' : tone === 'neutral' ? 'neutral' : 'warning');
  return (
    <div id={sectionAnchorId('connection')} tabIndex={-1} className={styles.anchorBlock}>
      <StatusTiles
        label={t('Connection status')}
        tiles={[
          {
            id: 'azure',
            icon: azure.tone === 'success' ? CheckIcon : WarningIcon,
            tone: tileTone(azure.tone),
            title: azure.tone === 'success' ? t('Azure DevOps connected') : t('Azure DevOps: {status}', { status: azure.label.toLowerCase() }),
            detail: account || t('No organization yet'),
          },
          {
            id: 'sevenPace',
            icon: sevenPace.tone === 'success' ? CheckIcon : WarningIcon,
            tone: tileTone(sevenPace.tone),
            title: sevenPace.tone === 'success' ? t('7pace connected') : t('7pace: {status}', { status: sevenPace.label.toLowerCase() }),
            detail:
              draft.sevenPaceAuthMode === 'mobilePIN'
                ? settings.pairing.pairedHost
                  ? t('Paired with mobile PIN')
                  : t('Mobile PIN pairing')
                : t('API token'),
          },
          {
            id: 'tokens',
            icon: KeyIcon,
            tone: 'accent',
            title: tn(tokens, '{count} token in {store}', '{count} tokens in {store}', { store: words.credentials }),
            detail: t('Never shown or exported'),
          },
        ]}
      />
      {connection?.detail ? <Hint>{connection.detail}</Hint> : null}
      {connection?.progressIssue ? <InlineIssue tone="warning">{t('Time totals: {issue}', { issue: connection.progressIssue })}</InlineIssue> : null}
      {draft.completionReminders && !settings.hasAzurePat ? <Hint>{t('Add an Azure PAT to enable ticket completion reminders.')}</Hint> : null}
    </div>
  );
}

/** "Test both connections" at the top of Settings → Azure DevOps & 7pace. */
export function TestConnectionsButton() {
  const { busy, preview } = useSettingsForm();
  const connection = useSlice('connection');
  const retry = useAction();
  return (
    <div className={styles.headerAction}>
      <Button
        icon={RefreshIcon}
        onPress={() => void retry.run({ type: 'connection.retry' })}
        isDisabled={busy || preview || !connection}
        isPending={retry.pending || (connection?.connecting ?? false)}
      >
        {t('Test both connections')}
      </Button>
      {retry.error ? <InlineIssue>{retry.error.message}</InlineIssue> : null}
    </div>
  );
}

/** Is the account setup unfinished (the first run: no 7pace workspace saved yet)? */
export function useAccountsUnconfigured(): boolean {
  return accountSetupUnfinished(useSettingsForm().settings.configuration);
}
