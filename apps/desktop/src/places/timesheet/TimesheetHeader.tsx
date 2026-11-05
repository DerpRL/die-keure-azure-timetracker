import type { ReactNode } from 'react';
import { IconButton } from '../../components/Button';
import { ChevronLeftIcon, ChevronRightIcon } from '../../components/icons';
import { SegmentedControl } from '../../components/Segmented';
import { useNavigation } from '../../layout/NavigationContext';
import { visibleViews, type TimesheetView } from '../../layout/navigation';
import { PlaceHeader } from '../../layout/Place';
import { useSlice } from '../../state/hooks';

/** Week / Day / List / Drafts · N: the Timesheet's views, as a segmented switch. */
export function ViewSwitch({ current }: { current: TimesheetView }) {
  const navigation = useNavigation();
  const offline = useSlice('offline');
  if (!navigation) return null;
  const views = visibleViews('timesheet', navigation.isPageVisible);
  if (views.length < 2) return null;
  const ready = offline?.readyCount ?? 0;
  return (
    <SegmentedControl<TimesheetView>
      label="View"
      hideLabel
      options={views.map((view) => ({
        id: view.id as TimesheetView,
        label: view.id === 'drafts' && ready > 0 ? `Drafts · ${ready}` : view.title,
      }))}
      selectedKey={current}
      onSelectionChange={(view) => navigation.navigate({ place: 'timesheet', view })}
    />
  );
}

export interface StepButtonsProps {
  /** "week", "day", "range": names the buttons ("Previous week"). */
  unit: string;
  onPrevious: () => void;
  onNext: () => void;
  isPreviousDisabled?: boolean;
  isNextDisabled?: boolean;
}

/** The previous / next buttons before a view's title. */
export function StepButtons({ unit, onPrevious, onNext, isPreviousDisabled, isNextDisabled }: StepButtonsProps) {
  return (
    <>
      <IconButton
        label={`Previous ${unit}`}
        icon={ChevronLeftIcon}
        variant="secondary"
        tooltip={false}
        isDisabled={isPreviousDisabled}
        onPress={onPrevious}
      />
      <IconButton
        label={`Next ${unit}`}
        icon={ChevronRightIcon}
        variant="secondary"
        tooltip={false}
        isDisabled={isNextDisabled}
        onPress={onNext}
      />
    </>
  );
}

export interface TimesheetHeaderProps {
  view: TimesheetView;
  title: ReactNode;
  subtitle?: ReactNode;
  before?: ReactNode;
  after?: ReactNode;
  /** The view's own controls, after the view switch. */
  controls?: ReactNode;
}

/** Every Timesheet view's first row: step buttons, title and totals; view switch and controls. */
export function TimesheetHeader({ view, title, subtitle, before, after, controls }: TimesheetHeaderProps) {
  return (
    <PlaceHeader
      title={title}
      subtitle={subtitle}
      before={before}
      after={after}
      actions={
        <>
          <ViewSwitch current={view} />
          {controls}
        </>
      }
    />
  );
}
