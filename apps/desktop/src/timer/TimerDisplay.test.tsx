import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from '../theme/ThemeProvider';
import { expectNoA11yViolations } from '../test/axe';
import { formatClock, formatShortDuration, formatSpokenDuration } from '../utils/duration';
import { progressDescription, targetFraction, TimerDisplay, type TimerDisplayProps } from './TimerDisplay';

const TARGET = 7 * 3600 + 36 * 60;

function renderTimer(props: Partial<TimerDisplayProps> = {}, reducedMotion = false) {
  const merged: TimerDisplayProps = {
    seconds: 3661,
    status: 'running',
    sessionId: 's1',
    todaySeconds: 3 * 3600,
    dailyTargetSeconds: TARGET,
    ...props,
  };
  const result = render(
    <ThemeProvider reducedMotion={reducedMotion}>
      <TimerDisplay {...merged} />
    </ThemeProvider>,
  );
  const rerender = (next: Partial<TimerDisplayProps>) =>
    result.rerender(
      <ThemeProvider reducedMotion={reducedMotion}>
        <TimerDisplay {...merged} {...next} />
      </ThemeProvider>,
    );
  return { ...result, rerender };
}

describe('duration formatting (Swift DurationText)', () => {
  it('formats clock, short and spoken durations', () => {
    expect(formatClock(3661)).toBe('01:01:01');
    expect(formatClock(100 * 3600 + 5)).toBe('100:00:05');
    expect(formatClock(-5)).toBe('00:00:00');
    expect(formatClock(Number.NaN)).toBe('00:00:00');
    expect(formatShortDuration(3 * 3600 + 20 * 60 + 59)).toBe('3h 20m');
    expect(formatSpokenDuration(3661)).toBe('1 hour 1 minute 1 second');
    expect(formatSpokenDuration(0)).toBe('0 seconds');
  });

  it('describes progress like 1.14', () => {
    expect(progressDescription(3 * 3600, TARGET, true)).toBe('Today · 39% of daily target');
    expect(progressDescription(3 * 3600, TARGET, false)).toBe('Last known · 39% of daily target');
    expect(progressDescription(3 * 3600, 0, true)).toBe('No daily target today');
    expect(progressDescription(null, TARGET, true)).toBe('Daily total unavailable');
    expect(progressDescription(1, TARGET, true, 'Custom')).toBe('Custom');
    expect(targetFraction(20 * 3600, TARGET)).toBe(1);
    expect(targetFraction(-1, TARGET)).toBe(0);
  });
});

describe('TimerDisplay', () => {
  it('exposes one labelled timer value that is not a live region', async () => {
    renderTimer();
    const timer = screen.getByRole('timer', { name: 'Elapsed time' });
    expect(timer).toHaveAttribute('aria-live', 'off');
    expect(timer).toHaveTextContent('1 hour 1 minute 1 second');
    // The visible digits are hidden from assistive technology; only the spoken value is read.
    expect(timer.querySelector('[aria-hidden="true"]')).toHaveTextContent('00:00:00');
    expect(screen.getByRole('img', { name: /^Tracking clock\. Tracking\. Today · 39% of daily target$/ })).toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('keeps a fixed-width template so digits never shift the layout', () => {
    const { container, rerender } = renderTimer({ seconds: 3599 });
    const template = () => container.querySelector('.template')?.textContent;
    expect(template()).toBe('00:00:00');
    rerender({ seconds: 3600 });
    expect(template()).toBe('00:00:00');
    expect(container.querySelectorAll('.slot')).toHaveLength(6);
  });

  it('rolls changed digits only while confirmed tracking runs', () => {
    const { container, rerender } = renderTimer({ seconds: 3661 });
    expect(container.querySelector('.rollIn')).toBeNull();
    rerender({ seconds: 3662 });
    expect(container.querySelectorAll('.rollIn')).toHaveLength(1);
    expect(container.querySelector('.rollOut')).toHaveTextContent('1');

    rerender({ seconds: 3663, status: 'paused' });
    expect(container.querySelector('.rollIn')).toBeNull();
    expect(container.querySelector('[data-status="paused"]')).not.toBeNull();
  });

  it('starts a new session cleanly instead of rolling from the old time', () => {
    const { container, rerender } = renderTimer({ seconds: 5000 });
    rerender({ seconds: 2, sessionId: 's2' });
    expect(container.querySelector('.rollIn')).toBeNull();
    expect(screen.getByRole('timer')).toHaveTextContent('2 seconds');
  });

  it('disables rolling with reduced motion', () => {
    const { container, rerender } = renderTimer({ seconds: 10 }, true);
    rerender({ seconds: 11 });
    expect(container.querySelector('.rollIn')).toBeNull();
    expect(container.querySelector('.reduced')).not.toBeNull();
  });

  it('caps the ring at one circle and labels missing, stale and absent targets', () => {
    const { container, rerender } = renderTimer({ todaySeconds: 20 * 3600 });
    expect(container.querySelector('[data-fraction]')).toHaveAttribute('data-fraction', '1');
    rerender({ todaySeconds: null });
    expect(container.querySelector('[data-fraction]')).toBeNull();
    expect(screen.getByText('Daily total unavailable')).toBeInTheDocument();
    rerender({ dailyTargetSeconds: 0, todaySeconds: 3600 });
    expect(screen.getByText('No daily target today')).toBeInTheDocument();
    rerender({ totalsConfirmed: false, todaySeconds: 3600 });
    expect(screen.getByText('Last known · 13% of daily target')).toBeInTheDocument();
    expect(container.querySelector('.ringStale')).not.toBeNull();
  });

  it('marks unconfirmed time and uses distinct symbols per state', async () => {
    const { container, rerender } = renderTimer({ status: 'disconnected' });
    expect(screen.getByRole('timer')).toHaveTextContent('last known');
    expect(container.querySelector('.badgeGlyph')).toHaveTextContent('!');
    rerender({ status: 'attention' });
    expect(container.querySelector('.badgeGlyph')).toHaveTextContent('?');
    expect(screen.getByRole('img', { name: /Check activity/ })).toBeInTheDocument();
    await expectNoA11yViolations();
  });
});
