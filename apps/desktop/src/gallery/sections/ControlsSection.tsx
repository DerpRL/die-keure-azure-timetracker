import { CalendarDate, Time } from '@internationalized/date';
import { useState } from 'react';
import { Badge, StatusDot } from '../../components/Badge';
import { Banner } from '../../components/Banner';
import { Button, IconButton } from '../../components/Button';
import { Card, Section } from '../../components/Card';
import { DatePicker, DateRangePicker, TimeField } from '../../components/DateFields';
import { EmptyState, LoadingRegion, Skeleton } from '../../components/EmptyState';
import { NumberField, SearchField, TextField } from '../../components/Fields';
import {
  ClockIcon,
  CloseIcon,
  ExternalLinkIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  SettingsIcon,
  StopIcon,
} from '../../components/icons';
import { KeyboardShortcut } from '../../components/KeyboardShortcut';
import { AsyncComboBox, ComboBox, PickerItem, Select } from '../../components/Pickers';
import { Meter, ProgressBar } from '../../components/Progress';
import { SegmentedControl, Tabs } from '../../components/Segmented';
import { Checkbox, Switch } from '../../components/Toggles';
import { TRACKING_STATUS, TrackingStatusLabel, type TrackingStatus } from '../../timer/status';
import { formatShortDuration } from '../../utils/duration';
import { GallerySection, Grid, Row, Specimen } from '../GalleryLayout';
import { ACTIVITIES, searchTickets, type SampleTicket } from '../sampleData';

export function ControlsSection() {
  const [graph, setGraph] = useState<'activity' | 'heatmaps' | 'timeline' | 'progress'>('activity');
  const [ticket, setTicket] = useState<SampleTicket | null>(null);
  const [banners, setBanners] = useState(true);
  return (
    <>
      <GallerySection id="buttons" title="Buttons" description="Primary is the dark-teal filled action with white text; icon buttons always carry a label.">
        <Grid>
          <Specimen title="Variants">
            <Row>
              <Button variant="primary" icon={PlusIcon}>
                Track a ticket
              </Button>
              <Button>Choose another ticket</Button>
              <Button variant="plain">View history</Button>
              <Button variant="destructive">Delete entry</Button>
            </Row>
          </Specimen>
          <Specimen title="Sizes and states">
            <Row>
              <Button size="small">Small</Button>
              <Button>Medium</Button>
              <Button size="large">Large</Button>
              <Button isDisabled>Disabled</Button>
              <Button variant="primary" isPending>
                Saving
              </Button>
            </Row>
          </Specimen>
          <Specimen title="Icon and shortcut">
            <Row>
              <Button icon={RefreshIcon} shortcut={{ key: 'r', mod: true }} showShortcut>
                Refresh
              </Button>
              <Button variant="primary" trailingIcon={ExternalLinkIcon}>
                Open in Azure
              </Button>
              <IconButton label="Pause tracking" icon={PauseIcon} variant="secondary" />
              <IconButton label="Stop tracking" icon={StopIcon} variant="secondary" />
              <IconButton label="Start tracking" icon={PlayIcon} variant="primary" />
              <IconButton label="Settings" icon={SettingsIcon} shortcut={{ key: ',', mod: true }} />
            </Row>
          </Specimen>
          <Specimen title="Keyboard shortcut hints">
            <Row>
              <KeyboardShortcut shortcut={{ key: 'k', mod: true }} variant="standalone" />
              <KeyboardShortcut shortcut={{ key: 'd', mod: true, shift: true }} variant="standalone" />
              <KeyboardShortcut shortcut={{ key: 't', ctrl: true, alt: true }} variant="standalone" />
              <KeyboardShortcut shortcut={{ key: '?' }} variant="standalone" />
            </Row>
          </Specimen>
        </Grid>
      </GallerySection>

      <GallerySection id="status" title="Status, badges and banners">
        <Grid>
          <Specimen title="Tracking status vocabulary">
            <Row>
              {(Object.keys(TRACKING_STATUS) as TrackingStatus[]).map((status) => (
                <TrackingStatusLabel key={status} status={status} size="medium" />
              ))}
            </Row>
          </Specimen>
          <Specimen title="Badges and dots">
            <Row>
              <Badge tone="warning" accessibleLabel="3 pending branch changes">
                3
              </Badge>
              <Badge tone="running">Tracking</Badge>
              <Badge tone="paused">Paused</Badge>
              <Badge tone="success">Confirmed</Badge>
              <Badge tone="info">Preview</Badge>
              <Badge tone="danger">Rejected</Badge>
              <Badge tone="neutral" icon={ClockIcon}>
                Local draft
              </Badge>
              <StatusDot tone="running" label="Watching work context" showLabel pulse />
              <StatusDot tone="paused" label="Paused" showLabel />
              <StatusDot tone="warning" label="Stale" showLabel />
              <StatusDot tone="neutral" label="Observations paused" showLabel />
            </Row>
          </Specimen>
          <Specimen title="Banners" wide>
            {banners ? (
              <div className="gallery-stack">
                <Banner tone="info" title="Update available" live="off" actions={<Button size="small">Release notes</Button>}>
                  Azure timetracker 2.0.1 is ready to download.
                </Banner>
                <Banner tone="success" title="Time changes saved" live="off">
                  7pace confirmed the new start and end.
                </Banner>
                <Banner tone="warning" title="Timer status is stale" live="off" actions={<Button size="small">Retry</Button>}>
                  Last confirmed 3 minutes ago. Retry reads the current state; it never replays a failed change.
                </Banner>
                <Banner tone="error" title="Could not start the timer" live="off" onDismiss={() => setBanners(false)}>
                  The previous timer remains stopped. Check 7pace before trying again.
                </Banner>
              </div>
            ) : (
              <Button onPress={() => setBanners(true)} icon={CloseIcon}>
                Show banners again
              </Button>
            )}
          </Specimen>
        </Grid>
      </GallerySection>

      <GallerySection id="forms" title="Form controls">
        <Grid>
          <Specimen title="Switch and checkbox">
            <div className="gallery-stack">
              <Switch defaultSelected description="Opens Azure timetracker when you log in.">
                Launch at login
              </Switch>
              <Switch>Automatically open the activity chooser</Switch>
              <Checkbox defaultSelected>Belgian public holidays</Checkbox>
              <Checkbox isIndeterminate>All calendars</Checkbox>
              <Checkbox isDisabled>Other apps</Checkbox>
            </div>
          </Specimen>
          <Specimen title="Text fields">
            <div className="gallery-stack">
              <TextField label="Organization" description="Your Azure DevOps organization name." placeholder="contoso" />
              <TextField
                label="7pace workspace URL"
                defaultValue="http://contoso.7pace.com"
                isInvalid
                errorMessage="Use https://your-organization.timehub.7pace.com"
              />
              <TextField label="Comment" multiline placeholder="What did you work on?" />
            </div>
          </Specimen>
          <Specimen title="Number and search">
            <div className="gallery-stack">
              <NumberField label="Monday" unit="h" defaultValue={8} minValue={0} maxValue={24} step={0.25} />
              <NumberField label="Refresh interval" unit="s" defaultValue={60} minValue={30} maxValue={300} step={10} />
              <SearchField label="Filter entries" placeholder="Ticket, comment or activity" />
            </div>
          </Specimen>
          <Specimen title="Select and combo boxes">
            <div className="gallery-stack">
              <Select
                label="Activity"
                defaultSelectedKey="dev"
                items={ACTIVITIES.map((activity) => ({ id: activity.id, label: activity.name }))}
              />
              <ComboBox label="Meeting activity" defaultItems={ACTIVITIES} placeholder="Type to filter">
                {(activity) => <PickerItem id={activity.id}>{activity.name}</PickerItem>}
              </ComboBox>
              <AsyncComboBox<SampleTicket>
                label="Ticket"
                description={ticket ? `Selected #${ticket.id}` : 'Search by number or title (simulated 250 ms latency).'}
                load={(query, signal) => searchTickets(query, signal)}
                getLabel={(item) => `#${item.id} · ${item.title}`}
                onSelectionChange={setTicket}
                menuTrigger="focus"
                emptyMessage="No matching tickets"
              />
            </div>
          </Specimen>
          <Specimen title="Segmented control and tabs" wide>
            <div className="gallery-stack">
              <SegmentedControl
                label="Chart type"
                selectedKey={graph}
                onSelectionChange={setGraph}
                options={[
                  { id: 'activity', label: 'Activity chart' },
                  { id: 'heatmaps', label: 'Heatmaps' },
                  { id: 'timeline', label: 'Timeline' },
                  { id: 'progress', label: 'Progress' },
                ]}
              />
              <Tabs
                label="Settings categories"
                tabs={[
                  { id: 'accounts', title: 'Accounts', content: <p>Azure organization, project and 7pace sign-in.</p> },
                  { id: 'tracking', title: 'Tracking', content: <p>Targets, holidays and time awareness.</p> },
                  { id: 'meetings', title: 'Meetings', content: <p>Calendar and microphone suggestions.</p> },
                  { id: 'appearance', title: 'Appearance', content: <p>Light, Dark or System; scale; contrast.</p> },
                ]}
              />
            </div>
          </Specimen>
          <Specimen title="Dates and times" wide>
            <Row>
              <DatePicker label="Day" defaultValue={new CalendarDate(2026, 10, 6)} />
              <DateRangePicker
                label="History range"
                defaultValue={{ start: new CalendarDate(2026, 9, 30), end: new CalendarDate(2026, 10, 6) }}
              />
              <TimeField label="Start" defaultValue={new Time(9, 30)} />
              <TimeField label="End" defaultValue={new Time(12, 15)} />
            </Row>
          </Specimen>
        </Grid>
      </GallerySection>

      <GallerySection id="feedback" title="Progress, empty and loading states">
        <Grid>
          <Specimen title="Progress bar and meter">
            <div className="gallery-stack">
              <ProgressBar label="Downloading update" value={62} />
              <ProgressBar label="Checking overlaps" isIndeterminate detail="Scanning older entries" />
              <Meter label="Today" value={5.2 * 3600} maxValue={7.6 * 3600} valueLabel={`${formatShortDuration(5.2 * 3600)} of 7h 36m`} />
              <Meter
                label="This week"
                value={40 * 3600}
                maxValue={38 * 3600}
                valueLabel="40h 0m of 38h 0m"
                tone="paused"
                detail="Last known"
              />
            </div>
          </Specimen>
          <Specimen title="Empty state">
            <Card padding="small">
              <EmptyState
                icon={ClockIcon}
                title="A clear start"
                description="Your completed worklogs will appear here as you track."
                action={<Button variant="primary">Track a ticket</Button>}
              />
            </Card>
          </Specimen>
          <Specimen title="Skeleton">
            <LoadingRegion label="Loading worklogs" isLoading placeholder={<Skeleton lines={4} />}>
              <p>Loaded</p>
            </LoadingRegion>
            <Row>
              <Skeleton shape="circle" />
              <Skeleton shape="rect" width="12rem" height="3rem" />
            </Row>
          </Specimen>
          <Specimen title="Card and section">
            <Section title="Current tracking" subtitle="Start, pause or finish your active work." headingLevel={4} actions={<Button size="small">Ticket context</Button>}>
              <p>Section content sits in a solid card with a configurable heading level.</p>
            </Section>
          </Specimen>
        </Grid>
      </GallerySection>
    </>
  );
}
