import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { PlaceId } from '../layout/navigation';

/**
 * One lazily loaded component per place (`places/<id>/index.tsx`, default export), so the main
 * window only loads the code of the places the user opens. Each reads its view from
 * `useNavigation()`.
 */
export const PLACE_COMPONENTS: Readonly<Record<PlaceId, LazyExoticComponent<ComponentType>>> = {
  today: lazy(() => import('./today')),
  timesheet: lazy(() => import('./timesheet')),
  insights: lazy(() => import('./insights')),
  settings: lazy(() => import('./settings')),
};
