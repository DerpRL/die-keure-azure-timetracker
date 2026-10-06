import { usePlatform } from '../../shortcuts/platform';
import { useTheme } from '../../theme/ThemeProvider';
import { GallerySection, Specimen } from '../GalleryLayout';
import styles from '../Gallery.module.css';

/**
 * The three real surfaces in iframes at their window sizes, with the gallery's current
 * appearance passed in the query (dev only). The panel stays 420 px wide at every scale.
 */
export function SurfacesSection() {
  const { preferences, resolved } = useTheme();
  const platform = usePlatform();
  const miniHeight = Math.round(72 * resolved.scale);
  const query = (surface: string) =>
    `?${new URLSearchParams({
      surface,
      theme: preferences.theme,
      contrast: preferences.contrast,
      scale: String(preferences.scale),
      motion: resolved.reducedMotion ? 'reduced' : 'full',
      platform,
    }).toString()}`;
  return (
    <GallerySection
      id="surfaces"
      title="Surfaces"
      description="AppShell, PanelShell and MiniTimerShell as the Tauri windows load them (main, panel, mini). Each frame reloads when the controls change."
    >
      <Specimen title="Main window · 1040 × 680" wide>
        <div className={styles.frameScroll}>
          <iframe title="Main window preview" src={query('main')} width={1040} height={680} className={styles.frame} />
        </div>
      </Specimen>
      <Specimen title="Tray panel · 420 × 640">
        <iframe title="Tray panel preview" src={query('panel')} width={420} height={640} className={styles.frame} />
      </Specimen>
      <Specimen title={`Mini timer · 280 × ${miniHeight}`}>
        <iframe title="Mini timer preview" src={query('mini')} width={280} height={miniHeight} className={styles.frame} />
        <p className="gallery-note">The mini window grows with the UI scale (72 px at 100 %); the Tauri shell sizes it.</p>
      </Specimen>
    </GallerySection>
  );
}
