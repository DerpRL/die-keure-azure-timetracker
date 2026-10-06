import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ZoomOutIcon } from '../../components/icons';
import { ActivityBars, type TimeRange } from '../../charts/ActivityBars';
import { CalendarHeatmap } from '../../charts/CalendarHeatmap';
import { CumulativeProgress } from '../../charts/CumulativeProgress';
import { Donut } from '../../charts/Donut';
import { formatDateTime } from '../../charts/format';
import { HourHeatmap } from '../../charts/HourHeatmap';
import { Timeline } from '../../charts/Timeline';
import { GallerySection, Specimen } from '../GalleryLayout';
import {
  ACTIVITIES,
  activitySlices,
  dayBuckets,
  dstHourHeatmap,
  monthDays,
  timelineEntries,
  weekBuckets,
  weekProgress,
  WEEK_START,
  yearDays,
} from '../sampleData';

function describeRange(range: TimeRange): string {
  return `${formatDateTime(range.start)} – ${formatDateTime(range.end)}`;
}

export function ChartsSection() {
  const [zoomed, setZoomed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState('Click a bar, drag across bars, or focus a bar and press + or −.');
  const [day, setDay] = useState<string | null>('2026-10-06');
  const [hour, setHour] = useState<string | null>(null);
  const [entry, setEntry] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);

  const buckets = useMemo(() => (zoomed ? dayBuckets() : weekBuckets()), [zoomed]);
  const year = useMemo(() => yearDays(), []);
  const month = useMemo(() => monthDays(), []);
  const hours = useMemo(() => dstHourHeatmap(), []);
  const entries = useMemo(() => timelineEntries(), []);
  const progress = useMemo(() => weekProgress(), []);
  const slices = useMemo(() => activitySlices(), []);
  const series = filter ? ACTIVITIES.filter((activity) => activity.id === filter) : ACTIVITIES;

  return (
    <GallerySection
      id="charts"
      title="Charts"
      description="Data-agnostic SVG and HTML charts. Each has a keyboard model, labelled marks, tooltips and a “Show as table” twin. Colour is backed by patterns, labels and stack order."
    >
      <Specimen title="ActivityBars · time explorer" wide>
        <Card>
          <ActivityBars
            title={zoomed ? 'Tuesday 6 October by hour' : 'Week of 5 October'}
            description="Click a bar to inspect it. Drag across the chart to zoom into a range."
            series={series}
            buckets={buckets}
            selectedId={selected}
            onSelect={(id) => {
              setSelected(id);
              setMessage(id ? `Selected ${buckets.find((bucket) => bucket.id === id)?.longLabel ?? id}` : 'Selection cleared');
            }}
            onZoom={(range) => {
              setMessage(`Zoom requested: ${describeRange(range)}`);
              if (!zoomed) {
                setZoomed(true);
                setSelected(null);
              }
            }}
            onZoomOut={() => {
              setZoomed(false);
              setSelected(null);
              setMessage('Zoomed out to the week');
            }}
            valueUnit="hours"
            actions={
              <Button size="small" icon={ZoomOutIcon} isDisabled={!zoomed} onPress={() => setZoomed(false)}>
                Reset zoom
              </Button>
            }
          />
          <p className="gallery-note" aria-live="polite">
            {message}
          </p>
        </Card>
      </Specimen>
      <Specimen title="CalendarHeatmap · year" wide>
        <Card>
          <CalendarHeatmap
            title="2026"
            description="Each cell is a day. Select one to open its task timeline. Empty days remain visible."
            days={year}
            selectedDate={day}
            onSelectDay={setDay}
          />
        </Card>
      </Specimen>
      <Specimen title="CalendarHeatmap · month">
        <Card>
          <CalendarHeatmap title="October 2026" days={month} selectedDate={day} onSelectDay={setDay} />
        </Card>
      </Specimen>
      <Specimen title="HourHeatmap · daylight saving ends 25 October">
        <Card>
          <HourHeatmap
            title="Hourly heatmap"
            description="Select an hour to zoom into its timeline. Repeated daylight-saving hours have separate cells."
            rows={hours.rows}
            cells={hours.cells}
            selectedId={hour}
            onSelectCell={(cell) => setHour(cell.id)}
          />
        </Card>
      </Specimen>
      <Specimen title="Timeline · Tuesday 6 October" wide>
        <Card>
          <Timeline
            title="Task timeline"
            description="Each row is one recorded entry. Gaps and overlapping times stay visible."
            domain={{ start: new Date(2026, 9, 6, 8), end: new Date(2026, 9, 6, 19) }}
            entries={entries}
            series={ACTIVITIES}
            selectedId={entry}
            onSelect={setEntry}
            onZoomToEntry={(item) => setMessage(`Zoom to entry: ${item.label}`)}
          />
        </Card>
      </Specimen>
      <Specimen title="CumulativeProgress">
        <Card>
          <CumulativeProgress
            title="Week progress"
            description="Recorded time alongside your scheduled target. Future dates show the target without projecting tracked time."
            domain={{ start: WEEK_START, end: new Date(2026, 9, 12) }}
            points={progress.points}
            target={progress.target}
          />
        </Card>
      </Specimen>
      <Specimen title="Donut · activity mix">
        <Card>
          <Donut
            title="Activity mix"
            description="Select a slice or activity to filter your charts and entries."
            slices={slices}
            selectedId={filter}
            onSelect={setFilter}
          />
        </Card>
      </Specimen>
    </GallerySection>
  );
}
