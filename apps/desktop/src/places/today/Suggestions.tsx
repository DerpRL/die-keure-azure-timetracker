import { useId, useMemo, useState, type CSSProperties } from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Skeleton } from '../../components/EmptyState';
import { seriesColor } from '../../charts/palette';
import { PromptContext } from '../../features/prompts/PromptCard';
import { usePromptAnnouncements, usePromptItems, type PromptItem } from '../../features/prompts/PromptList';
import styles from './today.module.css';
import { t } from '../../i18n';

/** Collapsed suggestions shown before "Show all". */
const COLLAPSED_LIMIT = 3;

/** The swatch of a suggestion's source: branch, Figma, meeting or microphone, anything else. */
function kindColor(key: string): string {
  const kind = key.split(':')[0];
  if (kind === 'branch') return seriesColor(3);
  if (kind === 'figma') return seriesColor(0);
  if (kind === 'meeting' || kind === 'meetingReturn' || kind === 'microphone' || kind === 'microphoneEnd') return seriesColor(2);
  if (kind === 'attention') return 'var(--color-danger)';
  return seriesColor(7);
}

const COMPACT_MAIN = { surface: 'main' as const, headingLevel: 3 as const, compact: true };

/**
 * Suggestions as an inbox next to the timer (2.2 Today): the first (or chosen) one open with its
 * actions, the others as rows with Review. The day review prompt is left out: the Day check and
 * the review cards offer it on this view.
 */
export function Suggestions() {
  const all = usePromptItems('main');
  const items = useMemo(() => all?.filter((item) => !item.key.startsWith('dayReview:')), [all]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const headingId = useId();
  usePromptAnnouncements(items);

  if (!items) {
    return (
      <Card as="section" padding="none" aria-labelledby={headingId} className={styles.flush}>
        <div className={styles.flushHead}>
          <h2 id={headingId} className={styles.cardTitle}>
            {t('Suggestions')}
          </h2>
        </div>
        <div className={styles.flushBody} aria-busy="true">
          <Skeleton lines={2} />
        </div>
      </Card>
    );
  }

  const open: PromptItem | undefined = items.find((item) => item.key === chosen) ?? items[0];
  const rest = items.filter((item) => item !== open);
  const shown = showAll ? rest : rest.slice(0, COLLAPSED_LIMIT);

  return (
    <Card as="section" padding="none" aria-labelledby={headingId} className={styles.flush}>
      <div className={styles.flushHead}>
        <h2 id={headingId} className={styles.cardTitle}>
          {t('Suggestions')}
        </h2>
        {items.length > 0 ? <Badge tone="warning">{t('{count} waiting', { count: items.length })}</Badge> : null}
      </div>
      {open ? (
        <div className={styles.openSuggestion}>
          <PromptContext.Provider value={COMPACT_MAIN}>{open.element}</PromptContext.Provider>
        </div>
      ) : (
        <p className={styles.emptyLine}>{t('Nothing waiting. Branch, Figma and meeting suggestions appear here.')}</p>
      )}
      {shown.length > 0 ? (
        <ul role="list" aria-label={t('More suggestions')} className={styles.rows}>
          {shown.map((item) => (
            <li key={item.key} className={styles.suggestionRow}>
              <span className={styles.kindSwatch} style={{ '--kind-color': kindColor(item.key) } as CSSProperties} aria-hidden="true" />
              <span className={styles.ellipsis}>{item.label}</span>
              <Button size="small" aria-label={t('Review: {label}', { label: item.label })} onPress={() => setChosen(item.key)}>
                {t('Review')}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {rest.length > COLLAPSED_LIMIT ? (
        <div className={styles.rowsFoot}>
          <Button variant="plain" size="small" onPress={() => setShowAll((value) => !value)}>
            {showAll ? t('Show fewer') : t('Show all {count}', { count: items.length })}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
