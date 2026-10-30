import { useState } from 'react';
import { MAX_LABEL_LENGTH } from '@tsds/shared';
import { cn } from '../lib/utils';

// Встроенный редактор метки: в Electron нет window.prompt, поэтому ввод живёт
// прямо в интерфейсе, а не в системном диалоге.
export function LabelForm({
  initial,
  onSubmit,
  onCancel,
  className,
}: {
  initial: string;
  onSubmit: (label: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [value, setValue] = useState(initial);

  return (
    <form
      className={cn('flex w-full flex-wrap items-center gap-1.5', className)}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value.trim());
      }}
    >
      <input
        className="input h-8 min-w-[110px] flex-1 px-2 py-0 text-xs"
        value={value}
        maxLength={MAX_LABEL_LENGTH}
        placeholder="Метка рядом с ником"
        aria-label="Метка участника"
        autoFocus
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" className="btn-ghost h-8 px-2 text-[11px]">
        Сохранить
      </button>
      {initial && (
        <button
          type="button"
          className="btn-ghost h-8 px-2 text-[11px] text-danger"
          onClick={() => onSubmit('')}
        >
          Убрать
        </button>
      )}
      <button type="button" className="btn-ghost h-8 px-2 text-[11px]" onClick={onCancel}>
        Отмена
      </button>
    </form>
  );
}
