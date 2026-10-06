import { useState } from 'react';
import { cx } from '../utils/cx';
import styles from './TimerDisplay.module.css';

interface DigitProps {
  digit: string;
  animate: boolean;
}

/**
 * One digit position. Its width comes from an invisible "0" in the same tabular font, so a
 * change of digit never changes the layout. On change, the old digit rolls up and out while the
 * new one rolls in from below (Swift `.numericText(countsDown: false)`).
 */
function Digit({ digit, animate }: DigitProps) {
  const [shown, setShown] = useState({ digit, previous: null as string | null, generation: 0 });
  if (shown.digit !== digit) {
    // Derived from the previous render, React's documented pattern for "previous value" state.
    setShown({ digit, previous: animate ? shown.digit : null, generation: shown.generation + 1 });
  }
  const rolling = animate && shown.previous !== null;
  return (
    <span className={styles.slot}>
      <span className={styles.sizer}>0</span>
      {rolling ? (
        <span key={`out-${shown.generation}`} className={cx(styles.digit, styles.rollOut)}>
          {shown.previous}
        </span>
      ) : null}
      <span key={`in-${shown.generation}`} className={cx(styles.digit, rolling && styles.rollIn)}>
        {shown.digit}
      </span>
    </span>
  );
}

export interface RollingDigitsProps {
  /** Formatted clock text, e.g. "01:02:03" or "123:04:05". */
  text: string;
  /** Roll digits on change. Off while paused, unconfirmed or with reduced motion. */
  animate: boolean;
}

/** Fixed-width clock text whose digits roll without moving anything around them. */
export function RollingDigits({ text, animate }: RollingDigitsProps) {
  return (
    <span className={styles.digits} aria-hidden="true">
      {[...text].map((char, index) =>
        /[0-9]/.test(char) ? (
          // Positions are counted from the right so seconds keep their slot when hours grow.
          <Digit key={text.length - index} digit={char} animate={animate} />
        ) : (
          <span key={`sep-${text.length - index}`} className={styles.separator}>
            {char}
          </span>
        ),
      )}
    </span>
  );
}
