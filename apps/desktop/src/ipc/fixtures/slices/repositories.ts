import type { SliceMap } from '../../contract';

export default {
  repositories: {
    watching: true,
    repositories: [
      {
        id: '0f9a3c2e-5b7d-4e1a-8c6f-2d4b6a8c0e12',
        path: '/Users/sam/Documents/repositories/webshop',
        name: 'webshop',
        enabled: true,
        branch: 'feature/AB#4790-vat-number',
        detached: false,
        error: null,
      },
      {
        id: '7c1e9b3a-2d4f-4a6b-9c8e-1f3a5b7d9e24',
        path: '/Users/sam/Documents/repositories/design-system',
        name: 'design-system',
        enabled: true,
        branch: 'main',
        detached: false,
        error: null,
      },
    ],
    scan: { scanning: false, root: null, results: [], unreadable: [], error: null },
  },
} satisfies Partial<SliceMap>;
