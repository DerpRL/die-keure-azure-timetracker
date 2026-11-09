import { useId, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import {
  Button as AriaButton,
  FieldError,
  Group,
  Input,
  Label,
  NumberField as AriaNumberField,
  SearchField as AriaSearchField,
  Text,
  TextArea,
  TextField as AriaTextField,
  type NumberFieldProps as AriaNumberFieldProps,
  type SearchFieldProps as AriaSearchFieldProps,
  type TextFieldProps as AriaTextFieldProps,
  type ValidationResult,
} from 'react-aria-components';
import { t } from '../i18n';
import { cx } from '../utils/cx';
import { stepDuration } from '../utils/duration';
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, SearchIcon } from './icons';
import styles from './Fields.module.css';

interface FieldChromeProps {
  /** Visible label. Use `hideLabel` only where the context labels the field visually. */
  label: string;
  hideLabel?: boolean;
  description?: ReactNode;
  errorMessage?: string | ((validation: ValidationResult) => string);
  /** Field width; `full` stretches, `auto` sizes to the container's flow. */
  width?: 'auto' | 'full' | 'narrow';
  className?: string;
}

export function FieldLabel({ children, hidden }: { children: ReactNode; hidden?: boolean }) {
  return <Label className={hidden ? 'visually-hidden' : styles.label}>{children}</Label>;
}

export function FieldDescription({ children }: { children: ReactNode }) {
  return (
    <Text slot="description" className={styles.description}>
      {children}
    </Text>
  );
}

export function FieldErrorMessage({ children }: { children?: FieldChromeProps['errorMessage'] }) {
  return <FieldError className={styles.error}>{children}</FieldError>;
}

export interface TextFieldProps extends FieldChromeProps, Omit<AriaTextFieldProps, 'className' | 'style' | 'children'> {
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
}

export function TextField({
  label,
  hideLabel,
  description,
  errorMessage,
  width = 'full',
  placeholder,
  multiline = false,
  rows = 4,
  className,
  ...props
}: TextFieldProps) {
  return (
    <AriaTextField {...props} className={cx(styles.field, styles[`width-${width}`], className)}>
      <FieldLabel hidden={hideLabel}>{label}</FieldLabel>
      {multiline ? (
        <TextArea placeholder={placeholder} rows={rows} className={cx(styles.input, styles.textarea)} />
      ) : (
        <Input placeholder={placeholder} className={styles.input} />
      )}
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldErrorMessage>{errorMessage}</FieldErrorMessage>
    </AriaTextField>
  );
}

export interface NumberFieldProps extends FieldChromeProps, Omit<AriaNumberFieldProps, 'className' | 'style' | 'children'> {
  /** Unit shown after the value for sighted users; include it in `formatOptions` for SR output. */
  unit?: string;
}

export function NumberField({
  label,
  hideLabel,
  description,
  errorMessage,
  width = 'narrow',
  unit,
  className,
  ...props
}: NumberFieldProps) {
  return (
    <AriaNumberField {...props} className={cx(styles.field, styles[`width-${width}`], className)}>
      <FieldLabel hidden={hideLabel}>{label}</FieldLabel>
      <Group className={styles.group}>
        <Input className={cx(styles.input, styles.groupInput)} />
        {unit ? (
          <span className={styles.unit} aria-hidden="true">
            {unit}
          </span>
        ) : null}
        <div className={styles.stepper}>
          <AriaButton slot="increment" className={styles.stepButton}>
            <ChevronUpIcon />
          </AriaButton>
          <AriaButton slot="decrement" className={styles.stepButton}>
            <ChevronDownIcon />
          </AriaButton>
        </div>
      </Group>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldErrorMessage>{errorMessage}</FieldErrorMessage>
    </AriaNumberField>
  );
}

export interface DurationFieldProps extends Omit<FieldChromeProps, 'errorMessage'> {
  /** Whole minutes. */
  value: number;
  /** Called with whole minutes when typed hours and minutes within `minValue`–`maxValue` are used, or on a step. */
  onChange: (minutes: number) => void;
  minValue: number;
  maxValue: number;
  /** Minutes per arrow-key press in the minutes box; presses snap to multiples of it. */
  step: number;
  /** The value from outside is out of range (a hand-edited file); `rangeMessage` explains it. */
  isInvalid?: boolean;
  /** Shown when a box holds something other than a whole number (minutes: 0–59). */
  formatMessage: string;
  /** Shown when the duration is outside `minValue`–`maxValue`, and for `isInvalid`. */
  rangeMessage: string;
  /** Whether the boxes hold a duration within range, each time they are used (blur, Enter or a step). */
  onTextValidChange?: (valid: boolean) => void;
}

const splitMinutes = (total: number) => ({ hours: String(Math.floor(total / 60)), minutes: String(total % 60).padStart(2, '0') });

/** The two boxes as whole minutes, or `null` when either is not a whole number (minutes 0–59). */
function joinMinutes(hours: string, minutes: string): number | null {
  const h = hours.trim() === '' ? 0 : Number(hours.trim());
  const m = minutes.trim() === '' ? 0 : Number(minutes.trim());
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/**
 * A duration in whole minutes as two boxes, "[7] h [36] m" (design "dur-in"). Typed digits are
 * used on blur or Enter; the arrow keys step the hours by one and the minutes by `step`, carrying
 * into the hours. Text that is not a duration shows its error under the field and leaves `value`
 * unchanged.
 */
export function DurationField({
  label,
  hideLabel,
  description,
  width = 'narrow',
  className,
  value,
  onChange,
  minValue,
  maxValue,
  step,
  isInvalid = false,
  formatMessage,
  rangeMessage,
  onTextValidChange,
}: DurationFieldProps) {
  const [text, setText] = useState(() => splitMinutes(value));
  // The value `text` was last set from. A new value from outside (a preset, Revert) replaces it.
  const [shown, setShown] = useState(value);
  // Errors show once the text was used (blur or Enter), not while it is being typed.
  const [checked, setChecked] = useState(true);
  const labelId = useId();
  const errorId = useId();
  const descriptionId = useId();
  if (value !== shown) {
    setShown(value);
    setText(splitMinutes(value));
    setChecked(true);
  }
  const parsed = joinMinutes(text.hours, text.minutes);
  const inRange = parsed !== null && parsed >= minValue && parsed <= maxValue;
  const current = inRange ? parsed : value;
  const problem = !checked ? undefined : parsed === null ? formatMessage : !inRange || isInvalid ? rangeMessage : undefined;

  const apply = (minutes: number) => {
    setText(splitMinutes(minutes));
    setChecked(true);
    if (minutes !== value) {
      setShown(minutes);
      onChange(minutes);
    }
  };
  const commit = () => {
    onTextValidChange?.(inRange);
    if (inRange) apply(parsed);
    else setChecked(true);
  };
  const stepBy = (amount: number) => {
    onTextValidChange?.(true);
    const snapped = amount === 60 || amount === -60 ? current + amount : stepDuration(current, amount > 0 ? 1 : -1, { step, min: minValue, max: maxValue });
    apply(Math.min(maxValue, Math.max(minValue, snapped)));
  };
  const keys = (unit: 'hours' | 'minutes') => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const direction = event.key === 'ArrowUp' ? 1 : -1;
      stepBy(unit === 'hours' ? direction * 60 : direction * step);
    } else if (event.key === 'Enter') {
      commit();
    }
  };
  const group = useRef<HTMLDivElement>(null);
  const blur = (event: FocusEvent<HTMLInputElement>) => {
    // Moving between the two boxes is not leaving the field.
    if (!group.current?.contains(event.relatedTarget)) commit();
  };
  const describedBy = [problem ? errorId : null, description ? descriptionId : null].filter(Boolean).join(' ') || undefined;
  const box = (unit: 'hours' | 'minutes') => (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      aria-label={unit === 'hours' ? t('{label} hours', { label }) : t('{label} minutes', { label })}
      aria-invalid={problem ? true : undefined}
      aria-describedby={describedBy}
      value={text[unit]}
      onChange={(event) => {
        const next = event.target.value;
        setText((previous) => ({ ...previous, [unit]: next }));
        setChecked(false);
      }}
      onFocus={(event) => event.target.select()}
      onBlur={blur}
      onKeyDown={keys(unit)}
      className={styles.durationBox}
    />
  );

  return (
    <div ref={group} role="group" aria-labelledby={labelId} className={cx(styles.field, styles[`width-${width}`], className)}>
      <span id={labelId} className={hideLabel ? 'visually-hidden' : styles.label}>
        {label}
      </span>
      <span className={cx(styles.duration, problem !== undefined && styles.durationInvalid)}>
        {box('hours')}
        <span className={styles.durationUnit} aria-hidden="true">
          {t('h')}
        </span>
        {box('minutes')}
        <span className={styles.durationUnit} aria-hidden="true">
          {t('m')}
        </span>
      </span>
      {description ? (
        <span id={descriptionId} className={styles.description}>
          {description}
        </span>
      ) : null}
      {problem ? (
        <span id={errorId} className={styles.error}>
          {problem}
        </span>
      ) : null}
    </div>
  );
}

export interface SearchFieldProps extends FieldChromeProps, Omit<AriaSearchFieldProps, 'className' | 'style' | 'children'> {
  placeholder?: string;
}

/** Search input with a clear button; Escape clears, as in native search fields. */
export function SearchField({
  label,
  hideLabel,
  description,
  errorMessage,
  width = 'full',
  placeholder,
  className,
  ...props
}: SearchFieldProps) {
  return (
    <AriaSearchField {...props} className={cx(styles.field, styles.search, styles[`width-${width}`], className)}>
      <FieldLabel hidden={hideLabel}>{label}</FieldLabel>
      <div className={styles.searchBox}>
        <SearchIcon className={styles.searchIcon} />
        <Input placeholder={placeholder} className={cx(styles.input, styles.searchInput)} />
        <AriaButton className={styles.clearButton} aria-label={t('Clear search')}>
          <CloseIcon />
        </AriaButton>
      </div>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldErrorMessage>{errorMessage}</FieldErrorMessage>
    </AriaSearchField>
  );
}
