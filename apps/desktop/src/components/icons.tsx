/**
 * The single icon set (lucide-react). Every icon is decorative: `aria-hidden` is always set and
 * the props type does not accept a label, so meaning must come from visible or accessible text.
 * Icons size with the surrounding text (1em) and therefore follow the UI scale.
 */
import type { LucideIcon, LucideProps } from 'lucide-react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  CalendarRange,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CirclePause,
  CirclePlay,
  CircleStop,
  Clock,
  Command,
  Ellipsis,
  ExternalLink,
  FileText,
  History,
  HardDrive,
  Info,
  Inbox,
  Keyboard,
  Layers,
  LayoutGrid,
  ListChecks,
  ListFilter,
  LoaderCircle,
  Minus,
  Network,
  OctagonAlert,
  Pause,
  Play,
  Plus,
  Power,
  RefreshCw,
  Search,
  Settings,
  Square,
  SquarePen,
  Table2,
  TriangleAlert,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export type IconProps = Omit<LucideProps, 'aria-label' | 'aria-labelledby' | 'aria-hidden' | 'role' | 'ref'>;
export type IconComponent = ((props: IconProps) => React.JSX.Element) & { displayName?: string };

function decorative(Icon: LucideIcon, name: string): IconComponent {
  function DecorativeIcon({ size = '1em', strokeWidth = 2, ...props }: IconProps) {
    return <Icon aria-hidden="true" size={size} strokeWidth={strokeWidth} {...props} />;
  }
  DecorativeIcon.displayName = name;
  return DecorativeIcon;
}

// Navigation (SF Symbols from the Swift app → closest lucide glyph).
export const OverviewIcon = decorative(LayoutGrid, 'OverviewIcon');
export const DayReviewIcon = decorative(ListChecks, 'DayReviewIcon');
export const AgendaIcon = decorative(Calendar, 'AgendaIcon');
export const OfflineDraftsIcon = decorative(HardDrive, 'OfflineDraftsIcon');
export const StatisticsIcon = decorative(ChartColumn, 'StatisticsIcon');
export const WeeklyReportIcon = decorative(FileText, 'WeeklyReportIcon');
export const HistoryIcon = decorative(History, 'HistoryIcon');
export const TimeEditorIcon = decorative(SquarePen, 'TimeEditorIcon');
export const RepositoriesIcon = decorative(Network, 'RepositoriesIcon');
export const FigmaIcon = decorative(Layers, 'FigmaIcon');
export const SettingsIcon = decorative(Settings, 'SettingsIcon');

// Tracking status vocabulary (README "Meeting suggestions and tracking status").
export const RunningIcon = decorative(CirclePlay, 'RunningIcon');
export const PausedIcon = decorative(CirclePause, 'PausedIcon');
export const StoppedIcon = decorative(CircleStop, 'StoppedIcon');
export const DisconnectedIcon = decorative(TriangleAlert, 'DisconnectedIcon');
export const ConnectingIcon = decorative(RefreshCw, 'ConnectingIcon');
export const AttentionIcon = decorative(CircleHelp, 'AttentionIcon');

// General purpose.
export const ArrowDownIcon = decorative(ArrowDown, 'ArrowDownIcon');
export const ArrowLeftIcon = decorative(ArrowLeft, 'ArrowLeftIcon');
export const ArrowRightIcon = decorative(ArrowRight, 'ArrowRightIcon');
export const ArrowUpIcon = decorative(ArrowUp, 'ArrowUpIcon');
export const SortIcon = decorative(ArrowUpDown, 'SortIcon');
export const CalendarIcon = decorative(Calendar, 'CalendarIcon');
export const CalendarRangeIcon = decorative(CalendarRange, 'CalendarRangeIcon');
export const CheckIcon = decorative(Check, 'CheckIcon');
export const ChevronDownIcon = decorative(ChevronDown, 'ChevronDownIcon');
export const ChevronLeftIcon = decorative(ChevronLeft, 'ChevronLeftIcon');
export const ChevronRightIcon = decorative(ChevronRight, 'ChevronRightIcon');
export const ChevronUpIcon = decorative(ChevronUp, 'ChevronUpIcon');
export const CircleIcon = decorative(Circle, 'CircleIcon');
export const ClockIcon = decorative(Clock, 'ClockIcon');
export const CloseIcon = decorative(X, 'CloseIcon');
export const CommandIcon = decorative(Command, 'CommandIcon');
export const ErrorIcon = decorative(OctagonAlert, 'ErrorIcon');
export const ExternalLinkIcon = decorative(ExternalLink, 'ExternalLinkIcon');
export const FilterIcon = decorative(ListFilter, 'FilterIcon');
export const InboxIcon = decorative(Inbox, 'InboxIcon');
export const InfoIcon = decorative(Info, 'InfoIcon');
export const KeyboardIcon = decorative(Keyboard, 'KeyboardIcon');
export const MinusIcon = decorative(Minus, 'MinusIcon');
export const MoreIcon = decorative(Ellipsis, 'MoreIcon');
export const NoticeIcon = decorative(CircleAlert, 'NoticeIcon');
export const PauseIcon = decorative(Pause, 'PauseIcon');
export const PlayIcon = decorative(Play, 'PlayIcon');
export const PlusIcon = decorative(Plus, 'PlusIcon');
export const PowerIcon = decorative(Power, 'PowerIcon');
export const RefreshIcon = decorative(RefreshCw, 'RefreshIcon');
export const SearchIcon = decorative(Search, 'SearchIcon');
export const SpinnerIcon = decorative(LoaderCircle, 'SpinnerIcon');
export const StopIcon = decorative(Square, 'StopIcon');
export const SuccessIcon = decorative(CircleCheck, 'SuccessIcon');
export const TableIcon = decorative(Table2, 'TableIcon');
export const WarningIcon = decorative(TriangleAlert, 'WarningIcon');
export const ZoomInIcon = decorative(ZoomIn, 'ZoomInIcon');
export const ZoomOutIcon = decorative(ZoomOut, 'ZoomOutIcon');
