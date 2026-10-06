import { useId, type ReactNode } from 'react';
import { Label, ProgressBar as AriaProgressBar } from 'react-aria-components';
import { cx } from '../utils/cx';
import styles from './Progress.module.css';

export type ProgressTone = 'accent' | 'running' | 'paused' | 'warning' | 'danger';

interface SharedProps {
  label: string;
  hideLabel?: boolean;
  value?: number;
  minValue?: number;
  maxValue?: number;
  /** Text for both the visible value and `aria-valuetext`, e.g. "5h 12m of 7h 36m". */
  valueLabel?: string;
  showValueLabel?: boolean;
  tone?: ProgressTone;
  /** Below the bar, e.g. "Last known". */
  detail?: ReactNode;
  className?: string;
}

function Bar({ percentage, tone }: { percentage: number | undefined; tone: ProgressTone }) {
  const width = percentage === undefined ? undefined : `${Math.min(100, Math.max(0, percentage))}%`;
  return (
    <div className={styles.track}>
      <div className={cx(styles.fill, styles[tone], width === undefined && styles.indeterminate)} style={{ width }} />
    </div>
  );
}

export interface ProgressBarProps extends SharedProps {
  /** Unknown duration: shows an animated bar (static with reduced motion). */
  isIndeterminate?: boolean;
}

/** Progress of a task (download, overlap scan). Use `Meter` for a value against a target. */
export function ProgressBar({
  label,
  hideLabel,
  value = 0,
  minValue = 0,
  maxValue = 100,
  valueLabel,
  showValueLabel = true,
  isIndeterminate,
  tone = 'accent',
  detail,
  className,
}: ProgressBarProps) {
  return (
    <AriaProgressBar
      value={value}
      minValue={minValue}
      maxValue={maxValue}
      valueLabel={valueLabel}
      isIndeterminate={isIndeterminate}
      className={cx(styles.progress, className)}
    >
      {({ percentage, valueText }) => (
        <>
          <div className={cx(styles.labels, hideLabel && styles.labelsHidden)}>
            <Label className={hideLabel ? 'visually-hidden' : styles.label}>{label}</Label>
            {showValueLabel && !isIndeterminate ? <span className={styles.value}>{valueText}</span> : null}
          </div>
          <Bar percentage={isIndeterminate ? undefined : percentage} tone={tone} />
          {detail ? <div className={styles.detail}>{detail}</div> : null}
        </>
      )}
    </AriaProgressBar>
  );
}

export type MeterProps = SharedProps;

/**
 * A value within a known range (today's time against the daily target). Values past the maximum
 * keep their text but the bar stays full.
 */
export function Meter({
  label,
  hideLabel,
  value = 0,
  minValue = 0,
  maxValue = 100,
  valueLabel,
  showValueLabel = true,
  tone = 'running',
  detail,
  className,
}: MeterProps) {
  const labelId = useId();
  const clamped = Math.min(Math.max(value, minValue), maxValue);
  const range = maxValue - minValue;
  const percentage = range > 0 ? ((clamped - minValue) / range) * 100 : 0;
  const valueText = valueLabel ?? `${Math.round(percentage)}%`;
  // role="meter" directly: React Aria's "meter progressbar" fallback trips axe, and every
  // supported web view (WebView2, WKWebView on macOS 14+) knows the meter role.
  return (
    <div
      role="meter"
      aria-labelledby={labelId}
      aria-valuenow={clamped}
      aria-valuemin={minValue}
      aria-valuemax={maxValue}
      aria-valuetext={valueText}
      className={cx(styles.progress, className)}
    >
      <div className={cx(styles.labels, hideLabel && styles.labelsHidden)}>
        <span id={labelId} className={hideLabel ? 'visually-hidden' : styles.label}>
          {label}
        </span>
        {showValueLabel ? (
          <span className={styles.value} aria-hidden="true">
            {valueText}
          </span>
        ) : null}
      </div>
      <Bar percentage={percentage} tone={tone} />
      {detail ? <div className={styles.detail}>{detail}</div> : null}
    </div>
  );
}
