import {
  faGauge,
  faFolderOpen,
  faBookOpen,
  faTerminal,
  faBook,
  faUsers,
  type IconDefinition,
} from '@fortawesome/free-solid-svg-icons';

export interface NavItem {
  /** Route to link to. */
  href: string;
  /** Full label (sidebar). */
  label: string;
  /** Short label (mobile bottom bar). */
  short: string;
  /** FontAwesome icon (nearest equivalent of the design's Material Symbol). */
  icon: IconDefinition;
  /** Whether the current path activates this item. */
  isActive: (pathname: string) => boolean;
}

/**
 * Single source of truth for the primary navigation, shared by the desktop
 * sidebar and the mobile bottom tab bar. The design used Material Symbols; we
 * keep FontAwesome and map to the nearest equivalents.
 */
export const navItems: NavItem[] = [
  {
    href: '/home',
    label: 'Dashboard',
    short: 'Dashboard',
    icon: faGauge,
    isActive: (p) => p === '/' || p.startsWith('/home'),
  },
  {
    href: '/file-manager',
    label: 'File Manager',
    short: 'Files',
    icon: faFolderOpen,
    isActive: (p) => p.startsWith('/file-manager'),
  },
  {
    href: '/cheatsheets',
    label: 'Cheatsheets',
    short: 'Cheats',
    icon: faBookOpen,
    isActive: (p) => p.startsWith('/cheatsheets'),
  },
  {
    href: '/logs',
    label: 'Logs',
    short: 'Logs',
    icon: faTerminal,
    isActive: (p) => p.startsWith('/logs'),
  },
  {
    href: '/documentation/file-structure',
    label: 'Documentation',
    short: 'Docs',
    icon: faBook,
    isActive: (p) => p.startsWith('/documentation'),
  },
  {
    href: '/users',
    label: 'Users',
    short: 'Users',
    icon: faUsers,
    isActive: (p) => p.startsWith('/users'),
  },
];
