import type { ReactNode } from 'react';
import {
  Button as AriaButton,
  Calendar as AriaCalendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  DateInput,
  DatePicker as AriaDatePicker,
  DateRangePicker as AriaDateRangePicker,
  DateSegment,
  Dialog,
  Group,
  Heading,
  Popover as AriaPopover,
  RangeCalendar as AriaRangeCalendar,
  TimeField as AriaTimeField,
  type CalendarProps as AriaCalendarProps,
  type DatePickerProps as AriaDatePickerProps,
  type DateRangePickerProps as AriaDateRangePickerProps,
  type DateValue,
  type RangeCalendarProps as AriaRangeCalendarProps,
  type TimeFieldProps as AriaTimeFieldProps,
  type TimeValue,
  type ValidationResult,
} from 'react-aria-components';
import { cx } from '../utils/cx';
import { FieldDescription, FieldErrorMessage, FieldLabel } from './Fields';
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from './icons';
import { popoverClassNames } from './Popover';
import styles from './DateFields.module.css';

interface DateChromeProps {
  label: string;
  hideLabel?: boolean;
  description?: ReactNode;
  errorMessage?: string | ((validation: ValidationResult) => string);
  className?: string;
}

function Segments() {
  return (
    <DateInput className={styles.input}>
      {(segment) => <DateSegment segment={segment} className={styles.segment} />}
    </DateInput>
  );
}

function CalendarHeader() {
  return (
    <header className={styles.calendarHeader}>
      <AriaButton slot="previous" className={styles.navButton}>
        <ChevronLeftIcon />
      </AriaButton>
      <Heading className={styles.calendarHeading} />
      <AriaButton slot="next" className={styles.navButton}>
        <ChevronRightIcon />
      </AriaButton>
    </header>
  );
}

function Grid() {
  return (
    <CalendarGrid className={styles.grid} weekdayStyle="short">
      <CalendarGridHeader>
        {(day) => <CalendarHeaderCell className={styles.weekday}>{day}</CalendarHeaderCell>}
      </CalendarGridHeader>
      <CalendarGridBody>{(date) => <CalendarCell date={date} className={styles.day} />}</CalendarGridBody>
    </CalendarGrid>
  );
}

export function Calendar<T extends DateValue>({ className, ...props }: AriaCalendarProps<T> & { className?: string }) {
  return (
    <AriaCalendar {...props} className={cx(styles.calendar, className)}>
      <CalendarHeader />
      <Grid />
    </AriaCalendar>
  );
}

export function RangeCalendar<T extends DateValue>({ className, ...props }: AriaRangeCalendarProps<T> & { className?: string }) {
  return (
    <AriaRangeCalendar {...props} className={cx(styles.calendar, styles.range, className)}>
      <CalendarHeader />
      <Grid />
    </AriaRangeCalendar>
  );
}

export interface DatePickerProps<T extends DateValue>
  extends DateChromeProps,
    Omit<AriaDatePickerProps<T>, 'className' | 'style' | 'children'> {}

/** Date (or date and time) entry with typed segments and a calendar popover. */
export function DatePicker<T extends DateValue>({
  label,
  hideLabel,
  description,
  errorMessage,
  className,
  ...props
}: DatePickerProps<T>) {
  return (
    <AriaDatePicker {...props} className={cx(styles.field, className)}>
      <FieldLabel hidden={hideLabel}>{label}</FieldLabel>
      <Group className={styles.group}>
        <Segments />
        <AriaButton className={styles.calendarButton}>
          <CalendarIcon />
        </AriaButton>
      </Group>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldErrorMessage>{errorMessage}</FieldErrorMessage>
      <AriaPopover className={cx(popoverClassNames.popover, styles.popover)}>
        <Dialog className={styles.dialog}>
          <Calendar />
        </Dialog>
      </AriaPopover>
    </AriaDatePicker>
  );
}

export interface DateRangePickerProps<T extends DateValue>
  extends DateChromeProps,
    Omit<AriaDateRangePickerProps<T>, 'className' | 'style' | 'children'> {}

/** Start and end dates in one field (History range, exact explorer range). */
export function DateRangePicker<T extends DateValue>({
  label,
  hideLabel,
  description,
  errorMessage,
  className,
  ...props
}: DateRangePickerProps<T>) {
  return (
    <AriaDateRangePicker {...props} className={cx(styles.field, className)}>
      <FieldLabel hidden={hideLabel}>{label}</FieldLabel>
      <Group className={styles.group}>
        <DateInput slot="start" className={styles.input}>
          {(segment) => <DateSegment segment={segment} className={styles.segment} />}
        </DateInput>
        <span aria-hidden="true" className={styles.rangeDash}>
          –
        </span>
        <DateInput slot="end" className={styles.input}>
          {(segment) => <DateSegment segment={segment} className={styles.segment} />}
        </DateInput>
        <AriaButton className={styles.calendarButton}>
          <CalendarIcon />
        </AriaButton>
      </Group>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldErrorMessage>{errorMessage}</FieldErrorMessage>
      <AriaPopover className={cx(popoverClassNames.popover, styles.popover)}>
        <Dialog className={styles.dialog}>
          <RangeCalendar />
        </Dialog>
      </AriaPopover>
    </AriaDateRangePicker>
  );
}

export interface TimeFieldProps<T extends TimeValue>
  extends DateChromeProps,
    Omit<AriaTimeFieldProps<T>, 'className' | 'style' | 'children'> {}

/** Time of day; 24-hour in the default en-GB locale. */
export function TimeField<T extends TimeValue>({ label, hideLabel, description, errorMessage, className, ...props }: TimeFieldProps<T>) {
  return (
    <AriaTimeField {...props} className={cx(styles.field, className)}>
      <FieldLabel hidden={hideLabel}>{label}</FieldLabel>
      <DateInput className={cx(styles.group, styles.timeGroup, styles.input)}>
        {(segment) => <DateSegment segment={segment} className={styles.segment} />}
      </DateInput>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldErrorMessage>{errorMessage}</FieldErrorMessage>
    </AriaTimeField>
  );
}
