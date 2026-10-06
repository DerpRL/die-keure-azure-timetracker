/** Joins class names, skipping falsy values. */
export function cx(...values: Array<string | false | null | undefined>): string {
  let result = '';
  for (const value of values) {
    if (value) result = result ? `${result} ${value}` : value;
  }
  return result;
}

/**
 * Merges a React Aria `className` prop (string or render function) with component classes.
 * Returns a render function so state-dependent classes keep working.
 */
export function composeClassName<T>(
  base: string | undefined,
  className: string | ((values: T & { defaultClassName: string | undefined }) => string) | undefined,
): string | ((values: T & { defaultClassName: string | undefined }) => string) {
  if (typeof className === 'function') {
    return (values) => cx(base, className(values));
  }
  return cx(base, className);
}
