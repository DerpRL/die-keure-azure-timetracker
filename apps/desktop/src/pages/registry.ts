import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { PageId } from '../layout/navigation';

/**
 * One lazily loaded component per sidebar page (`pages/<id>/index.tsx`, default export), so the
 * main window only loads the code of the pages the user opens.
 */
export const PAGE_COMPONENTS: Readonly<Record<PageId, LazyExoticComponent<ComponentType>>> = {
  overview: lazy(() => import('./overview')),
  dayReview: lazy(() => import('./dayReview')),
  agenda: lazy(() => import('./agenda')),
  offlineDrafts: lazy(() => import('./offlineDrafts')),
  statistics: lazy(() => import('./statistics')),
  weeklyReport: lazy(() => import('./weeklyReport')),
  history: lazy(() => import('./history')),
  timeEditor: lazy(() => import('./timeEditor')),
  repositories: lazy(() => import('./repositories')),
  figma: lazy(() => import('./figma')),
  settings: lazy(() => import('./settings')),
};
