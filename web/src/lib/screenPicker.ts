import { useSyncExternalStore } from 'react';

let open = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openScreenSharePicker(): void {
  if (open) return;
  open = true;
  emit();
}

export function closeScreenSharePicker(): void {
  if (!open) return;
  open = false;
  emit();
}

export function useScreenSharePickerOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => false);
}
