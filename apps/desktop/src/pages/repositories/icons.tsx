/**
 * Page-specific glyphs, decorative like the shared set in `components/icons`: `aria-hidden` is
 * always set and meaning comes from the text next to them.
 */
import { Folder, FolderPlus, GitBranch, type LucideIcon } from 'lucide-react';
import type { IconComponent, IconProps } from '../../components/icons';

function decorative(Icon: LucideIcon, name: string): IconComponent {
  function DecorativeIcon({ size = '1em', strokeWidth = 2, ...props }: IconProps) {
    return <Icon aria-hidden="true" size={size} strokeWidth={strokeWidth} {...props} />;
  }
  DecorativeIcon.displayName = name;
  return DecorativeIcon;
}

export const BranchIcon = decorative(GitBranch, 'BranchIcon');
export const FolderIcon = decorative(Folder, 'FolderIcon');
export const FolderPlusIcon = decorative(FolderPlus, 'FolderPlusIcon');
