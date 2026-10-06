/**
 * Extra decorative icons for the tracking flow and prompts (same rules as `components/icons`:
 * always `aria-hidden`, sized with the text). Kept here so the shared icon set stays untouched.
 */
import type { LucideIcon } from 'lucide-react';
import {
  ArrowUpRight,
  CalendarClock,
  ClockAlert,
  GitBranch,
  Link,
  Mic,
  MicOff,
  Moon,
  PanelTop,
  ShieldCheck,
  Star,
  Timer,
  Undo2,
} from 'lucide-react';
import type { IconComponent, IconProps } from '../../components/icons';

function decorative(Icon: LucideIcon, name: string): IconComponent {
  function DecorativeIcon({ size = '1em', strokeWidth = 2, ...props }: IconProps) {
    return <Icon aria-hidden="true" size={size} strokeWidth={strokeWidth} {...props} />;
  }
  DecorativeIcon.displayName = name;
  return DecorativeIcon;
}

export const BranchIcon = decorative(GitBranch, 'BranchIcon');
export const MeetingIcon = decorative(CalendarClock, 'MeetingIcon');
export const MicrophoneIcon = decorative(Mic, 'MicrophoneIcon');
export const MicrophoneOffIcon = decorative(MicOff, 'MicrophoneOffIcon');
export const ReturnIcon = decorative(Undo2, 'ReturnIcon');
export const IdleIcon = decorative(Moon, 'IdleIcon');
export const CorrectionIcon = decorative(ClockAlert, 'CorrectionIcon');
export const ForgottenIcon = decorative(Timer, 'ForgottenIcon');
export const StarIcon = decorative(Star, 'StarIcon');
export const OpenExternalIcon = decorative(ArrowUpRight, 'OpenExternalIcon');
export const PrivacyIcon = decorative(ShieldCheck, 'PrivacyIcon');
export const SetupIcon = decorative(Link, 'SetupIcon');
export const OpenPanelIcon = decorative(PanelTop, 'OpenPanelIcon');
