import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as PlatformModule from './platform';
import { ExternalLink } from './ExternalLink';

const platform = vi.hoisted(() => ({ openExternalLink: vi.fn(() => Promise.resolve()) }));

vi.mock('./platform', async (importOriginal) => ({ ...(await importOriginal<typeof PlatformModule>()), ...platform }));

const URL = 'https://diekeure-webdev.timehub.7pace.com';

function renderLink() {
  render(<ExternalLink href={URL}>diekeure-webdev.timehub.7pace.com</ExternalLink>);
  return screen.getByRole('link', { name: /^diekeure-webdev\.timehub\.7pace\.com\s*\(opens in your browser\)$/ });
}

afterEach(() => platform.openExternalLink.mockClear());

describe('ExternalLink', () => {
  it('is a real link that would open a new browsing context, never this window', () => {
    const link = renderLink();
    expect(link).toHaveAttribute('href', URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it.each([
    ['a click', {}],
    ['⌘-click', { metaKey: true }],
    ['Ctrl-click', { ctrlKey: true }],
    ['Shift-click', { shiftKey: true }],
  ])('opens %s in the default browser instead of navigating', (_name, modifiers) => {
    const link = renderLink();
    const followed = fireEvent.click(link, modifiers);
    // `fireEvent` returns false when the default (following the link) was prevented.
    expect(followed).toBe(false);
    expect(platform.openExternalLink).toHaveBeenCalledWith(URL);
  });

  it('opens with Return from the keyboard', async () => {
    const user = userEvent.setup();
    const link = renderLink();
    await user.tab();
    expect(link).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(platform.openExternalLink).toHaveBeenCalledWith(URL);
  });

  it('opens a middle click in the browser too, and leaves other buttons alone', () => {
    const link = renderLink();
    expect(fireEvent(link, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))).toBe(false);
    expect(platform.openExternalLink).toHaveBeenCalledTimes(1);
    expect(fireEvent(link, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 2 }))).toBe(true);
    expect(platform.openExternalLink).toHaveBeenCalledTimes(1);
  });

  it('says why when the browser could not be opened, without navigating', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    platform.openExternalLink.mockImplementationOnce(() => Promise.reject(new Error('denied')));
    const link = renderLink();
    expect(fireEvent.click(link)).toBe(false);
    return vi.waitFor(() => expect(warn).toHaveBeenCalledWith('The link could not be opened.', expect.any(Error)));
  });
});
