import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { Section } from '../../components/Card';
import { Dialog } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { SearchField, TextField } from '../../components/Fields';
import { ChevronDownIcon, FigmaIcon } from '../../components/icons';
import { Menu, MenuItem, MenuPopover, MenuTrigger } from '../../components/Menu';
import { TicketLink } from '../../features/ticketContext/TicketLink';
import type { FigmaFileView, FigmaSlice } from '../../ipc/contract';
import { useAction, useSlice } from '../../state/hooks';
import { BrowserIcon, DesktopAppIcon } from './icons';
import { formatSeen, parseTicketNumber } from './model';
import styles from './figma.module.css';

/** Files rendered at once; "Show more" adds the next page. */
export const FILE_PAGE_SIZE = 50;
/** Typing pauses this long before the engine filters the register. */
export const SEARCH_DELAY_MS = 250;

/** "Link Figma file" (1.14 `FigmaLinkView`): the engine verifies the ticket before saving. */
function LinkDialog({ file, onClose }: { file: FigmaFileView | null; onClose: () => void }) {
  const app = useSlice('app');
  const link = useAction();
  // Remounted per file (see `key` below), so the draft starts from the current link.
  const [text, setText] = useState(file?.ticketId ? String(file.ticketId) : '');
  const [touched, setTouched] = useState(false);

  const ticketId = parseTicketNumber(text);
  const busy = app?.busy ?? false;
  const save = async () => {
    if (!file || ticketId === null) return;
    const result = await link.run({ type: 'figma.link', fileKey: file.key, ticketId });
    if (result.ok) onClose();
  };

  return (
    <Dialog
      isOpen={file !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Link Figma file"
      description={file?.name}
      size="small"
      primaryAction={{
        label: 'Save link',
        onAction: () => void save(),
        isDisabled: ticketId === null || busy,
        isPending: link.pending,
      }}
    >
      <TextField
        label="Azure ticket number"
        value={text}
        onChange={(value) => {
          setText(value);
          setTouched(true);
        }}
        inputMode="numeric"
        autoComplete="off"
        autoFocus
        isInvalid={touched && text.trim() !== '' && ticketId === null}
        errorMessage="Enter a valid ticket number."
        description="The ticket is verified before saving. This only links the file; no timer or tracked entry changes."
      />
      {link.error ? (
        <p role="alert" className={styles.error}>
          {link.error.message}
        </p>
      ) : null}
    </Dialog>
  );
}

function FileRow({ file, titleOnly, onLink }: { file: FigmaFileView; titleOnly: boolean; onLink: (file: FigmaFileView) => void }) {
  const app = useSlice('app');
  const connection = useSlice('connection');
  const figma = useSlice('figma');
  const open = useAction();
  const unlink = useAction();
  const busy = app?.busy ?? false;
  const offline = !(connection?.connected ?? false);
  const canDesktop = !!file.desktopUrl && (figma?.installed ?? true);
  const canBrowser = !!file.webUrl;
  const seen = formatSeen(file.lastSeen);
  const error = open.error ?? unlink.error;
  return (
    <li className={styles.file}>
      <div className={styles.fileMain}>
        <h3 className={styles.fileTitle}>{file.name}</h3>
        {!titleOnly ? <p className={styles.meta}>{file.key}</p> : null}
        {seen ? <p className={styles.meta}>Last seen: {seen}</p> : null}
        {file.ticketId !== null ? (
          <p className={styles.ticket}>
            <TicketLink ticketId={file.ticketId} title={file.ticketTitle ?? 'Azure ticket'} />
          </p>
        ) : (
          <p className={`${styles.ticket} ${styles.unlinked}`}>Not linked to a ticket</p>
        )}
        {error ? (
          <p role="alert" className={styles.error}>
            {error.message}
          </p>
        ) : null}
      </div>
      <div className={styles.fileActions}>
        <MenuTrigger>
          <Button size="small" trailingIcon={ChevronDownIcon} isDisabled={!canDesktop && !canBrowser} aria-label={`Open ${file.name}`}>
            Open
          </Button>
          <MenuPopover placement="bottom end">
            <Menu
              aria-label={`Open ${file.name} in`}
              disabledKeys={[...(canDesktop ? [] : ['desktop']), ...(canBrowser ? [] : ['browser'])]}
              onAction={(key) => void open.run({ type: 'figma.open', fileKey: file.key, desktop: key === 'desktop' })}
            >
              <MenuItem id="desktop" icon={DesktopAppIcon}>
                Figma Desktop
              </MenuItem>
              <MenuItem id="browser" icon={BrowserIcon}>
                Browser
              </MenuItem>
            </Menu>
          </MenuPopover>
        </MenuTrigger>
        <Button
          size="small"
          isDisabled={busy || offline}
          onPress={() => onLink(file)}
          aria-label={file.ticketId !== null ? `Change ticket for ${file.name}` : `Link ticket to ${file.name}`}
        >
          {file.ticketId !== null ? 'Change ticket…' : 'Link ticket…'}
        </Button>
        {file.ticketId !== null ? (
          <Button
            size="small"
            variant="plain"
            isDisabled={busy || unlink.pending}
            onPress={() => void unlink.run({ type: 'figma.unlink', fileKey: file.key })}
            aria-label={`Unlink ${file.name}`}
          >
            Unlink
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** The file register with search, links and Open (1.14 `FigmaView` "File register"). */
export function FileRegister({ figma, titleOnly }: { figma: FigmaSlice; titleOnly: boolean }) {
  const search = useAction();
  const [query, setQuery] = useState(figma.search);
  const [limit, setLimit] = useState(FILE_PAGE_SIZE);
  const [linking, setLinking] = useState<FigmaFileView | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { run } = search;

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const send = (value: string, delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const dispatch = () => {
      setLimit(FILE_PAGE_SIZE);
      void run({ type: 'figma.setSearch', query: value });
    };
    if (delay <= 0) dispatch();
    else timer.current = setTimeout(dispatch, delay);
  };

  const shown = figma.files.slice(0, limit);
  const remaining = figma.files.length - shown.length;
  const filtered = figma.search.trim() !== '';

  return (
    <Section title="File register" subtitle="Link or unlink files without changing any tracked time.">
      <SearchField
        label="Search file, key or linked ticket"
        hideLabel
        placeholder="Search file, key or linked ticket"
        value={query}
        onChange={(value) => {
          setQuery(value);
          send(value, value === '' ? 0 : SEARCH_DELAY_MS);
        }}
        onSubmit={(value) => send(value, 0)}
      />
      {search.error ? (
        <p role="alert" className={styles.error}>
          {search.error.message}
        </p>
      ) : null}
      <p className="visually-hidden" role="status">
        {filtered
          ? figma.files.length === 0
            ? 'No matching files'
            : `${figma.files.length} ${figma.files.length === 1 ? 'file matches' : 'files match'}`
          : ''}
      </p>
      {figma.files.length === 0 ? (
        <EmptyState
          icon={FigmaIcon}
          size="compact"
          title="No matching files"
          description={
            filtered
              ? `No file, key or linked ticket matches “${figma.search.trim()}”.`
              : titleOnly
                ? 'Enable observation and focus a file in Figma Desktop for a few seconds.'
                : 'Enable observation, allow Accessibility and focus a file in Figma Desktop for a few seconds.'
          }
        />
      ) : (
        <>
          <ul role="list" aria-label="Figma files" className={styles.list}>
            {shown.map((file) => (
              <FileRow key={file.key} file={file} titleOnly={titleOnly} onLink={setLinking} />
            ))}
          </ul>
          {remaining > 0 ? (
            <Button size="small" className={styles.more} onPress={() => setLimit((current) => current + FILE_PAGE_SIZE)}>
              {`Show ${Math.min(FILE_PAGE_SIZE, remaining)} more of ${remaining}`}
            </Button>
          ) : null}
        </>
      )}
      <LinkDialog key={linking?.key ?? ''} file={linking} onClose={() => setLinking(null)} />
    </Section>
  );
}
