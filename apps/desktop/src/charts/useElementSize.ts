import { useCallback, useState } from 'react';

export interface ElementSize {
  width: number;
  height: number;
  /** Computed font size in px, so SVG margins follow the UI scale. */
  fontSize: number;
}

const INITIAL: ElementSize = { width: 0, height: 0, fontSize: 16 };

/**
 * Measures an element with ResizeObserver. Charts render at their real pixel size (no viewBox
 * scaling), so text keeps the UI scale and marks line up with pointer coordinates.
 */
export function useElementSize<T extends HTMLElement>(): [(node: T | null) => void, ElementSize] {
  const [size, setSize] = useState<ElementSize>(INITIAL);
  const ref = useCallback((node: T | null) => {
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const fontSize = parseFloat(getComputedStyle(node).fontSize) || 16;
      setSize((previous) =>
        previous.width === width && previous.height === height && previous.fontSize === fontSize
          ? previous
          : { width, height, fontSize },
      );
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}
