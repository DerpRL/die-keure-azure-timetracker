import { parseAbsoluteToLocal, type ZonedDateTime } from '@internationalized/date';
import { useState } from 'react';
import { Button, IconButton } from '../../components/Button';
import { DatePicker } from '../../components/DateFields';
import { ArrowLeftIcon, ArrowRightIcon, CalendarRangeIcon, HistoryIcon, ZoomInIcon, ZoomOutIcon } from '../../components/icons';
import { Popover, PopoverTrigger } from '../../components/Popover';
import type { StatisticsSlice } from '../../ipc/contract';
import { useAction } from '../../state/hooks';
import { instant, seconds } from './format';
import { MIN_WINDOW_SECONDS } from './model';
import styles from './Statistics.module.css';

export function canZoomIn(slice: StatisticsSlice): boolean {
  return seconds(slice.window) > MIN_WINDOW_SECONDS;
}

export function canPanEarlier(slice: StatisticsSlice): boolean {
  return Date.parse(slice.window.start) > Date.parse(slice.bounds.start);
}

export function canPanLater(slice: StatisticsSlice): boolean {
  return Date.parse(slice.window.end) < Date.parse(slice.bounds.end);
}

/**
 * 1.14 `zoomControls`: Back, Zoom in, Zoom out, pan earlier and later, and an exact range. The
 * zoomed window comes back in the slice; these buttons only ask.
 */
export function ZoomControls({ slice }: { slice: StatisticsSlice }) {
  const zoom = useAction();
  const { run } = zoom;
  return (
    <div className={styles.zoomBar}>
      <div role="group" aria-label="Zoom" className={styles.zoomButtons}>
        <Button size="small" icon={HistoryIcon} isDisabled={slice.zoomDepth === 0} onPress={() => void run({ type: 'statistics.back' })}>
          Back
        </Button>
        <Button size="small" icon={ZoomInIcon} isDisabled={!canZoomIn(slice)} onPress={() => void run({ type: 'statistics.scale', factor: 0.5 })}>
          Zoom in
        </Button>
        <Button size="small" icon={ZoomOutIcon} isDisabled={!slice.isZoomed} onPress={() => void run({ type: 'statistics.scale', factor: 2 })}>
          Zoom out
        </Button>
        <IconButton
          size="small"
          variant="secondary"
          label="Pan earlier"
          icon={ArrowLeftIcon}
          isDisabled={!canPanEarlier(slice)}
          onPress={() => void run({ type: 'statistics.pan', direction: -1 })}
        />
        <IconButton
          size="small"
          variant="secondary"
          label="Pan later"
          icon={ArrowRightIcon}
          isDisabled={!canPanLater(slice)}
          onPress={() => void run({ type: 'statistics.pan', direction: 1 })}
        />
      </div>
      <PopoverTrigger>
        <Button size="small" icon={CalendarRangeIcon}>
          Choose range…
        </Button>
        <Popover title="Zoom to a time range" width="large" placement="bottom end">
          {(close) => <RangeForm slice={slice} onDone={close} />}
        </Popover>
      </PopoverTrigger>
      {zoom.error ? (
        <p role="alert" className={styles.inlineError}>
          {zoom.error.message}
        </p>
      ) : null}
    </div>
  );
}

function RangeForm({ slice, onDone }: { slice: StatisticsSlice; onDone: () => void }) {
  const zoom = useAction();
  const [from, setFrom] = useState<ZonedDateTime | null>(() => parseAbsoluteToLocal(slice.window.start));
  const [to, setTo] = useState<ZonedDateTime | null>(() => parseAbsoluteToLocal(slice.window.end));
  const min = parseAbsoluteToLocal(slice.bounds.start);
  const max = parseAbsoluteToLocal(slice.bounds.end);
  const valid = !!from && !!to && to.compare(from) > 0;
  return (
    <form
      className={styles.rangeForm}
      onSubmit={(event) => {
        event.preventDefault();
        if (!from || !to || !valid) return;
        void zoom.run({ type: 'statistics.zoomTo', start: instant(from.toDate()), end: instant(to.toDate()) });
        onDone();
      }}
    >
      <DatePicker<ZonedDateTime> label="From" granularity="minute" hideTimeZone shouldForceLeadingZeros value={from} onChange={setFrom} minValue={min} maxValue={max} />
      <DatePicker<ZonedDateTime> label="To" granularity="minute" hideTimeZone shouldForceLeadingZeros value={to} onChange={setTo} minValue={min} maxValue={max} />
      <p className={styles.secondary}>Minimum window: 15 minutes. Ranges stay inside the selected period.</p>
      <div className={styles.formActions}>
        <Button onPress={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" isDisabled={!valid}>
          Apply range
        </Button>
      </div>
    </form>
  );
}
