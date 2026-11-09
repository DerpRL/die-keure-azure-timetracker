import { t } from '../../i18n';
import { usePlaceView } from '../../layout/NavigationContext';
import { visibleViews, type InsightsView } from '../../layout/navigation';
import { PlaceBody, ViewTabs } from '../../layout/Place';
import { ExtrasProvider } from './Extras';
import { ReportView } from './ReportView';
import { StatisticsView } from './StatisticsView';

/**
 * Insights: understand and report (2.2 layout). One period header for "Where time went" and
 * "Patterns" (statistics), the weekly report next to the charts and as its own view.
 */
export default function InsightsPlace() {
  const { view, navigation } = usePlaceView<InsightsView>('insights');
  const views = visibleViews('insights', navigation.isPageVisible);
  const tabs =
    views.length > 1 ? (
      <ViewTabs
        label={t('Insights views')}
        tabs={views.map((entry) => ({ id: entry.id as InsightsView, title: t(entry.title) }))}
        current={view}
        onSelect={(next) => navigation.navigate({ place: 'insights', view: next })}
      />
    ) : null;
  const timesheetList = { place: 'timesheet', view: 'list' } as const;
  return (
    <PlaceBody>
      <ExtrasProvider>
        {view === 'report' ? (
          <ReportView tabs={tabs} />
        ) : (
          <StatisticsView
            view={view}
            tabs={tabs}
            reportAside={navigation.isPageVisible('weeklyReport')}
            onShowTime={() => navigation.navigate({ place: 'insights', view: 'time' })}
            onSeeEntries={navigation.canNavigate(timesheetList) ? () => navigation.navigate(timesheetList) : undefined}
          />
        )}
      </ExtrasProvider>
    </PlaceBody>
  );
}
