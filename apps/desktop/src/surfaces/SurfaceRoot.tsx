import { lazy, Suspense } from 'react';
import type { Surface } from '../surface';
import { MainSurface } from './MainSurface';
import { MiniSurface } from './MiniSurface';
import { PanelSurface } from './PanelSurface';
import styles from './surfaces.module.css';

// `__GALLERY__` is replaced at build time (vite.config.ts `define`), so in production this is
// `false ? … : null` and the gallery chunk is never emitted. Keep the literal here, not an
// imported constant, so the bundler can fold it before splitting chunks.
const GallerySurface = __GALLERY__ ? lazy(() => import('../gallery/GallerySurface')) : null;

/** Picks the root component for the window this bundle is running in. */
export function SurfaceRoot({ surface }: { surface: Surface }) {
  switch (surface) {
    case 'panel':
      return <PanelSurface />;
    case 'mini':
      return <MiniSurface />;
    case 'gallery':
      return GallerySurface ? (
        <Suspense fallback={<p className={styles.loading}>Loading gallery…</p>}>
          <GallerySurface />
        </Suspense>
      ) : (
        <MainSurface />
      );
    case 'main':
      return <MainSurface />;
  }
}
