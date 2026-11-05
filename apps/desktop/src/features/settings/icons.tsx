/**
 * Settings glyphs, decorative like the shared set in `components/icons`: `aria-hidden` is always
 * set and meaning comes from the text next to them.
 */
import {
  Bell,
  BookOpen,
  Bug,
  Calendar,
  Code,
  FolderOpen,
  GitBranch,
  KeyRound,
  Layers,
  Lock,
  Mic,
  RotateCcw,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import type { IconComponent, IconProps } from '../../components/icons';

function decorative(Icon: LucideIcon, name: string): IconComponent {
  function DecorativeIcon({ size = '1em', strokeWidth = 2, ...props }: IconProps) {
    return <Icon aria-hidden="true" size={size} strokeWidth={strokeWidth} {...props} />;
  }
  DecorativeIcon.displayName = name;
  return DecorativeIcon;
}

export const GitIcon = decorative(GitBranch, 'GitIcon');
export const FigmaSourceIcon = decorative(Layers, 'FigmaSourceIcon');
export const CalendarSourceIcon = decorative(Calendar, 'CalendarSourceIcon');
export const LockIcon = decorative(Lock, 'LockIcon');
export const KeyIcon = decorative(KeyRound, 'KeyIcon');
export const MicrophoneIcon = decorative(Mic, 'MicrophoneIcon');
export const ShieldIcon = decorative(ShieldCheck, 'ShieldIcon');
export const FolderIcon = decorative(FolderOpen, 'FolderIcon');
export const BellIcon = decorative(Bell, 'BellIcon');
export const NotesIcon = decorative(BookOpen, 'NotesIcon');
export const BugIcon = decorative(Bug, 'BugIcon');
export const CodeIcon = decorative(Code, 'CodeIcon');
export const RestartIcon = decorative(RotateCcw, 'RestartIcon');
