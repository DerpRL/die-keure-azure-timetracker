/**
 * Settings glyphs, decorative like the shared set in `components/icons`: `aria-hidden` is always
 * set and meaning comes from the text next to them.
 */
import { Calendar, GitBranch, Layers, Lock, type LucideIcon } from 'lucide-react';
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
