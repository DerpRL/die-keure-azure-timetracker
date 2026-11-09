import { getLocalTimeZone, today, type CalendarDate } from '@internationalized/date';
import { useMemo, useState } from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { DatePicker } from '../../components/DateFields';
import { DurationField, NumberField, TextField } from '../../components/Fields';
import { Select } from '../../components/Pickers';
import { Checkbox } from '../../components/Toggles';
import type { TargetExceptionKind } from '../../ipc/contract';
import { formatShortDuration } from '../../utils/duration';
import { ExternalLink } from './ExternalLink';
import { WorkdayTimes } from './DayReviewSection';
import { ChoiceButtons } from './ChoiceButtons';
import { FullRow, Hint, InlineIssue, SectionBody, SectionFooter, SettingRow, SettingsSection, ToggleRow } from './SettingsSection';
import { useSettingsForm } from './SettingsForm';
import {
  addExceptions,
  applyPreset,
  matchesPreset,
  TARGET_PRESETS,
  belgianHolidays,
  dateKey,
  daysBetween,
  EXCEPTION_KIND_LABELS,
  EXCEPTION_KINDS,
  formatHolidayDate,
  formatHours,
  MAX_DAILY_MINUTES,
  removeException,
  setTargetMinutes,
  TARGET_STEP_MINUTES,
  targetMinutes,
  usesBelgianHolidays,
  weekdayOf,
  weekdayName,
  WEEKDAYS_MONDAY_FIRST,
  weeklyTargetMinutes,
} from './targets';
import { issueFor, TARGET_MINUTES, targetsValid } from './validation';
import { t, tn } from '../../i18n';
import styles from './settings.module.css';

const HOLIDAY_RULES_URL =
  'https://employment.belgium.be/en/themes/international/posting/working-conditions-be-respected-case-posting-belgium/public-holidays';

/** Exceptions shown per page: a long leave range can add hundreds of dates. */
export const EXCEPTIONS_PAGE_SIZE = 20;

/** What a target field says about text it cannot use (short: the day columns are narrow). */
const targetFormatMessage = () => t('Use whole hours and 0–59 minutes');
const targetRangeMessage = () => t('Use 0 to 24h');

/** Settings → Schedule & holidays → Weekly target: hours and minutes per weekday, and presets. */
export function DailyTargetsSection() {
  const { draft, update, issues } = useSettingsForm();
  const targets = draft.targets;
  const valid = targetsValid(targets);
  const issue = issueFor(issues, 'targets');
  const preset = TARGET_PRESETS.find((entry) => matchesPreset(targets, entry));
  return (
    <SettingsSection
      id="targets"
      subtitle={t('Hours and minutes you aim to log each day, for example 7h 36m.')}
      actions={
        <Badge tone="accent" className={styles.totalChip}>
          <span className="visually-hidden">{t('Weekly total:')} </span>
          {valid
            ? t('{total} a week', { total: formatShortDuration(weeklyTargetMinutes(targets) * 60).replace(/ 0m$/, '') })
            : t('Check daily targets')}
        </Badge>
      }
    >
      <SectionBody className={styles.dayGridFrame}>
        <div className={styles.dayGrid}>
          {WEEKDAYS_MONDAY_FIRST.map((weekday) => {
            const minutes = targetMinutes(targets, weekday);
            const invalid = !Number.isInteger(minutes) || minutes < TARGET_MINUTES.min || minutes > TARGET_MINUTES.max;
            return (
              <DurationField
                key={weekday}
                label={weekdayName(weekday, 'short')}
                minValue={0}
                maxValue={MAX_DAILY_MINUTES}
                step={TARGET_STEP_MINUTES}
                value={minutes}
                onChange={(value) => update((current) => ({ ...current, targets: setTargetMinutes(current.targets, value, weekday) }))}
                isInvalid={invalid}
                formatMessage={targetFormatMessage()}
                rangeMessage={targetRangeMessage()}
                width="full"
                className={minutes === 0 ? styles.weekend : undefined}
              />
            );
          })}
        </div>
        {issue ? <InlineIssue>{issue}</InlineIssue> : null}
        <Hint>{t('Use 0 for a day off. In a box, the arrow keys step by an hour or a quarter hour.')}</Hint>
      </SectionBody>
      <SettingRow title={t('Presets')} help={t('Fills in the days above. You can still change each day.')}>
        <ChoiceButtons
          label={t('Presets')}
          selectionMode="single"
          items={TARGET_PRESETS.map(({ id, label }) => ({ id, label: label() }))}
          selected={new Set(preset ? [preset.id] : [])}
          onChange={(keys) => {
            const chosen = TARGET_PRESETS.find((entry) => keys.has(entry.id));
            if (chosen) update((current) => ({ ...current, targets: applyPreset(current.targets, chosen) }));
          }}
        />
      </SettingRow>
    </SettingsSection>
  );
}

/** Settings → Schedule & holidays → Workday: when gaps can happen and the day review comes. */
export function WorkdaySection() {
  return (
    <SettingsSection id="workday" subtitle={t('Gaps are only looked for inside these hours.')}>
      <WorkdayTimes />
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
  const [minutes, setMinutes] = useState(0);
  const [minutesTyped, setMinutesTyped] = useState(true);
  const [note, setNote] = useState('');
  const days = daysBetween(toCivil(from), toCivil(range ? through : from));
  // Exceptions keep decimal hours (`TargetException::hours`); the engine counts them to the minute.
  const hours = minutes / 60;
  return (
    <SectionBody tone="sunken">
      <p className="visually-hidden">{t('Add a date exception')}</p>
      <div className={styles.addForm}>
        <DatePicker
          label={range ? t('From') : t('Date')}
          value={from}
          onChange={(value) => {
            if (value) setFrom(value);
          }}
        />
        {range ? (
          <DatePicker
            label={t('Through')}
            value={through}
            onChange={(value) => {
              if (value) setThrough(value);
            }}
            isInvalid={days.length === 0}
            errorMessage={t('Choose an end date on or after the start date, within a year.')}
          />
        ) : null}
        <Select
          label={t('Type')}
          items={EXCEPTION_KINDS.map((id) => ({ id, label: t(EXCEPTION_KIND_LABELS[id]) }))}
          selectedKey={kind}
          onSelectionChange={(key) => {
            if (typeof key !== 'string') return;
            setKind(key as TargetExceptionKind);
            // The target field remounts showing the last valid target.
            setMinutesTyped(true);
          }}
        />
        {kind === 'Custom target' ? (
          <DurationField
            label={t('Target')}
            minValue={0}
            maxValue={MAX_DAILY_MINUTES}
            step={TARGET_STEP_MINUTES}
            value={minutes}
            onChange={setMinutes}
            onTextValidChange={setMinutesTyped}
            formatMessage={targetFormatMessage()}
            rangeMessage={targetRangeMessage()}
          />
        ) : null}
        <TextField label={t('Note (optional)')} value={note} onChange={setNote} />
        <Button
          variant="primary"
          isDisabled={days.length === 0 || (kind === 'Custom target' && !minutesTyped)}
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
          {range ? t('Add / replace dates') : t('Add exception')}
        </Button>
      </div>
      <Checkbox isSelected={range} onChange={setRange}>
        {t('A range of dates')}
      </Checkbox>
      <Hint>
        {t(
          'Half-day leave halves your normal weekday target. Custom targets override holidays too. Exceptions take priority over the weekly schedule. Save changes to apply.',
        )}
      </Hint>
    </SectionBody>
  );
}

function ExceptionList() {
  const { draft, update } = useSettingsForm();
  const [visible, setVisible] = useState(EXCEPTIONS_PAGE_SIZE);
  const exceptions = useMemo(
    () => [...(draft.targets.dateExceptions ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    [draft.targets.dateExceptions],
  );
  if (exceptions.length === 0) {
    return (
      <FullRow className={styles.emptyRow}>
        <p className={styles.rowTitle}>{t('No exceptions yet')}</p>
        <Hint>{t('Add your leave so the day review does not flag those days as empty.')}</Hint>
      </FullRow>
    );
  }
  const shown = exceptions.slice(0, visible);
  const rest = exceptions.length - shown.length;
  return (
    <>
      <ul role="list" aria-label={t('Date exceptions ({count})', { count: exceptions.length })} className={styles.rowList}>
        {shown.map((item) => (
          <li key={item.id} className={styles.listRow}>
            <span className={styles.listDate}>{item.id}</span>
            <span className={styles.listText}>
              <span>
                {t(EXCEPTION_KIND_LABELS[item.kind])}
                {item.kind === 'Custom target' ? ` · ${formatHours(item.hours)}` : ''}
              </span>
              {item.note ? <span className={styles.listMeta}>{item.note}</span> : null}
            </span>
            <Button
              size="small"
              variant="plain"
              aria-label={t('Remove exception on {date}', { date: item.id })}
              onPress={() => update((current) => ({ ...current, targets: removeException(current.targets, item.id) }))}
            >
              {t('Remove')}
            </Button>
          </li>
        ))}
      </ul>
      {rest > 0 ? (
        <FullRow>
          <div className={styles.buttonRow}>
            <Button size="small" onPress={() => setVisible((count) => count + EXCEPTIONS_PAGE_SIZE)}>
              {t('Show {count} more', { count: Math.min(rest, EXCEPTIONS_PAGE_SIZE) })}
            </Button>
            <Hint>{t('{count} more not shown', { count: rest })}</Hint>
          </div>
        </FullRow>
      ) : null}
    </>
  );
}

/** Days from `from` to `to` (both civil dates). */
function daysUntil(from: CivilDay, to: CivilDay): number {
  return Math.round((Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / 86_400_000);
}

type CivilDay = { year: number; month: number; day: number };

/** Settings → Schedule & holidays → Public holidays (1.14 `HolidaySettingsView`). */
export function HolidaysSection() {
  const { draft, update } = useSettingsForm();
  const now = today(getLocalTimeZone());
  const [year, setYear] = useState(() => now.year);
  const targets = draft.targets;
  const enabled = usesBelgianHolidays(targets);
  const holidays = belgianHolidays(year);
  const todayCivil = toCivil(now);
  // The next holiday that lowers a target (one on a day off changes nothing).
  const upcoming = holidays.find(
    (holiday) => daysUntil(todayCivil, holiday.date) >= 0 && targetMinutes(targets, weekdayOf(holiday.date)) > 0,
  );
  const onWorkdays = holidays.filter((holiday) => targetMinutes(targets, weekdayOf(holiday.date)) > 0).length;
  return (
    <SettingsSection
      id="holidays"
      subtitle={t('Holidays set the target for that day to 0h. Nothing is created or changed in 7pace.')}
      actions={
        <NumberField
          label={t('Holiday year')}
          hideLabel
          minValue={1900}
          maxValue={2200}
          value={year}
          onChange={(value) => {
            if (Number.isInteger(value)) setYear(value);
          }}
          formatOptions={{ useGrouping: false }}
          className={styles.yearField}
        />
      }
    >
      <ToggleRow
        title={t('Lower my target on Belgian public holidays')}
        help={
          <>
            {t('Replacement days follow your employer’s arrangements: add them under Days off & exceptions.')}{' '}
            <ExternalLink href={HOLIDAY_RULES_URL}>{t('Belgian public holiday rules')}</ExternalLink>
          </>
        }
        isSelected={enabled}
        onChange={(belgianHolidaysEnabled) => update((current) => ({ ...current, targets: { ...current.targets, belgianHolidaysEnabled } }))}
      />
      {holidays.length > 0 ? (
        <ul role="list" aria-label={t('Belgian public holidays {year}', { year })} className={styles.holidayGrid}>
          {holidays.map((holiday) => {
            const days = daysUntil(todayCivil, holiday.date);
            const past = days < 0;
            const dayOff = targetMinutes(targets, weekdayOf(holiday.date)) === 0;
            return (
              <li key={`${dateKey(holiday.date)}-${holiday.name}`} className={past || !enabled ? styles.holidayPast : styles.holiday}>
                <span className={styles.holidayDate}>{formatHolidayDate(holiday.date, 'short')}</span>
                <span className={styles.holidayName}>{t(holiday.name)}</span>
                {dayOff ? (
                  <Badge tone="warning">{t('Day off · no effect')}</Badge>
                ) : holiday === upcoming && enabled ? (
                  <Badge tone="accent">{days === 0 ? t('Today') : tn(days, 'Next · in {count} day', 'Next · in {count} days')}</Badge>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <FullRow>
          <Hint>{t('Holidays are calculated for 1583 and later.')}</Hint>
        </FullRow>
      )}
      {holidays.length > 0 ? <SectionFooter>{t('{count} of {total} fall on a workday in {year}', { count: onWorkdays, total: holidays.length, year })}</SectionFooter> : null}
    </SettingsSection>
  );
}

/** Settings → Schedule & holidays → Days off & exceptions: leave, half days, other targets. */
export function ExceptionsSection() {
  return (
    <SettingsSection id="exceptions" subtitle={t('Leave, half days or a different target for one date.')}>
      <ExceptionList />
      <AddException />
    </SettingsSection>
  );
}
