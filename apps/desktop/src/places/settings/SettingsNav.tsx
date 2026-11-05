import { Badge } from '../../components/Badge';
import { ErrorIcon } from '../../components/icons';
import { usePageTitleId } from '../../layout/pageTitle';
import { isViewVisible, PLACES, SETTINGS_GROUPS, type PageVisibility, type SettingsView } from '../../layout/navigation';
import { cx } from '../../utils/cx';
import styles from './settings.module.css';

export interface SettingsNavProps {
  current: SettingsView;
  isPageVisible: PageVisibility;
  onSelect: (view: SettingsView) => void;
  /** Problems that block saving, per view: shown as a badge and in the item's name. */
  issueCounts?: Partial<Record<SettingsView, number>>;
}

/** The Settings menu (2.2 layout "Component · Settings menu"): Account, Tracking, Sources, App. */
export function SettingsNav({ current, isPageVisible, onSelect, issueCounts = {} }: SettingsNavProps) {
  const titleId = usePageTitleId();
  const views = PLACES.settings.views;
  return (
    <nav aria-labelledby={titleId} className={styles.nav}>
      <h1 id={titleId} className={styles.navTitle}>
        Settings
      </h1>
      {SETTINGS_GROUPS.map((group) => {
        const items = group.views
          .map((id) => views.find((view) => view.id === id)!)
          .filter((view) => isViewVisible(view, isPageVisible));
        if (items.length === 0) return null;
        const headingId = `settings-group-${group.id}`;
        return (
          <div key={group.id} className={styles.group}>
            <h2 id={headingId} className={styles.groupTitle}>
              {group.title}
            </h2>
            <ul role="list" aria-labelledby={headingId} className={styles.list}>
              {items.map((view) => {
                const selected = view.id === current;
                const count = issueCounts[view.id as SettingsView] ?? 0;
                return (
                  <li key={view.id}>
                    <button
                      type="button"
                      className={cx(styles.item, selected && styles.selected)}
                      aria-current={selected ? 'page' : undefined}
                      // "Targets & reminders, 1 problem": the visible label stays first (WCAG 2.5.3).
                      aria-label={count > 0 ? `${view.title}, ${count} ${count === 1 ? 'problem' : 'problems'}` : undefined}
                      onClick={() => onSelect(view.id as SettingsView)}
                    >
                      <span className={styles.itemLabel}>{view.title}</span>
                      {count > 0 ? (
                        <Badge tone="danger" icon={ErrorIcon}>
                          {count}
                        </Badge>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
