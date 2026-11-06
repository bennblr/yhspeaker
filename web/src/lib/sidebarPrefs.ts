export type SidebarSection = 'dm' | 'voice' | 'text';

export interface SidebarPrefs {
  collapsed: Record<SidebarSection, boolean>;
  // Личный порядок каналов: серверный порядок остаётся общим, а здесь — только для аккаунта.
  order: string[];
}

const SECTIONS: SidebarSection[] = ['dm', 'voice', 'text'];

export function defaultSidebarPrefs(): SidebarPrefs {
  return {
    collapsed: { dm: false, voice: false, text: false },
    order: [],
  };
}

function storageKey(userId: string | undefined): string {
  return `la2speak.sidebar.${userId ?? 'anonymous'}`;
}

function isSection(value: string): value is SidebarSection {
  return (SECTIONS as string[]).includes(value);
}

export function loadSidebarPrefs(userId: string | undefined): SidebarPrefs {
  const prefs = defaultSidebarPrefs();
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(userId)) ?? 'null') as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return prefs;
    const source = raw as { collapsed?: unknown; order?: unknown };
    if (source.collapsed && typeof source.collapsed === 'object') {
      for (const [key, value] of Object.entries(source.collapsed as Record<string, unknown>)) {
        if (isSection(key) && typeof value === 'boolean') prefs.collapsed[key] = value;
      }
    }
    if (Array.isArray(source.order)) {
      prefs.order = [
        ...new Set(source.order.filter((id): id is string => typeof id === 'string' && Boolean(id))),
      ];
    }
  } catch {
    return defaultSidebarPrefs();
  }
  return prefs;
}

export function saveSidebarPrefs(userId: string | undefined, prefs: SidebarPrefs): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}
