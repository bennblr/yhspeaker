import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { Modal } from './Modal';
import { toast } from '../lib/actions';

export interface GuestCredentials {
  username: string;
  password: string;
}

let pending: GuestCredentials | null = null;
let notify: (() => void) | null = null;

// Показ выданных гостю данных доступа без window.prompt: в Electron он не работает.
export function showCredentials(credentials: GuestCredentials): void {
  pending = credentials;
  notify?.();
}

function CredentialRow({ label, value }: { label: string; value: string }) {
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      toast('ok', 'Скопировано в буфер обмена');
    } catch {
      toast('error', 'Не удалось скопировать');
    }
  }

  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
        {label}
      </div>
      <div className="flex items-center gap-1.5">
        <code className="min-w-0 flex-1 select-all truncate rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs text-slate-100">
          {value}
        </code>
        <button
          type="button"
          className="icon-btn h-8 w-8"
          onClick={() => void copy()}
          aria-label={`Скопировать: ${label.toLowerCase()}`}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function CredentialsDialog() {
  const [value, setValue] = useState<GuestCredentials | null>(null);

  useEffect(() => {
    notify = () => setValue(pending);
    return () => {
      notify = null;
    };
  }, []);

  return (
    <Modal
      open={Boolean(value)}
      onClose={() => {
        pending = null;
        setValue(null);
      }}
      title="Гость стал пользователем"
      subtitle="Логин и пароль выданы один раз — сохраните их"
      width="max-w-sm"
    >
      {value && (
        <div className="space-y-3">
          <CredentialRow label="Логин" value={value.username} />
          <CredentialRow label="Пароль" value={value.password} />
        </div>
      )}
    </Modal>
  );
}
