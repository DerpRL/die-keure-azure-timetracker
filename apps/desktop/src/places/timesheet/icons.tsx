/**
 * Decorative icons of the Timesheet (same rules as `components/icons`: always `aria-hidden`,
 * sized with the text). Kept here so the shared icon set stays untouched.
 */
import type { LucideIcon } from 'lucide-react';
import { CloudOff, Download, Lock } from 'lucide-react';
import type { IconComponent, IconProps } from '../../components/icons';

function decorative(Icon: LucideIcon, name: string): IconComponent {
  function DecorativeIcon({ size = '1em', strokeWidth = 2, ...props }: IconProps) {
    return <Icon aria-hidden="true" size={size} strokeWidth={strokeWidth} {...props} />;
  }
  DecorativeIcon.displayName = name;
  return DecorativeIcon;
}

export const LockIcon = decorative(Lock, 'LockIcon');
export const OfflineIcon = decorative(CloudOff, 'OfflineIcon');
export const ExportIcon = decorative(Download, 'ExportIcon');
