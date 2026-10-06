import axe, { type RunOptions } from 'axe-core';
import { expect } from 'vitest';

/**
 * Runs axe-core and fails with a readable list of violations. Colour contrast is excluded because
 * jsdom has no layout or cascade; `contrast.test.ts` checks every token pair instead. The
 * `region` rule is off because components are rendered outside page landmarks in tests.
 */
export async function expectNoA11yViolations(context: Element | Document = document.body, options: RunOptions = {}) {
  const results = await axe.run(context, {
    ...options,
    rules: {
      'color-contrast': { enabled: false },
      region: { enabled: false },
      ...options.rules,
    },
  });
  const messages = results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? 'n/a'}): ${violation.help}\n${violation.nodes
        .map((node) => `    ${node.target.join(' ')}\n      ${node.failureSummary ?? ''}`)
        .join('\n')}`,
  );
  expect(messages, messages.join('\n\n')).toEqual([]);
}
