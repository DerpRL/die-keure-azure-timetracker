import type { ReactNode } from 'react';
import { useSlice } from '../../state/hooks';
import { AppearanceOnboarding } from './AppearanceOnboarding';

/**
 * Shows the first-run appearance onboarding instead of `children` while `app.onboarding` is
 * true (1.14 `InterfaceOnboardingView`). Until the app slice arrives the app renders as usual
 * (its pages show their own loading states).
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const app = useSlice('app');
  if (app?.onboarding) return <AppearanceOnboarding />;
  return <>{children}</>;
}
