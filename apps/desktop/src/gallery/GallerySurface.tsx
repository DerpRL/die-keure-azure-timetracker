import { SegmentedControl } from '../components/Segmented';
import { Switch } from '../components/Toggles';
import { setPlatformOverride, usePlatform } from '../shortcuts/platform';
import { AppearanceControls } from '../theme/AppearanceControls';
import { useTheme } from '../theme/ThemeProvider';
import { ChartsSection } from './sections/ChartsSection';
import { ControlsSection } from './sections/ControlsSection';
import { DataSection } from './sections/DataSection';
import { FoundationsSection } from './sections/FoundationsSection';
import { OverlaysSection } from './sections/OverlaysSection';
import { SurfacesSection } from './sections/SurfacesSection';
import { TimerSection } from './sections/TimerSection';
import styles from './Gallery.module.css';

const SECTIONS = [
  { id: 'foundations', title: 'Foundations' },
  { id: 'buttons', title: 'Buttons' },
  { id: 'status', title: 'Status and banners' },
  { id: 'forms', title: 'Form controls' },
  { id: 'feedback', title: 'Progress and states' },
  { id: 'overlays', title: 'Overlays' },
  { id: 'table', title: 'Table' },
  { id: 'timer', title: 'Timer' },
  { id: 'charts', title: 'Charts' },
  { id: 'surfaces', title: 'Surfaces' },
];

/**
 * Dev-only component gallery (`?surface=gallery`): every primitive, chart and shell with sample
 * data, switchable between themes, contrast, scale, motion and shortcut platform.
 */
export default function GallerySurface() {
  const { reducedMotionOverride, setReducedMotionOverride, system } = useTheme();
  const platform = usePlatform();
  return (
    <div className={styles.gallery}>
      <header className={styles.header}>
        <div className={styles.headerTitles}>
          <h1 className={styles.title}>Azure timetracker · component gallery</h1>
          <p className={styles.subtitle}>Development build only. Production bundles do not contain this surface.</p>
        </div>
        <div className={styles.controls} role="group" aria-label="Preview settings">
          <AppearanceControls layout="inline" size="small" />
          <SegmentedControl
            label="Shortcut keys"
            size="small"
            selectedKey={platform === 'windows' ? 'windows' : 'macos'}
            onSelectionChange={(value) => setPlatformOverride(value)}
            options={[
              { id: 'macos', label: 'macOS' },
              { id: 'windows', label: 'Windows' },
            ]}
          />
          <Switch
            isSelected={reducedMotionOverride ?? system.reducedMotion}
            onChange={(value) => setReducedMotionOverride(value)}
          >
            Reduce motion
          </Switch>
        </div>
      </header>
      <div className={styles.layout}>
        <nav aria-label="Gallery sections" className={styles.nav}>
          <ul role="list">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title}</a>
              </li>
            ))}
          </ul>
        </nav>
        <main className={styles.main} aria-label="Gallery">
          <FoundationsSection />
          <ControlsSection />
          <OverlaysSection />
          <DataSection />
          <TimerSection />
          <ChartsSection />
          <SurfacesSection />
        </main>
      </div>
    </div>
  );
}
