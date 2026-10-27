import { avatarHue, cn, initials } from '../lib/utils';

const sizes = {
  xs: 'h-6 w-6 text-[9px]',
  sm: 'h-8 w-8 text-[11px]',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
  xl: 'h-20 w-20 text-2xl',
};

export function Avatar({
  id,
  name,
  size = 'md',
  speaking = false,
  className,
}: {
  id: string;
  name: string;
  size?: keyof typeof sizes;
  speaking?: boolean;
  className?: string;
}) {
  const hue = avatarHue(id);
  return (
    <div
      className={cn(
        'relative flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white shadow-inner',
        sizes[size],
        speaking && 'ring-2 ring-ok ring-offset-2 ring-offset-panel2',
        className,
      )}
      style={{
        background: `linear-gradient(140deg, hsl(${hue} 60% 46%), hsl(${(hue + 40) % 360} 60% 32%))`,
      }}
      title={name}
    >
      {initials(name)}
    </div>
  );
}
