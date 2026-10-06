import { createContext, useContext } from 'react';

/** The id the shell gives the page's <h1>, so the main landmark can be labelled by it. */
export const PageTitleContext = createContext<string | undefined>(undefined);

export function usePageTitleId(): string | undefined {
  return useContext(PageTitleContext);
}
