import type { DeviceInfo } from '@tsds/shared';
import { desktop } from './desktop';

function systemName(): string {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'Windows';
  if (/iPhone|iPod/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'устройство';
}

function browserName(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Edge';
  if (/YaBrowser/.test(ua)) return 'Яндекс';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Браузер';
}

export function describeDevice(): DeviceInfo {
  const ua = navigator.userAgent;
  const tablet = /iPad|Tablet/i.test(ua);
  const mobile = !tablet && /Mobi|Android|iPhone|iPod/i.test(ua);
  const kind = tablet ? 'tablet' : mobile ? 'mobile' : 'desktop';
  if (desktop) return { kind: 'desktop', name: `Приложение · ${systemName()}` };
  return { kind, name: `${browserName()} · ${systemName()}` };
}
