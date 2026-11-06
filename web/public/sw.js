const VERSION = 'la2speak-v3';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const SHELL_PATHS = ['/app', '/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // Приложение открывается с /app, а с корня может отдаваться лендинг.
      // Кэшируем оба адреса, чтобы установленное приложение стартовало и без сети.
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(
        SHELL_PATHS.map(async (path) => {
          try {
            const response = await fetch(path, { cache: 'no-store' });
            if (response.ok && /text\/html/i.test(response.headers.get('content-type') ?? '')) {
              await cache.put(path, response);
            }
          } catch {
            /* офлайн во время установки — кэш заполнится при первой навигации */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

function isAsset(pathname) {
  return (
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/icons/') ||
    pathname === '/icon.png'
  );
}

async function networkFirstNavigation(request) {
  const url = new URL(request.url);
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(url.pathname, response.clone());
    }
    return response;
  } catch {
    const cached =
      (await caches.match(url.pathname)) ||
      (await caches.match('/app')) ||
      (await caches.match('/'));
    if (cached) return cached;
    throw new Error('offline');
  }
}

async function cacheFirstAsset(request) {
  const cached = await caches.match(request);
  if (cached) {
    fetch(request)
      .then(async (response) => {
        if (!response.ok) return;
        const cache = await caches.open(ASSET_CACHE);
        await cache.put(request, response);
      })
      .catch(() => undefined);
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(ASSET_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io') ||
    url.pathname.startsWith('/download/')
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isAsset(url.pathname)) {
    event.respondWith(cacheFirstAsset(request));
  }
});

// ---------- уведомления о личных сообщениях ----------

function readPushPayload(event) {
  if (!event.data) return null;
  try {
    return event.data.json();
  } catch {
    try {
      return { title: 'Новое сообщение', body: event.data.text() };
    } catch {
      return null;
    }
  }
}

self.addEventListener('push', (event) => {
  const payload = readPushPayload(event);
  if (!payload || payload.type !== 'dm') return;
  const userId = typeof payload.userId === 'string' ? payload.userId : '';
  const title = typeof payload.title === 'string' && payload.title ? payload.title : 'Новое сообщение';
  const body = typeof payload.body === 'string' ? payload.body : '';

  event.waitUntil(
    (async () => {
      // Открытое приложение само показывает сообщение в интерфейсе —
      // системное уведомление в этом случае только мешает.
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const focused = windows.find(
        (client) => client.focused && client.visibilityState === 'visible',
      );
      if (focused) {
        focused.postMessage({ type: 'dm:received', userId });
        return;
      }
      await self.registration.showNotification(title, {
        body,
        lang: 'ru',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: userId ? `dm:${userId}` : 'dm',
        renotify: true,
        data: { userId },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  const userId = event.notification.data?.userId ?? '';
  event.notification.close();
  event.waitUntil(
    (async () => {
      const url = new URL('/app', self.location.origin);
      if (userId) url.searchParams.set('dm', userId);
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        client.postMessage({ type: 'dm:open', userId });
        return;
      }
      await self.clients.openWindow(url.href);
    })(),
  );
});
