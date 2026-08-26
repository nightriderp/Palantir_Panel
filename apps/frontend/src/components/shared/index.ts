/**
 * Shared UI / Design-System (Arbeitspaket F2).
 *
 * Sammelpunkt für alle gemeinsam genutzten Komponenten. F3–F11 importieren
 * ausschließlich von hier:
 *
 *   import { ServerCard, useToast } from '@/components/shared';
 *
 * Beschreibung und Verwendung der einzelnen Bausteine: siehe README.md daneben.
 */

export { Icon, ICON_NAMES, ICON_PATHS, type IconName, type IconProps } from './icons/Icon';
export { LogoMark, type LogoMarkProps } from './icons/LogoMark';

export {
  Button,
  IconButton,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
  type IconButtonProps,
} from './primitives/Button';
export {
  Badge,
  CountBadge,
  StatusDot,
  TONE_DOT_CLASSES,
  TONE_PILL_CLASSES,
  TONE_TEXT_CLASSES,
  type BadgeProps,
  type CountBadgeProps,
  type StatusDotProps,
  type Tone,
} from './primitives/Badge';
export { MetricTile, Panel, type MetricTileProps, type PanelProps } from './primitives/Panel';
export { EmptyState, type EmptyStateProps } from './primitives/EmptyState';

export {
  ToastProvider,
  useToast,
  type Toast,
  type ToastApi,
  type ToastOptions,
  type ToastVariant,
} from './feedback/ToastProvider';

export {
  FieldShell,
  NumberField,
  SelectField,
  SliderField,
  TextField,
  Toggle,
  ToggleRow,
  type FieldLabelVariant,
  type FieldShellProps,
  type NumberFieldProps,
  type SelectFieldProps,
  type SliderFieldProps,
  type TextFieldProps,
  type ToggleProps,
  type ToggleRowProps,
} from './form/Fields';
export { FormMessage, type FormMessageProps, type FormMessageTone } from './form/FormMessage';

export { Modal, type ModalProps } from './overlays/Modal';
export { ConfirmDialog, type ConfirmDialogProps } from './overlays/ConfirmDialog';
export { DangerConfirmDialog, type DangerConfirmDialogProps } from './overlays/DangerConfirmDialog';
export { FormModal, type FormModalProps } from './overlays/FormModal';

export { ServerCard, type ServerCardProps } from './server/ServerCard';
export { ServerStatusPill, type ServerStatusPillProps } from './server/ServerStatusPill';
export { MetricRing, type MetricRingProps } from './server/MetricRing';
export {
  SERVER_STATUS_META,
  hasLiveStats,
  isLifecycleActionBlocked,
  serverStatusMeta,
  startStopAction,
  type ServerStatusMeta,
} from './server/serverStatus';

export { AppShell, type AppShellProps } from './layout/AppShell';
export { PageHeader, type PageHeaderProps } from './layout/PageHeader';
export { SideNavSection, type SideNavItem, type SideNavSectionProps } from './layout/SideNav';
export { Tabs, type TabItem, type TabsProps } from './layout/Tabs';
export {
  SegmentedControl,
  type SegmentItem,
  type SegmentedControlProps,
} from './layout/SegmentedControl';

export {
  PhaseLockedPlaceholder,
  type PhaseLockedPlaceholderProps,
  type ProjectPhase,
} from './placeholder/PhaseLockedPlaceholder';

export { cn } from './utils/cn';
export {
  clampPercent,
  formatDate,
  formatDateTime,
  formatMegabytes,
  formatNumber,
  formatPercent,
  formatPing,
  formatPlayers,
  formatServerAddress,
  formatTime,
  serverInitials,
} from './utils/format';
