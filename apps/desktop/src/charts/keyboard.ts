/** Index movement for one-dimensional chart marks (bars, points, timeline rows). */
export function nextIndex(key: string, index: number, count: number, orientation: 'horizontal' | 'vertical'): number | null {
  if (count === 0) return null;
  const forward = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
  const backward = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
  switch (key) {
    case forward:
      return Math.min(count - 1, index + 1);
    case backward:
      return Math.max(0, index - 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

export const isActivationKey = (key: string) => key === 'Enter' || key === ' ';
export const isZoomInKey = (key: string) => key === '+' || key === '=';
export const isZoomOutKey = (key: string) => key === '-' || key === '_';

/** Moves DOM focus to the mark at `index` once React has rendered its tabIndex. */
export function focusMark(container: HTMLElement | SVGElement | null, index: number): void {
  const mark = container?.querySelector<HTMLElement | SVGElement>(`[data-mark-index="${index}"]`);
  mark?.focus();
}
