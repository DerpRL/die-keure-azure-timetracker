import { useContext, type ReactNode } from 'react';
import { Badge, type Tone } from '../../components/Badge';
import { Button } from '../../components/Button';
import { ChevronRightIcon, CheckIcon, ExternalLinkIcon, KeyboardIcon, type IconComponent } from '../../components/icons';
import { useToast } from '../../components/Toast';
import { ShortcutContext } from '../../shortcuts/hooks';
import { useAction, useSlice } from '../../state/hooks';
import { DOWNLOADS_URL } from '../updates/api';
import { useUpdateStatus } from '../updates/useUpdateStatus';
import { connectionTone } from '../app/ConnectionStatus';
import { BugIcon, CodeIcon, LockIcon, NotesIcon, RestartIcon } from './icons';
import { osWords } from './labels';
import { copyText, openExternalLink } from './platform';
import { SectionFooter, SettingsSection } from './SettingsSection';
import { useSettingsForm } from './SettingsForm';
import { mark, t } from '../../i18n';
import styles from './settings.module.css';

/** The public repository, from the releases page the updater uses. */
const REPOSITORY_URL = DOWNLOADS_URL.replace(/\/releases\/latest$/, '');

/** One line of "Help": an icon, a label, a hint and an arrow (design "lnk"). */
function HelpLink({ icon: Icon, label, detail, onPress, external = false }: { icon: IconComponent; label: string; detail?: string; onPress: () => void; external?: boolean }) {
  return (
    <li>
      <button type="button" className={styles.helpLink} onClick={onPress}>
        <Icon className={styles.helpIcon} />
        <span className={styles.helpLabel}>{label}</span>
        {detail ? <span className={styles.listMeta}>{`· ${detail}`}</span> : null}
        {external ? <span className="visually-hidden"> {t('(opens in your browser)')}</span> : null}
        {external ? <ExternalLinkIcon className={styles.helpArrow} /> : <ChevronRightIcon className={styles.helpArrow} />}
      </button>
    </li>
  );
}

/** A plain-text summary for support: versions and connection status, never tokens or URLs with secrets. */
export function diagnosticSummary({
  version,
  os,
  userAgent,
  azure,
  sevenPace,
  connection,
}: {
  version: string;
  os: string;
  userAgent: string;
  azure: string;
  sevenPace: string;
  connection: string;
}): string {
  return [`Azure timetracker ${version}`, `System: ${os} · ${userAgent}`, `Azure DevOps: ${azure}`, `7pace: ${sevenPace}`, `Connection: ${connection}`].join('\n');
}

/** Settings → About: the app, what it is connected to, what happens with your data, and help. */
export function AboutSection() {
  const { app, os, settings, draft, goTo, dirty, preview } = useSettingsForm();
  const connection = useSlice('connection');
  const { status } = useUpdateStatus();
  const shortcuts = useContext(ShortcutContext);
  const onboarding = useAction();
  const toast = useToast();
  const words = osWords(os);
  const version = status?.currentVersion || app?.version || '';
  const upToDate = status?.enabled && status.checkedAt && !status.version && status.phase !== 'failed';
  const azureAccount = [draft.organization.trim(), draft.project.trim()].filter(Boolean).join(' · ');
  const azureState: { tone: Tone; label: string } = !settings.hasAzurePat
    ? { tone: 'neutral', label: mark('Not connected') }
    : connection?.azureIssue
      ? { tone: 'warning', label: mark('Needs attention') }
      : { tone: 'success', label: mark('Connected') };
  const sevenPaceState: { tone: Tone; label: string } =
    !connection || connection.health === 'unconfigured'
      ? { tone: 'neutral', label: mark('Not connected') }
      : connection.health === 'confirmed'
        ? { tone: 'success', label: mark('Connected') }
        : { tone: connectionTone(connection), label: connection.status };
  const open = (url: string) => () =>
    void openExternalLink(url).catch((error: unknown) =>
      toast.show({ title: t('The link could not be opened'), description: error instanceof Error ? error.message : String(error), tone: 'error' }),
    );
  const copy = () => {
    const text = diagnosticSummary({
      version: version || 'unknown',
      os: words.name,
      userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
      azure: `${azureState.label}${azureAccount ? ` (${azureAccount})` : ''}`,
      sevenPace: `${sevenPaceState.label}${connection?.host ? ` (${connection.host})` : ''}`,
      connection: connection?.status ?? 'unknown',
    });
    copyText(text).then(
      () => toast.show({ title: t('Diagnostic info copied'), tone: 'success' }),
      () => toast.show({ title: t('The diagnostic info could not be copied'), tone: 'error' }),
    );
  };
  const data: ReactNode[] = [
    t('Tokens are stored in {store}, never in files.', { store: words.credentials }),
    t('Git repositories are only read. Files and branches are never changed.'),
    t('Review status, drafts and suggestions stay on this {device}.', { device: words.device }),
    t('Calendar events and Figma window titles never leave your {device}.', { device: words.device }),
  ];
  return (
    <>
      <SettingsSection id="about" headless>
        <div className={styles.aboutApp}>
          <div className={styles.aboutText}>
            <p className={styles.aboutName}>Azure timetracker</p>
            <p className={styles.muted}>{t('Time tracking for Azure DevOps and 7pace, from your {place}.', { place: words.trayPlace })}</p>
            <p className={styles.aboutVersion}>
              <span className={styles.rowTitle}>{version ? t('Version {version}', { version }) : t('Version unknown')}</span>
              <span className={styles.muted}>{`· ${words.name}`}</span>
              {upToDate ? (
                <Badge tone="success" icon={CheckIcon}>
                  {t('Up to date')}
                </Badge>
              ) : status?.version ? (
                <Badge tone="accent">{t('{version} available', { version: status.version })}</Badge>
              ) : null}
            </p>
          </div>
          <Button onPress={() => goTo('updates')}>{t('Check for updates')}</Button>
        </div>
      </SettingsSection>
      <section aria-labelledby="about-connected" className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <h3 id="about-connected" className={styles.sectionTitle}>
            {t('Connected to')}
          </h3>
          <Button size="small" variant="plain" onPress={() => goTo('azure')}>
            {t('Manage')}
          </Button>
        </div>
        <ul role="list" aria-label={t('Connections')} className={styles.rowList}>
          <li className={styles.listRow}>
            <span className={styles.listText}>
              <span className={styles.rowTitle}>Azure DevOps</span>
              <span className={styles.listMeta}>{azureAccount || t('No organization yet')}</span>
            </span>
            <Badge tone={azureState.tone}>{t(azureState.label)}</Badge>
          </li>
          <li className={styles.listRow}>
            <span className={styles.listText}>
              <span className={styles.rowTitle}>7pace Timetracker</span>
              <span className={styles.listMeta}>{connection?.host ?? (draft.sevenPaceUrl.replace(/^https:\/\//, '') || t('No workspace yet'))}</span>
            </span>
            <Badge tone={sevenPaceState.tone}>{t(sevenPaceState.label)}</Badge>
          </li>
        </ul>
      </section>
      <section aria-labelledby="about-data" className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <h3 id="about-data" className={styles.sectionTitle}>
            {t('Your data')}
          </h3>
        </div>
        <ul role="list" className={styles.dataList}>
          {data.map((line, index) => (
            <li key={index}>
              <LockIcon className={styles.helpIcon} />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="about-help" className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <h3 id="about-help" className={styles.sectionTitle}>
            {t('Help')}
          </h3>
        </div>
        <ul role="list" className={styles.helpList}>
          <HelpLink icon={NotesIcon} label={t('Release notes')} detail={version ? t('What changed in {version}', { version }) : undefined} onPress={open(`${REPOSITORY_URL}/releases`)} external />
          <HelpLink icon={CodeIcon} label={t('GitHub repository')} detail={t('Source code and releases')} onPress={open(REPOSITORY_URL)} external />
          <HelpLink icon={BugIcon} label={t('Report an issue')} detail={t('Opens a new issue on GitHub')} onPress={open(`${REPOSITORY_URL}/issues/new`)} external />
          {shortcuts ? <HelpLink icon={KeyboardIcon} label={t('Keyboard shortcuts')} onPress={shortcuts.openCheatSheet} /> : null}
          {!dirty && !preview ? (
            <HelpLink icon={RestartIcon} label={t('Show onboarding again')} onPress={() => void onboarding.run({ type: 'app.restartOnboarding' })} />
          ) : null}
        </ul>
        <SectionFooter
          actions={
            <Button size="small" onPress={copy}>
              {t('Copy diagnostic info')}
            </Button>
          }
        >
          {t('Copies the version, system and connection status. No tokens.')}
        </SectionFooter>
      </section>
    </>
  );
}
