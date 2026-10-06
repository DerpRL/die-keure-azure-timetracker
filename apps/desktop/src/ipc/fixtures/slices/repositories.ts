import type { RepositoriesSlice, RepositoryView, ScanView, SliceMap } from '../../contract';

const webshop: RepositoryView = {
  id: '0f9a3c2e-5b7d-4e1a-8c6f-2d4b6a8c0e12',
  path: '/Users/sam/Documents/repositories/webshop',
  name: 'webshop',
  enabled: true,
  branch: 'feature/AB#4790-vat-number',
  detached: false,
  error: null,
};

const designSystem: RepositoryView = {
  id: '7c1e9b3a-2d4f-4a6b-9c8e-1f3a5b7d9e24',
  path: '/Users/sam/Documents/repositories/design-system',
  name: 'design-system',
  enabled: true,
  branch: 'main',
  detached: false,
  error: null,
};

const idleScan: ScanView = { scanning: false, root: null, results: [], unreadable: [], error: null };

export default {
  repositories: {
    watching: true,
    repositories: [webshop, designSystem],
    scan: idleScan,
  },
} satisfies Partial<SliceMap>;

/** Every row state: a branch, detached HEAD, a read error, paused, and still reading. */
export const repositoriesWithIssues: RepositoriesSlice = {
  watching: true,
  repositories: [
    webshop,
    { ...designSystem, branch: null, detached: true },
    {
      id: 'b2d4f6a8-1c3e-4a5b-8d7f-9e1a3c5b7d90',
      path: '/Users/sam/Documents/repositories/payments-api',
      name: 'payments-api',
      enabled: true,
      branch: null,
      detached: false,
      error: 'The repository could not be read: /Users/sam/Documents/repositories/payments-api/.git is missing.',
    },
    {
      id: 'c3e5a7b9-2d4f-4b6c-9e8a-0f2b4d6f8a13',
      path: '/Users/sam/Documents/repositories/legacy-portal',
      name: 'legacy-portal',
      enabled: false,
      branch: null,
      detached: false,
      error: null,
    },
    {
      id: 'd4f6b8c0-3e5a-4c7d-8f9b-1a3c5e7a9b24',
      path: '/Users/sam/Documents/repositories/mobile-app',
      name: 'mobile-app',
      enabled: true,
      branch: null,
      detached: false,
      error: null,
    },
  ],
  scan: idleScan,
};

/** No repositories yet, watching paused. */
export const emptyRepositories: RepositoriesSlice = { watching: false, repositories: [], scan: idleScan };

const ROOT = '/Users/sam/Documents/repositories';

/** A scan of the repositories folder in progress. */
export const scanningRepositories: RepositoriesSlice = {
  watching: true,
  repositories: [webshop, designSystem],
  scan: { scanning: true, root: ROOT, results: [], unreadable: [], error: null },
};

/** A finished scan: two repositories already watched, three new ones, one worktree, two unreadable folders. */
export const scanResults: RepositoriesSlice = {
  watching: true,
  repositories: [webshop, designSystem],
  scan: {
    scanning: false,
    root: ROOT,
    results: [
      { path: `${ROOT}/design-system`, branch: 'main', alreadyAdded: true },
      { path: `${ROOT}/mobile-app`, branch: 'develop', alreadyAdded: false },
      { path: `${ROOT}/payments-api`, branch: 'feature/4821-retry-card-payments', alreadyAdded: false },
      { path: `${ROOT}/webshop`, branch: 'feature/AB#4790-vat-number', alreadyAdded: true },
      { path: `${ROOT}/webshop-worktrees/4802-invoice-pdf`, branch: 'bugfix/4802-invoice-pdf', alreadyAdded: false },
    ],
    unreadable: [`${ROOT}/archive/locked`, `${ROOT}/clients/acme (no permission)`],
    error: null,
  },
};

/** A finished scan that found nothing. */
export const emptyScan: RepositoriesSlice = {
  ...scanResults,
  scan: { scanning: false, root: `${ROOT}/notes`, results: [], unreadable: [], error: null },
};

/** A scan that failed as a whole. */
export const failedScan: RepositoriesSlice = {
  ...scanResults,
  scan: {
    scanning: false,
    root: `${ROOT}/missing`,
    results: [],
    unreadable: [],
    error: 'The folder “missing” could not be opened.',
  },
};

/** `count` discovered repositories, for paging tests. */
export function manyScanResults(count: number): RepositoriesSlice {
  return {
    ...scanResults,
    scan: {
      ...scanResults.scan,
      results: Array.from({ length: count }, (_, index) => ({
        path: `${ROOT}/client-${String(index + 1).padStart(3, '0')}`,
        branch: 'main',
        alreadyAdded: false,
      })),
      unreadable: [],
    },
  };
}
