import { useState } from 'react';
import { Button } from '../../components/Button';
import { useAnnounce } from '../../components/Announcer';
import { Dialog, Sheet } from '../../components/Dialog';
import { TextField } from '../../components/Fields';
import { MoreIcon } from '../../components/icons';
import { MenuButton } from '../../components/Menu';
import { Select } from '../../components/Pickers';
import { Popover, PopoverTrigger } from '../../components/Popover';
import { Checkbox } from '../../components/Toggles';
import { useToast } from '../../components/Toast';
import { Tooltip } from '../../components/Tooltip';
import { useCommands, useShortcutUi } from '../../shortcuts/hooks';
import { GallerySection, Grid, Row, Specimen } from '../GalleryLayout';
import { ACTIVITIES } from '../sampleData';

export function OverlaysSection() {
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [last, setLast] = useState('Nothing yet');
  const toast = useToast();
  const announce = useAnnounce();
  const { openPalette, openCheatSheet } = useShortcutUi();

  // Sample tracking commands so the palette and cheat sheet have more than pages in them.
  useCommands([
    {
      id: 'gallery.review',
      label: 'Review today',
      group: 'Tracking',
      shortcut: { key: 'd', mod: true, shift: true },
      onAction: () => setLast('Review today'),
    },
    { id: 'gallery.choose', label: 'Choose ticket…', group: 'Tracking', shortcut: { key: 'n', mod: true }, onAction: () => setLast('Choose ticket…') },
    { id: 'gallery.pause', label: 'Pause tracking', group: 'Tracking', onAction: () => setLast('Pause tracking') },
    { id: 'gallery.stop', label: 'Stop tracking', group: 'Tracking', onAction: () => setLast('Stop tracking') },
  ]);

  return (
    <GallerySection
      id="overlays"
      title="Dialogs, overlays and feedback"
      description="Dialogs trap focus and return it on close. Escape cancels; Return triggers the default action unless a control uses Return itself."
    >
      <Grid>
        <Specimen title="Dialog and sheet">
          <Row>
            <Button onPress={() => setDialog(true)}>Open dialog</Button>
            <Button onPress={() => setSheet(true)}>Open edit sheet</Button>
            <Button variant="destructive" onPress={() => setConfirm(true)}>
              Clear pause…
            </Button>
          </Row>
          <p className="gallery-note">Last result: {last}</p>
          <Dialog
            isOpen={dialog}
            onOpenChange={setDialog}
            title="Choose an activity"
            description="Your saved default is preselected when it is available."
            onCancel={() => setLast('Cancelled')}
            primaryAction={{
              label: 'Start tracking',
              onAction: () => {
                setLast('Started');
                setDialog(false);
              },
            }}
          >
            <Select label="Activity" defaultSelectedKey="dev" items={ACTIVITIES.map((activity) => ({ id: activity.id, label: activity.name }))} />
            <TextField label="Comment" description="Return starts tracking." />
          </Dialog>
          <Sheet
            isOpen={sheet}
            onOpenChange={setSheet}
            title="Edit time"
            description="Adjust the start and end of this entry. Ticket, activity and comment stay unchanged."
            size="large"
            onCancel={() => setLast('Edit cancelled')}
            secondaryActions={<Button>Split entry…</Button>}
            primaryAction={{
              label: 'Save time changes',
              onAction: () => {
                setLast('Saved time changes');
                setSheet(false);
              },
            }}
          >
            <Row>
              <TextField label="Start" defaultValue="09:00" />
              <TextField label="End" defaultValue="10:30" />
            </Row>
            <Checkbox>Check overlaps</Checkbox>
          </Sheet>
          <Dialog
            isOpen={confirm}
            onOpenChange={setConfirm}
            role="alertdialog"
            size="small"
            title="Clear pause?"
            description="This forgets the paused selection without changing recorded time."
            primaryAction={{
              label: 'Clear pause',
              variant: 'destructive',
              onAction: () => {
                setLast('Pause cleared');
                setConfirm(false);
              },
            }}
          />
        </Specimen>
        <Specimen title="Popover, menu and tooltip">
          <Row>
            <PopoverTrigger>
              <Button>Choose range…</Button>
              <Popover title="Zoom to a time range" showArrow>
                {(close) => (
                  <>
                    <TextField label="From" defaultValue="06/10/2026 09:00" />
                    <TextField label="To" defaultValue="06/10/2026 12:00" />
                    <p className="gallery-note">Minimum window: 15 minutes.</p>
                    <Row>
                      <Button onPress={close}>Cancel</Button>
                      <Button
                        variant="primary"
                        onPress={() => {
                          setLast('Range applied');
                          close();
                        }}
                      >
                        Apply range
                      </Button>
                    </Row>
                  </>
                )}
              </Popover>
            </PopoverTrigger>
            <MenuButton
              label="More actions"
              icon={MoreIcon}
              items={[
                { id: 'copy', label: 'Copy', shortcut: { key: 'c', mod: true } },
                { id: 'export', label: 'Export Markdown…', description: 'Choose a file' },
                { id: 'context', label: 'Ticket context' },
                { id: 'delete', label: 'Delete draft', isDestructive: true },
              ]}
              onAction={(id) => setLast(`Menu: ${String(id)}`)}
            />
            <Tooltip content="Quitting leaves the 7pace timer running">
              <Button>Quit app</Button>
            </Tooltip>
          </Row>
        </Specimen>
        <Specimen title="Toasts and announcements">
          <Row>
            <Button onPress={() => toast.show({ title: 'Report copied', description: 'Markdown is on your clipboard.', tone: 'success' })}>
              Success toast
            </Button>
            <Button
              onPress={() =>
                toast.show({ title: 'Update downloaded', tone: 'info', action: { label: 'Install and restart', onAction: () => setLast('Install') } })
              }
            >
              Toast with action
            </Button>
            <Button onPress={() => toast.show({ title: 'Upload failed', description: 'The draft stays local.', tone: 'error' })}>
              Error toast
            </Button>
            <Button onPress={() => announce('Tracking #33624 · Improve loading')}>Announce politely</Button>
          </Row>
        </Specimen>
        <Specimen title="Command palette and cheat sheet">
          <Row>
            <Button onPress={openPalette} shortcut={{ key: 'k', mod: true }} showShortcut>
              Command palette
            </Button>
            <Button onPress={openCheatSheet} shortcut={{ key: '?' }} showShortcut>
              Keyboard shortcuts
            </Button>
          </Row>
          <p className="gallery-note">Registered here: Review today (⇧⌘D), Choose ticket (⌘N), Pause and Stop tracking.</p>
        </Specimen>
      </Grid>
    </GallerySection>
  );
}
