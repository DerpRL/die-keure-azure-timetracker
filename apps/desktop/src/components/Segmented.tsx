import { useId, type ReactNode } from 'react';
import {
  Tab as AriaTab,
  TabList as AriaTabList,
  TabPanel as AriaTabPanel,
  Tabs as AriaTabs,
  ToggleButton,
  ToggleButtonGroup,
  type Key,
  type TabListProps,
  type TabPanelProps,
  type TabProps,
  type TabsProps as AriaTabsProps,
} from 'react-aria-components';
import { cx } from '../utils/cx';
import type { IconComponent } from './icons';
import styles from './Segmented.module.css';

export interface SegmentedOption<K extends Key = Key> {
  id: K;
  label: string;
  icon?: IconComponent;
  isDisabled?: boolean;
}

export interface SegmentedControlProps<K extends Key = Key> {
  /** Group label. Visible above the control unless `hideLabel`. */
  label: string;
  hideLabel?: boolean;
  options: ReadonlyArray<SegmentedOption<K>>;
  selectedKey: K;
  onSelectionChange: (key: K) => void;
  size?: 'small' | 'medium';
  isDisabled?: boolean;
  className?: string;
}

/**
 * Exclusive choice between a few options (Appearance, UI scale, chart type). Exposed as a radio
 * group: arrow keys move between options and one option is always selected.
 */
export function SegmentedControl<K extends Key = Key>({
  label,
  hideLabel = false,
  options,
  selectedKey,
  onSelectionChange,
  size = 'medium',
  isDisabled,
  className,
}: SegmentedControlProps<K>) {
  const labelId = useId();
  return (
    <div className={cx(styles.segmentedField, className)}>
      <span id={labelId} className={hideLabel ? 'visually-hidden' : styles.groupLabel}>
        {label}
      </span>
      <ToggleButtonGroup
        aria-labelledby={labelId}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[selectedKey]}
        onSelectionChange={(keys) => {
          const [next] = [...keys];
          if (next !== undefined) onSelectionChange(next as K);
        }}
        isDisabled={isDisabled}
        className={cx(styles.segmented, styles[size])}
      >
        {options.map(({ id, label: optionLabel, icon: Icon, isDisabled: optionDisabled }) => (
          <ToggleButton key={String(id)} id={id} isDisabled={optionDisabled} className={styles.segment}>
            {Icon ? <Icon className={styles.segmentIcon} /> : null}
            <span>{optionLabel}</span>
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </div>
  );
}

export interface TabItem<K extends Key = Key> {
  id: K;
  title: string;
  content: ReactNode;
  isDisabled?: boolean;
}

export interface TabsProps<K extends Key = Key> extends Omit<AriaTabsProps, 'children' | 'className' | 'style'> {
  /** Accessible name of the tab list. */
  label: string;
  tabs: ReadonlyArray<TabItem<K>>;
  className?: string;
}

/** Data-driven tabs. For custom layouts use `TabList`, `Tab` and `TabPanel` inside `TabsRoot`. */
export function Tabs<K extends Key = Key>({ label, tabs, className, ...props }: TabsProps<K>) {
  return (
    <AriaTabs {...props} className={cx(styles.tabs, className)}>
      <TabList aria-label={label}>
        {tabs.map((tab) => (
          <Tab key={String(tab.id)} id={tab.id} isDisabled={tab.isDisabled}>
            {tab.title}
          </Tab>
        ))}
      </TabList>
      {tabs.map((tab) => (
        <TabPanel key={String(tab.id)} id={tab.id}>
          {tab.content}
        </TabPanel>
      ))}
    </AriaTabs>
  );
}

export function TabsRoot({ className, ...props }: AriaTabsProps) {
  return <AriaTabs {...props} className={cx(styles.tabs, typeof className === 'string' ? className : undefined)} />;
}

export function TabList<T extends object>({ className, ...props }: TabListProps<T>) {
  return <AriaTabList {...props} className={cx(styles.tabList, typeof className === 'string' ? className : undefined)} />;
}

export function Tab({ className, ...props }: TabProps) {
  return <AriaTab {...props} className={cx(styles.tab, typeof className === 'string' ? className : undefined)} />;
}

export function TabPanel({ className, ...props }: TabPanelProps) {
  return <AriaTabPanel {...props} className={cx(styles.tabPanel, typeof className === 'string' ? className : undefined)} />;
}
