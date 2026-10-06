import type { ReactNode } from 'react';

/**
 * Shows the first-run appearance onboarding instead of `children` while `app.onboarding` is
 * true (1.14 `InterfaceOnboardingView`). Placeholder until built: renders `children`.
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
