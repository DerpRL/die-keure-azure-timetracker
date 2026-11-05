import { createContext, useContext } from 'react';
import type { NavTarget, PageVisibility, Route } from './navigation';

export interface Navigation {
  /** What the main window shows. */
  route: Route;
  /** Shows a place, a view or a 1.14 page id (mapped to where it lives now). */
  navigate: (target: NavTarget) => void;
  /** Whether `target` is reachable: a hidden page's view is not. */
  canNavigate: (target: NavTarget) => boolean;
  /** Whether a 1.14 page is reachable (shown by the user, available on this OS). */
  isPageVisible: PageVisibility;
}

export const NavigationContext = createContext<Navigation | null>(null);

/** The main window's navigation; `null` outside it (the panel, isolated tests). */
export function useNavigation(): Navigation | null {
  return useContext(NavigationContext);
}

/**
 * The current view of `place`, for a place's component (rendered only while its place is shown).
 * Throws outside the main window.
 */
export function usePlaceView<V extends string>(place: Route['place']): { view: V; navigation: Navigation } {
  const navigation = useNavigation();
  if (!navigation || navigation.route.place !== place) throw new Error(`usePlaceView('${place}') outside its place`);
  const route = navigation.route;
  return { view: ('view' in route ? route.view : 'day') as V, navigation };
}
