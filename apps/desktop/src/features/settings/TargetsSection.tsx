import { getLocalTimeZone, today, type CalendarDate } from '@internationalized/date';
import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { DatePicker } from '../../components/DateFields';
import { NumberField, TextField } from '../../components/Fields';
import { ExternalLinkIcon } from '../../components/icons';
import { Select } from '../../components/Pickers';
import { Checkbox } from '../../components/Toggles';
import type { TargetExceptionKind } from '../../ipc/contract';
import { formatShortDuration } from '../../utils/duration';
import { openExternalLink } from './platform';
import { WorkdayTimes } from './DayReviewSection';
import { Divider, Hint, InlineIssue, SettingsSection, ToggleRow } from './SettingsSection';
import { useSettingsForm } from './SettingsForm';
import {
  addExceptions,
  applyPreset,
  belgianHolidays,
  dateKey,
  daysBetween,
  EXCEPTION_KINDS,
  formatHolidayDate,
  formatHours,
  removeException,
  setTargetHours,
  targetHours,
  usesBelgianHolidays,
  weekdayOf,
  WEEKDAY_NAMES,
  WEEKDAYS_MONDAY_FIRST,
  weeklyTargetHours,
} from './targets';
import { issueFor, TARGET_HOURS, targetsValid } from './validation';
import styles from './settings.module.css';

const HOLIDAY_RULES_URL =
  'https://employment.belgium.be/en/themes/international/posting/working-conditions-be-respected-case-posting-belgium/public-holidays';

/** Exceptions shown per page: a long leave range can add hundreds of dates. */
export const EXCEPTIONS_PAGE_SIZE = 20;

/** Monday-first short day names for the target grid ("Mon"). */
const SHORT_DAY = (weekday: number) => (WEEKDAY_NAMES[weekday] ?? '').slice(0, 3);

/** Settings → Targets & reminders → Daily targets: hours per weekday and the workday. */
export function DailyTargetsSection() {
  const { draft, update, issues } = useSettingsForm();
  const targets = draft.targets;
  const valid = targetsValid(targets);
  const issue = issueFor(issues, 'targets');
  return (
    <SettingsSection
      id="targets"
      actions={
        <p className={styles.cardTotal}>
          <span className="visually-hidden">Weekly total: </span>
          <b>{valid ? formatShortDuration(weeklyTargetHours(targets) * 3600) : 'Check daily hours'}</b> a week
        </p>
      }
    >
      <div className={styles.dayGrid}>
        {WEEKDAYS_MONDAY_FIRST.map((weekday) => {
          const hours = targetHours(targets, weekday);
          const invalid = !Number.isFinite(hours) || hours < TARGET_HOURS.min || hours > TARGET_HOURS.max;
          return (
            <NumberField
              key={weekday}
              label={SHORT_DAY(weekday)}
              minValue={TARGET_HOURS.min}
              maxValue={TARGET_HOURS.max}
              value={hours}
              onChange={(value) => {
                if (Number.isFinite(value)) update((current) => ({ ...current, targets: setTargetHours(current.targets, value, weekday) }));
              }}
              isInvalid={invalid}
              formatOptions={{ maximumFractionDigits: 2 }}
              width="full"
              className={hours === 0 ? styles.weekend : undefined}
            />
          );
        })}
      </div>
      {issue ? <InlineIssue>{issue}</InlineIssue> : null}
      <Hint>Hours per day, as decimals: 7.5 is 7h 30m and 0 is a day off.</Hint>
      <WorkdayTimes />
      <Hint>Gaps are only looked for inside your workday. Holidays and leave lower the target for that day.</Hint>
      <div className={styles.row}>
        <Button size="small" onPress={() => update((current) => ({ ...current, targets: applyPreset(current.targets) }))}>
          Use Mon–Thu 8h, Friday 6h
        </Button>
      </div>
    </SettingsSection>
  );
}

function toCivil(date: CalendarDate) {
  return { year: date.year, month: date.month, day: date.day };
}

function AddException() {
  const { update } = useSettingsForm();
  const [from, setFrom] = useState<CalendarDate>(() => today(getLocalTimeZone()));
  const [through, setThrough] = useState<CalendarDate>(() => today(getLocalTimeZone()));
  const [range, setRange] = useState(false);
  const [kind, setKind] = useState<TargetExceptionKind>('Full-day leave');
  const [hours, setHours] = useState(0);
  const [note, setNote] = useState('');
  const days = daysBetween(toCivil(from), toCivil(range ? through : from));
  const hoursValid = Number.isFinite(hours) && hours >= TARGET_HOURS.min && hours <= TARGET_HOURS.max;
  return (
    <div className={styles.group}>
      <h4 className={styles.subTitle}>Add a date exception</h4>
      <div className={styles.fieldRow}>
        <DatePicker label="From" value={from} onChange={(value) => {
          if (value) setFrom(value);
        }} />
        <Checkbox isSelected={range} onChange={setRange}>
          Date range
        </Checkbox>
        {range ? (
          <DatePicker
            label="Through"
            value={through}
            onChange={(value) => {
              if (value) setThrough(value);
            }}
            isInvalid={days.length === 0}
            errorMessage="Choose an end date on or after the start date, within a year."
          />
        ) : null}
      </div>
      <div className={styles.fieldRow}>
        <Select
          label="Exception"
          items={EXCEPTION_KINDS.map((id) => ({ id, label: id }))}
          selectedKey={kind}
          onSelectionChange={(key) => {
            if (typeof key === 'string') setKind(key as TargetExceptionKind);
          }}
        />
        {kind === 'Custom target' ? (
          <NumberField
            label="Target hours"
            unit="hours"
            minValue={TARGET_HOURS.min}
            maxValue={TARGET_HOURS.max}
            value={hours}
            onChange={(value) => setHours(value)}
            formatOptions={{ maximumFractionDigits: 2 }}
            width="full"
          />
        ) : null}
        <TextField label="Note (optional)" value={note} onChange={setNote} />
      </div>
      <div className={styles.row}>
        <Button
          isDisabled={days.length === 0 || !hoursValid}
          onPress={() =>
            update((current) => ({
              ...current,
              targets: addExceptions(
                current.targets,
                days.map((day) => ({ id: dateKey(day), kind, hours, note })),
              ),
            }))
          }
        >
          Add / replace dates
        </Button>
        <Hint>Save changes below to apply.</Hint>
      </div>
      <Hint>
        Half-day leave halves your normal weekday hours. Custom hours override holidays too. Exceptions take priority over the weekly
        schedule.
      </Hint>
    </div>
  );
}

function ExceptionList() {
  const { draft, update } = useSettingsForm();
  const [visible, setVisible] = useState(EXCEPTIONS_PAGE_SIZE);
  const exceptions = useMemo(
    () => [...(draft.targets.dateExceptions ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    [draft.targets.dateExceptions],
  );
  if (exceptions.length === 0) return <Hint>No date exceptions yet.</Hint>;
  const shown = exceptions.slice(0, visible);
  const rest = exceptions.length - shown.length;
  return (
    <div className={styles.group}>
      <h4 className={styles.subTitle}>{`Date exceptions (${exceptions.length})`}</h4>
      <ul role="list" className={styles.list}>
        {shown.map((item) => (
          <li key={item.id} className={styles.listItem}>
            <span className={styles.listText}>
              <span>
                <span className={styles.countdown}>{item.id}</span>
                {` · ${item.kind}`}
                {item.kind === 'Custom target' ? ` · ${formatHours(item.hours)}` : ''}
              </span>
              {item.note ? <span className={styles.listMeta}>{item.note}</span> : null}
            </span>
            <Button
              size="small"
              variant="plain"
              aria-label={`Remove exception on ${item.id}`}
              onPress={() => update((current) => ({ ...current, targets: removeException(current.targets, item.id) }))}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      {rest > 0 ? (
        <div className={styles.row}>
          <Button size="small" onPress={() => setVisible((count) => count + EXCEPTIONS_PAGE_SIZE)}>
            {`Show ${Math.min(rest, EXCEPTIONS_PAGE_SIZE)} more`}
          </Button>
          <Hint>{`${rest} more not shown`}</Hint>
        </div>
      ) : null}
    </div>
  );
}

/** Settings → Targets & reminders → Holidays & leave (1.14 `HolidaySettingsView`). */
export function HolidaysSection() {
  const { draft, update } = useSettingsForm();
  const [year, setYear] = useState(() => today(getLocalTimeZone()).year);
  const targets = draft.targets;
  const holidays = belgianHolidays(year);
  return (
    <SettingsSection id="holidays" subtitle="Adjust targets without creating or changing 7pace entries.">
      <ToggleRow
        title="Use Belgian public holidays"
        isSelected={usesBelgianHolidays(targets)}
        onChange={(belgianHolidaysEnabled) => update((current) => ({ ...current, targets: { ...current.targets, belgianHolidaysEnabled } }))}
      />
      <NumberField
        label="Holiday year"
        minValue={1900}
        maxValue={2200}
        value={year}
        onChange={(value) => {
          if (Number.isInteger(value)) setYear(value);
        }}
        formatOptions={{ useGrouping: false }}
      />
      <h4 className={styles.subTitle}>{`Belgium · ${year}`}</h4>
      {holidays.length > 0 ? (
        <dl className={styles.holidayList}>
          {holidays.map((holiday) => (
            <div key={`${dateKey(holiday.date)}-${holiday.name}`} style={{ display: 'contents' }}>
              <dt>{formatHolidayDate(holiday.date)}</dt>
              <dd>{holiday.name}</dd>
              <dd className={styles.listMeta}>
                {targetHours(targets, weekdayOf(holiday.date)) === 0 ? 'Set replacement date below' : ''}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <Hint>Holidays are calculated for 1583 and later.</Hint>
      )}
      <Hint>
        Replacement dates follow your employer’s arrangements. Add them below; the app does not assume the following Monday. Regional
        or company days off can also be added.
      </Hint>
      <p>
        <a
          href={HOLIDAY_RULES_URL}
          onClick={(event) => {
            event.preventDefault();
            void openExternalLink(HOLIDAY_RULES_URL).catch(() => undefined);
          }}
          className={styles.calendarLabel}
        >
          Belgian public holiday rules
          <ExternalLinkIcon />
          <span className="visually-hidden"> (opens in your browser)</span>
        </a>
      </p>
      <Divider />
      <AddException />
      <ExceptionList />
    </SettingsSection>
  );
}
