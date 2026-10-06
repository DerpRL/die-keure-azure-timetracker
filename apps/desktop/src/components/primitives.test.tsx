import { CalendarDate, Time } from '@internationalized/date';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../test/axe';
import { renderWithProviders } from '../test/render';
import { announce, useAnnounce } from './Announcer';
import { Badge, StatusDot } from './Badge';
import { Banner } from './Banner';
import { Button, IconButton } from './Button';
import { Card, Section, SectionHeading } from './Card';
import { DatePicker, DateRangePicker, TimeField } from './DateFields';
import { Dialog } from './Dialog';
import { EmptyState, LoadingRegion, Skeleton } from './EmptyState';
import { NumberField, SearchField, TextField } from './Fields';
import { PlusIcon, RefreshIcon, SettingsIcon } from './icons';
import { KeyboardShortcut } from './KeyboardShortcut';
import { MenuButton } from './Menu';
import { Select } from './Pickers';
import { Popover, PopoverTrigger } from './Popover';
import { Meter, ProgressBar } from './Progress';
import { SegmentedControl, Tabs } from './Segmented';
import { useToast } from './Toast';
import { Checkbox, Switch } from './Toggles';
import { Tooltip } from './Tooltip';

describe('Button and IconButton', () => {
  it('render every variant accessibly and expose shortcuts', async () => {
    const onPress = vi.fn();
    const { user } = renderWithProviders(
      <div>
        <Button variant="primary" icon={PlusIcon} onPress={onPress}>
          Track a ticket
        </Button>
        <Button variant="secondary">Cancel</Button>
        <Button variant="plain" size="small">
          View history
        </Button>
        <Button variant="destructive" size="large">
          Delete entry
        </Button>
        <Button isDisabled>Disabled</Button>
        <Button isPending>Saving</Button>
        <Button shortcut={{ key: 's', mod: true }} showShortcut>
          Save changes
        </Button>
        <IconButton label="Refresh" icon={RefreshIcon} shortcut={{ key: 'r', mod: true }} />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Track a ticket' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toHaveAttribute('aria-keyshortcuts', 'Meta+S');
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAttribute('aria-keyshortcuts', 'Meta+R');
    expect(screen.getByRole('button', { name: 'Disabled' })).toBeDisabled();
    // Icons are decorative.
    for (const svg of document.querySelectorAll('button svg')) expect(svg).toHaveAttribute('aria-hidden', 'true');
    await expectNoA11yViolations();
  });

  it('shows the icon button label as a tooltip on keyboard focus', async () => {
    const { user } = renderWithProviders(<IconButton label="Open settings" icon={SettingsIcon} />);
    await user.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Open settings');
    await expectNoA11yViolations();
  });
});

describe('Card, Section and headings', () => {
  it('uses the requested heading level and labels the region', async () => {
    renderWithProviders(
      <main>
        <SectionHeading title="Today" subtitle="Tuesday 6 October" level={1} size="title" />
        <Section title="Current tracking" subtitle="Start, pause or finish your active work." headingLevel={2}>
          <p>Body</p>
        </Section>
        <Section title="Progress" headingLevel={3} variant="plain" actions={<Button>View history</Button>}>
          <Card>Inner card</Card>
        </Section>
      </main>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Current tracking' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Progress' })).toBeInTheDocument();
    await expectNoA11yViolations();
  });
});

describe('Badge, StatusDot and Banner', () => {
  it('give counts and dots a spoken meaning and banners a live role', async () => {
    const onDismiss = vi.fn();
    const { user } = renderWithProviders(
      <div>
        <Badge tone="warning" accessibleLabel="3 pending branch changes">
          3
        </Badge>
        <Badge tone="running">Tracking</Badge>
        <StatusDot tone="paused" label="Paused" />
        <StatusDot tone="running" label="Watching work context" showLabel pulse />
        <Banner tone="info" title="Update available" live="off">
          Version 2.0.1 is ready.
        </Banner>
        <Banner tone="warning" title="Connection lost" actions={<Button size="small">Retry</Button>}>
          Last confirmed 2 minutes ago.
        </Banner>
        <Banner tone="error" title="Could not stop the timer" onDismiss={onDismiss}>
          The timer is unchanged.
        </Banner>
        <Banner tone="success">Saved.</Banner>
      </div>,
    );
    expect(screen.getByText('3 pending branch changes')).toBeInTheDocument();
    expect(screen.getByText('Paused')).toHaveClass('visually-hidden');
    expect(screen.getByRole('alert')).toHaveTextContent('Could not stop the timer');
    expect(screen.getAllByRole('status')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
    await expectNoA11yViolations();
  });
});

describe('Switch and Checkbox', () => {
  it('toggle with the keyboard and link descriptions', async () => {
    const onChange = vi.fn();
    const { user } = renderWithProviders(
      <div>
        <Switch onChange={onChange} description="Opens Azure timetracker when you log in.">
          Launch at login
        </Switch>
        <Checkbox defaultSelected description="Also offers Daily standup.">
          Microphone meetings
        </Checkbox>
        <Checkbox isIndeterminate>Select all</Checkbox>
      </div>,
    );
    const toggle = screen.getByRole('switch', { name: 'Launch at login' });
    expect(toggle).toHaveAccessibleDescription('Opens Azure timetracker when you log in.');
    await user.tab();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('checkbox', { name: 'Microphone meetings' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select all' })).toBePartiallyChecked();
    await expectNoA11yViolations();
  });
});

describe('text, number and search fields', () => {
  it('label inputs, describe them and report errors', async () => {
    const { user } = renderWithProviders(
      <form aria-label="Account">
        <TextField label="Organization" description="Your Azure DevOps organization name." isRequired />
        <TextField label="Weekly report" multiline />
        <NumberField label="Daily target" unit="h" defaultValue={7.6} minValue={0} maxValue={24} step={0.1} />
        <SearchField label="Filter entries" placeholder="Ticket, comment or activity" />
        <TextField label="Workspace URL" isInvalid errorMessage="Use https://your-organization.timehub.7pace.com" />
      </form>,
    );
    expect(screen.getByRole('textbox', { name: 'Organization' })).toHaveAccessibleDescription(
      'Your Azure DevOps organization name.',
    );
    const target = screen.getByRole('textbox', { name: 'Daily target' });
    await user.click(target);
    await user.keyboard('{ArrowUp}');
    expect(target).toHaveValue('7.7');
    const search = screen.getByRole('searchbox', { name: 'Filter entries' });
    await user.type(search, '33624');
    expect(search).toHaveValue('33624');
    await user.keyboard('{Escape}');
    expect(search).toHaveValue('');
    expect(screen.getByText('Use https://your-organization.timehub.7pace.com')).toBeInTheDocument();
    await expectNoA11yViolations();
  });
});

describe('Select', () => {
  it('opens with the keyboard and selects an option', async () => {
    const onSelectionChange = vi.fn();
    const { user } = renderWithProviders(
      <Select
        label="Activity"
        items={[
          { id: 'dev', label: 'Development' },
          { id: 'meeting', label: 'Meeting', description: 'Overleg' },
        ]}
        onSelectionChange={onSelectionChange}
      />,
    );
    await user.tab();
    await user.keyboard('{ArrowDown}');
    const listbox = await screen.findByRole('listbox');
    await expectNoA11yViolations();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelectionChange).toHaveBeenLastCalledWith('meeting');
    expect(listbox).not.toBeInTheDocument();
  });
});

describe('SegmentedControl and Tabs', () => {
  function Appearance() {
    const [value, setValue] = useState<'system' | 'light' | 'dark'>('system');
    return (
      <SegmentedControl
        label="Appearance"
        selectedKey={value}
        onSelectionChange={setValue}
        options={[
          { id: 'system', label: 'System' },
          { id: 'light', label: 'Light' },
          { id: 'dark', label: 'Dark' },
        ]}
      />
    );
  }

  it('select exactly one option and move with the arrow keys', async () => {
    const { user } = renderWithProviders(
      <div>
        <Appearance />
        <Tabs
          label="Statistics views"
          tabs={[
            { id: 'explorer', title: 'Time explorer', content: <p>Explorer</p> },
            { id: 'tasks', title: 'Tasks', content: <p>Tasks list</p> },
          ]}
        />
      </div>,
    );
    const group = screen.getByRole('radiogroup', { name: 'Appearance' });
    expect(within(group).getByRole('radio', { name: 'System' })).toBeChecked();
    await user.click(within(group).getByRole('radio', { name: 'Dark' }));
    expect(within(group).getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'System' })).not.toBeChecked();

    await user.click(screen.getByRole('tab', { name: 'Time explorer' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Tasks list');
    await expectNoA11yViolations();
  });
});

describe('Popover, Menu and Tooltip', () => {
  it('open from their triggers and close with Escape', async () => {
    const onAction = vi.fn();
    const { user } = renderWithProviders(
      <div>
        <PopoverTrigger>
          <Button>Choose range…</Button>
          <Popover title="Zoom to a time range">
            <TextField label="From" />
          </Popover>
        </PopoverTrigger>
        <MenuButton
          label="More actions"
          items={[
            { id: 'copy', label: 'Copy', shortcut: { key: 'c', mod: true } },
            { id: 'export', label: 'Export Markdown…' },
            { id: 'delete', label: 'Delete', isDestructive: true, isDisabled: true },
          ]}
          onAction={onAction}
        />
        <Tooltip content="Help text">
          <Button>Hover me</Button>
        </Tooltip>
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Choose range…' }));
    expect(await screen.findByRole('dialog', { name: 'Zoom to a time range' })).toBeInTheDocument();
    await expectNoA11yViolations();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toHaveAttribute('aria-disabled', 'true');
    await expectNoA11yViolations();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onAction).toHaveBeenCalledWith('export');

    // Keyboard focus shows a tooltip at once (hover uses the 600 ms delay).
    act(() => screen.getByRole('button', { name: 'Hover me' }).focus());
    await user.keyboard('{Shift>}{Tab}{/Shift}{Tab}');
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Help text');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });
});

describe('date and time fields', () => {
  it('render labelled segments and a calendar popover', async () => {
    const { user } = renderWithProviders(
      <div>
        <DatePicker label="Day" defaultValue={new CalendarDate(2026, 10, 6)} />
        <DateRangePicker
          label="History range"
          defaultValue={{ start: new CalendarDate(2026, 9, 30), end: new CalendarDate(2026, 10, 6) }}
        />
        <TimeField label="Start" defaultValue={new Time(9, 30)} />
      </div>,
    );
    expect(screen.getByRole('group', { name: 'Day' })).toBeInTheDocument();
    // en-GB: 24-hour clock, so there is no AM/PM segment.
    const start = screen.getByRole('group', { name: 'Start' });
    expect(within(start).queryByRole('spinbutton', { name: /AM\/PM/i })).toBeNull();
    await user.click(screen.getAllByRole('button', { name: /calendar/i })[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('grid')).toBeInTheDocument();
    await expectNoA11yViolations();
  });
});

describe('ProgressBar and Meter', () => {
  it('expose value text and cap the meter at its maximum', async () => {
    renderWithProviders(
      <div>
        <ProgressBar label="Downloading update" value={40} />
        <ProgressBar label="Checking overlaps" isIndeterminate />
        <Meter label="Today" value={9 * 3600} maxValue={7.6 * 3600} valueLabel="9h 0m of 7h 36m" />
      </div>,
    );
    expect(screen.getByRole('progressbar', { name: 'Downloading update' })).toHaveAttribute('aria-valuenow', '40');
    const meter = screen.getByRole('meter', { name: 'Today' });
    expect(meter).toHaveAttribute('aria-valuetext', '9h 0m of 7h 36m');
    expect(meter).toHaveAttribute('aria-valuenow', String(7.6 * 3600));
    await expectNoA11yViolations();
  });
});

describe('toasts and announcements', () => {
  function Feedback() {
    const toast = useToast();
    const say = useAnnounce();
    return (
      <div>
        <Button onPress={() => toast.show({ title: 'Report copied', tone: 'success' })}>Copy</Button>
        <Button onPress={() => say('Tracking #33624')}>Announce</Button>
      </div>
    );
  }

  it('announce politely and show dismissible toasts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { user } = renderWithProviders(<Feedback />);
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    const region = screen.getByRole('region', { name: 'Notifications' });
    expect(within(region).getByText('Report copied')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(100));
    expect(document.querySelector('[data-announcer="polite"]')).toHaveTextContent('Report copied');
    await user.click(screen.getByRole('button', { name: 'Announce' }));
    act(() => void vi.advanceTimersByTime(100));
    expect(document.querySelector('[data-announcer="polite"]')).toHaveTextContent('Tracking #33624');
    await expectNoA11yViolations();
    await user.click(within(region).getByRole('button', { name: 'Dismiss notification' }));
    expect(within(region).queryByText('Report copied')).toBeNull();
    vi.useRealTimers();
  });

  it('keeps live regions available while a modal is open', () => {
    announce('Prompt arrived');
    const region = document.querySelector('[data-announcer="polite"]');
    expect(region).toHaveAttribute('data-live-announcer', 'true');
    expect(region).toHaveAttribute('aria-live', 'polite');
  });
});

describe('EmptyState, Skeleton and KeyboardShortcut', () => {
  it('describe empty and loading content and speak shortcuts', async () => {
    renderWithProviders(
      <div>
        <EmptyState title="A clear start" description="Your completed worklogs will appear here as you track." />
        <LoadingRegion label="Loading worklogs" isLoading placeholder={<Skeleton lines={3} />}>
          <p>Loaded</p>
        </LoadingRegion>
        <KeyboardShortcut shortcut={{ key: 'k', mod: true }} variant="standalone" />
      </div>,
      { platform: 'windows' },
    );
    expect(screen.getByRole('heading', { name: 'A clear start' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading worklogs');
    expect(screen.getByText('Control K')).toHaveClass('visually-hidden');
    expect(document.querySelector('kbd')).toHaveTextContent('Ctrl');
    await expectNoA11yViolations();
  });
});

describe('Dialog smoke', () => {
  it('passes axe while open', async () => {
    renderWithProviders(
      <Dialog isOpen onOpenChange={() => {}} title="Edit time" description="Adjust start and end." primaryAction={{ label: 'Save time changes', onAction: () => {} }}>
        <TextField label="Start" />
      </Dialog>,
    );
    expect(await screen.findByRole('dialog', { name: 'Edit time' })).toHaveAccessibleDescription('Adjust start and end.');
    await expectNoA11yViolations();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Start' }), { key: 'Tab' });
  });
});
