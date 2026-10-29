import { useEffect, useState } from 'react';
import { ExternalLink, Play, X } from 'lucide-react';
import { isImageUrl, splitChatText, youtubeVideoId } from '../lib/chatMedia';

export function ChatText({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-slate-300">
      {splitChatText(text).map((token, index) => {
        if (token.type === 'text') return <span key={index}>{token.text}</span>;
        const videoId = youtubeVideoId(token.href);
        if (videoId) return <YouTubePreview key={index} href={token.href} videoId={videoId} />;
        if (isImageUrl(token.href)) return <ImagePreview key={index} href={token.href} label={token.text} />;
        return <LinkText key={index} href={token.href} label={token.text} />;
      })}
    </div>
  );
}

function LinkText({ href, label, className }: { href: string; label: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={
        className ??
        'text-accent underline decoration-accent/40 underline-offset-2 transition hover:decoration-accent'
      }
    >
      {label}
    </a>
  );
}

function ImagePreview({ href, label }: { href: string; label: string }) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  if (failed) return <LinkText href={href} label={label} />;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Открыть в полный размер"
        aria-label="Открыть изображение в полный размер"
        className="mt-1.5 block max-w-full cursor-zoom-in overflow-hidden rounded-lg border border-line bg-panel2 transition hover:border-accent/50"
      >
        <img
          src={href}
          alt={label}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="max-h-80 max-w-full object-contain"
        />
      </button>
      {open && <ImageLightbox src={href} label={label} onClose={() => setOpen(false)} />}
    </>
  );
}

function ImageLightbox({ src, label, onClose }: { src: string; label: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-black/95"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
    >
      <div className="flex h-12 shrink-0 items-center gap-3 px-4" onClick={(event) => event.stopPropagation()}>
        <span className="min-w-0 flex-1 truncate text-xs text-slate-300" title={label}>
          {label}
        </span>
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="icon-btn h-8 w-8"
          title="Открыть в браузере"
          onClick={(event) => event.stopPropagation()}
        >
          <ExternalLink className="h-4 w-4" />
        </a>
        <button type="button" className="icon-btn h-8 w-8" onClick={onClose} title="Закрыть (Esc)">
          <X className="h-4 w-4" />
        </button>
      </div>
      <img
        src={src}
        alt={label}
        referrerPolicy="no-referrer"
        className="min-h-0 flex-1 object-contain px-4 pb-4"
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}

function YouTubePreview({ href, videoId }: { href: string; videoId: string }) {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <span className="mt-1.5 block aspect-video w-full max-w-[480px] overflow-hidden rounded-lg border border-line bg-black">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
          title="Видео YouTube"
          // Сервер отдаёт Referrer-Policy: no-referrer, а YouTube без Referer показывает ошибку 153.
          referrerPolicy="origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          className="h-full w-full border-0"
        />
      </span>
    );
  }

  return (
    <span className="mt-1.5 block max-w-[480px]">
      <button
        type="button"
        onClick={() => setPlaying(true)}
        title="Смотреть видео"
        aria-label="Смотреть видео на YouTube"
        className="group relative block w-full overflow-hidden rounded-lg border border-line bg-black"
      >
        <img
          src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
          alt="Превью видео YouTube"
          loading="lazy"
          referrerPolicy="no-referrer"
          className="aspect-video w-full object-cover opacity-90 transition group-hover:opacity-100"
        />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-11 w-[64px] items-center justify-center rounded-xl bg-[#ff0033] text-white shadow-lg transition group-hover:scale-105">
            <Play className="ml-0.5 h-5 w-5 fill-current" />
          </span>
        </span>
      </button>
      <span className="mt-1 block">
        <LinkText href={href} label="Открыть на YouTube" className="inline-flex items-center gap-1 text-[11px] text-muted transition hover:text-accent" />
      </span>
    </span>
  );
}
