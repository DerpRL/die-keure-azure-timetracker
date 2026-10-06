import { render, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { AppProviders, type AppProvidersProps } from '../app/AppProviders';
import { setPlatformOverride, type Platform } from '../shortcuts/platform';

export interface ProviderOptions extends Omit<RenderOptions, 'wrapper'> {
  platform?: Platform;
  providers?: Omit<AppProvidersProps, 'children'>;
}

/** Renders inside the app providers and returns a user-event instance alongside the result. */
export function renderWithProviders(ui: ReactElement, { platform = 'macos', providers, ...options }: ProviderOptions = {}) {
  setPlatformOverride(platform);
  const user = userEvent.setup();
  const result = render(ui, {
    ...options,
    wrapper: ({ children }) => <AppProviders {...providers}>{children}</AppProviders>,
  });
  return { user, ...result };
}
