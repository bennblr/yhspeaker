import {
  HeadphoneOff,
  Headphones,
  LogOut,
  Mic,
  MicOff,
  Power,
  Settings,
  Shield,
  ShieldCheck,
} from 'lucide-react';
import { Avatar } from './Avatar';
import { LabelBadge } from './LabelBadge';
import { isSelfMicMuted, useApp } from '../lib/store';
import { cn } from '../lib/utils';
import { primaryRole, roleLabel, useIsStaff } from '../lib/roles';
import { logout, toggleDeafen, toggleMute, toggleMic } from '../lib/actions';

function TipButton({
  label,
  active,
  danger,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'icon-btn relative',
          active && 'icon-btn-active',
          danger && 'text-danger hover:text-danger',
          disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
        )}
        aria-label={label}
      >
        {children}
      </button>
      <span className="tooltip">{label}</span>
    </div>
  );
}

export function UserBar({
  onOpenSettings,
  onOpenAdmin,
}: {
  onOpenSettings: () => void;
  onOpenAdmin: () => void;
}) {
  const me = useApp((state) => state.me);
  const roles = useApp((state) => state.roles);
  const voice = useApp((state) => state.voice);
  const settings = useApp((state) => state.settings);
  const micMuted = useApp((state) => isSelfMicMuted(state));
  const connection = useApp((state) => state.connection);
  const isStaff = useIsStaff();

  if (!me) return null;

  const inVoice = Boolean(voice.channelId);
  const primary = primaryRole(me, roles);
  const roleText = roleLabel(me, roles);

  return (
    <div className="flex items-center gap-2 border-t border-line bg-[#0d1017] px-2.5 py-2.5">
      <div className="relative shrink-0">
        <Avatar id={me.id} name={me.displayName} size="sm" speaking={voice.pttActive} />
        <span
          className={cn(
            'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0d1017]',
            connection === 'online' ? 'bg-ok' : connection === 'connecting' ? 'bg-warn' : 'bg-danger',
          )}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className="truncate text-[13px] font-semibold text-slate-100"
            style={primary ? { color: primary.color } : undefined}
          >
            {me.displayName}
          </span>
          <LabelBadge label={me.label} />
          {me.role === 'admin' && <Shield className="h-3 w-3 shrink-0 text-accent" />}
          {me.role === 'moderator' && (
            <ShieldCheck className="h-3 w-3 shrink-0 text-ok" />
          )}
        </div>
        <div className="flex items-center gap-1.5 truncate text-[10px] uppercase tracking-wider text-muted">
          {primary && me.role === 'member' && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: primary.color }}
            />
          )}
          {me.serverMuted ? 'микрофон отключён админом' : roleText}
        </div>
      </div>

      <div className="flex items-center gap-0.5">
        <TipButton
          label={
            inVoice
              ? micMuted
                ? 'Включить микрофон'
                : 'Выключить микрофон'
              : micMuted
                ? 'Микрофон выключен'
                : 'Микрофон включён'
          }
          active={inVoice && !micMuted}
          danger={micMuted}
          onClick={() => (inVoice ? void toggleMic() : toggleMute())}
        >
          {micMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </TipButton>

        <TipButton
          label={voice.deafened ? 'Включить звук' : 'Выключить звук'}
          active={!voice.deafened}
          danger={voice.deafened}
          onClick={toggleDeafen}
        >
          {voice.deafened ? (
            <HeadphoneOff className="h-4 w-4" />
          ) : (
            <Headphones className="h-4 w-4" />
          )}
        </TipButton>

        {isStaff && (
          <TipButton label="Управление сервером" onClick={onOpenAdmin}>
            <Shield className="h-4 w-4" />
          </TipButton>
        )}

        <TipButton label="Настройки" onClick={onOpenSettings}>
          <Settings className="h-4 w-4" />
        </TipButton>

        <TipButton label="Выйти" onClick={logout}>
          <Power className="h-4 w-4" />
        </TipButton>
      </div>
    </div>
  );
}
