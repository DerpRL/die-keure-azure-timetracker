import { useCallback, useState } from 'react';

/**
 * Whether a `position: sticky` element is stuck at its `top` in the window's scroll (the main
 * window scrolls the document, under the sticky top bar). Lets a sticky toolbar show its
 * separator only once content passes under it.
 */
export function useStuck<T extends HTMLElement>(): [(node: T | null) => (() => void) | undefined, boolean] {
  const [stuck, setStuck] = useState(false);
  const ref = useCallback((node: T | null) => {
    if (!node) return undefined;
    // Scroll events come at most once a frame; React skips the render when nothing changed.
    const check = () => {
      const top = parseFloat(getComputedStyle(node).top) || 0;
      setStuck(window.scrollY > 0 && node.getBoundingClientRect().top <= top + 0.5);
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, []);
  return [ref, stuck];
}
