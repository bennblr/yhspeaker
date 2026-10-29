import { Monitor, Smartphone, Tablet } from 'lucide-react';
import type { DeviceKind } from '@tsds/shared';
import { cn } from '../lib/utils';

const ICONS: Record<DeviceKind, typeof Monitor> = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
};

export function DeviceBadge({
  device,
  deviceName,
  compact = false,
  className,
}: {
  device: DeviceKind;
  deviceName: string;
  compact?: boolean;
  className?: string;
}) {
  const Icon = ICONS[device] ?? Monitor;
  if (compact) {
    return (
      <span title={deviceName} className={cn('shrink-0 text-muted/80', className)}>
        <Icon className="h-3 w-3" />
      </span>
    );
  }
  return (
    <span
      title={deviceName}
      className={cn(
        'flex min-w-0 shrink items-center gap-0.5 rounded bg-white/[0.04] px-1 py-0.5 text-[9px] text-muted',
        className,
      )}
    >
      <Icon className="h-2.5 w-2.5 shrink-0" />
      <span className="max-w-[84px] truncate">{deviceName}</span>
    </span>
  );
}
