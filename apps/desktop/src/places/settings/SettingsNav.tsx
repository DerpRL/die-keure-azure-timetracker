import { useState } from 'react';
import { Badge, StatusDot } from '../../components/Badge';
import { SearchField } from '../../components/Fields';
import { ErrorIcon } from '../../components/icons';
import { searchSections, VIEW_INTROS, type SettingsSectionDefinition, type SettingsSectionId } from '../../features/settings/sections';
import { usePageTitleId } from '../../layout/pageTitle';
import { isViewVisible, PLACES, SETTINGS_GROUPS, type PageVisibility, type SettingsView } from '../../layout/navigation';
import { useSlice } from '../../state/hooks';
import { cx } from '../../utils/cx';
import styles from './settings.module.css';

export interface SettingsNavProps {
  current: SettingsView;
  isPageVisible: PageVisibility;
  onSelect: (view: SettingsView) => void;
  /** Problems that block saving, per view: shown as a badge and in the item's name. */
  issueCounts?: Partial<Record<SettingsView, number>>;
  /** The sections search can find (those shown on this system); search is hidden without them. */
  sections?: readonly SettingsSectionDefinition[];
  /** Shows a section that search found and moves focus to it. */
  onFind?: (section: SettingsSectionId) => void;
}

function SearchResults({ query, sections, onFind }: { query: string; sections: readonly SettingsSectionDefinition[]; onFind: (section: SettingsSectionId) => void }) {
  const results = searchSections(query, sections);
  return (
    <div className={styles.group}>
      <p role="status" className={styles.groupTitle}>
        {results.length === 0 ? 'No settings match' : `${results.length} ${results.length === 1 ? 'result' : 'results'}`}
      </p>
      {results.length > 0 ? (
        <ul role="list" aria-label="Search results" className={styles.list}>
          {results.map((section) => (
            <li key={section.id}>
              <button type="button" className={cx(styles.item, styles.result)} onClick={() => onFind(section.id)}>
                <span className={styles.itemLabel}>{section.title}</span>
                <span className={styles.resultView}>{VIEW_INTROS[section.view].title}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The Settings menu (design "Component · Settings menu"): search, then Account, Tracking, Sources and App. */
export function SettingsNav({ current, isPageVisible, onSelect, issueCounts = {}, sections, onFind }: SettingsNavProps) {
  const titleId = usePageTitleId();
  const views = PLACES.settings.views;
  const connection = useSlice('connection');
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '' && sections !== undefined && onFind !== undefined;
  const find = (section: SettingsSectionId) => {
    setQuery('');
    onFind?.(section);
  };
  return (
    <nav aria-labelledby={titleId} className={styles.nav}>
      <h1 id={titleId} className={styles.navTitle}>
        Settings
      </h1>
      {sections && onFind ? (
        <SearchField
          label="Search settings"
          hideLabel
          placeholder="Search settings"
          value={query}
          onChange={setQuery}
          onSubmit={() => {
            const first = searchSections(query, sections)[0];
            if (first) find(first.id);
          }}
        />
      ) : null}
      {searching ? (
        <SearchResults query={query} sections={sections} onFind={find} />
      ) : (
        SETTINGS_GROUPS.map((group) => {
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
                        // "Reminders, 1 problem" or "…, connected": the visible label stays first (WCAG 2.5.3).
                        aria-label={
                          count > 0
                            ? `${view.title}, ${count} ${count === 1 ? 'problem' : 'problems'}`
                            : view.id === 'accounts' && connection?.connected
                              ? `${view.title}, connected`
                              : undefined
                        }
                        onClick={() => onSelect(view.id as SettingsView)}
                      >
                        <span className={styles.itemLabel}>{view.title}</span>
                        {count > 0 ? (
                          <Badge tone="danger" icon={ErrorIcon}>
                            {count}
                          </Badge>
                        ) : view.id === 'accounts' && connection?.connected ? (
                          <span aria-hidden="true">
                            <StatusDot tone="success" label="connected" />
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })
      )}
    </nav>
  );
}
