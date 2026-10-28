import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  APP_VERSION,
  MAX_VOICE_PARTICIPANTS,
  MIN_VOICE_PARTICIPANTS,
  statsDateKey,
  summarizeOnlineStats,
  type OnlineStatsFile,
} from '@tsds/shared';
import { PlatformAuth } from './auth.js';
import { config } from './config.js';
import { decryptSecret, encryptSecret, randomPassword, randomToken } from './crypto.js';
import { DomainError, normalizeDomain, normalizeHostHeader, slugifyHostLabel } from './domain.js';
import { forwardHttp, forwardUpgrade } from './proxy.js';
import { PlatformStore, type TenantRecord } from './store.js';
import { TenantSupervisor } from './supervisor.js';

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const store = new PlatformStore(config.dataDir, config.adminLogin, config.adminPassword);
const auth = new PlatformAuth(config.jwtSecret, store.adminLogin);
const supervisor = new TenantSupervisor(config, store, (tenant) =>
  decryptSecret(tenant.adminPasswordEnc, config.secretKey),
);

const app = express();
const httpServer = http.createServer(app);
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy ? 1 : false);

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(self), display-capture=(self)');
  next();
});

function wrap(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HttpError(400, issue?.message || 'Некорректные данные');
  }
  return result.data;
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
}

function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const token = bearerToken(req);
  if (!token) {
    next(new HttpError(401, 'Требуется авторизация'));
    return;
  }
  const login = auth.verify(token);
  if (!login) {
    next(new HttpError(401, 'Сессия истекла, войдите заново'));
    return;
  }
  next();
}

function isPlatformHost(host: string): boolean {
  if (!host) return true;
  if (config.publicHost && host === config.publicHost) return true;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function cleanDomains(raw: string[], exceptId?: string): string[] {
  const domains = [...new Set(raw.map((domain) => normalizeDomain(domain)))];
  for (const domain of domains) {
    if (config.publicHost && domain === config.publicHost) {
      throw new HttpError(400, `Домен ${domain} занят панелью платформы`);
    }
    const owner = store.domainOwner(domain, exceptId);
    if (owner) {
      throw new HttpError(409, `Домен ${domain} уже привязан к серверу «${owner.name}»`);
    }
  }
  return domains;
}

function defaultTenantDomains(name: string): string[] {
  const suffix = config.tenantDomainSuffix;
  if (!suffix) return [];
  const base = slugifyHostLabel(name) || 'server';
  let candidate = `${base}.${suffix}`;
  for (let index = 2; index < 100 && store.domainOwner(candidate); index += 1) {
    candidate = `${base}-${index}.${suffix}`;
  }
  if (store.domainOwner(candidate)) {
    candidate = `${base}-${crypto.randomBytes(2).toString('hex')}.${suffix}`;
  }
  return [candidate];
}

function allocateHttpPort(): number {
  const used = new Set(store.servers().map((server) => server.httpPort));
  for (let port = config.httpPortStart; port <= config.httpPortEnd; port += 1) {
    if (!used.has(port)) return port;
  }
  throw new HttpError(409, 'Свободные HTTP-порты для серверов закончились');
}

function allocateRtcRange(
  participants: number,
  exceptId?: string,
): { min: number; max: number } {
  const size = participants * 2;
  const blocks = store
    .servers()
    .filter((server) => server.id !== exceptId)
    .map((server) => [server.rtcMinPort, server.rtcMaxPort] as const)
    .sort((a, b) => a[0] - b[0]);
  let cursor = config.rtcPoolStart;
  for (const [min, max] of blocks) {
    if (cursor + size - 1 < min) break;
    cursor = Math.max(cursor, max + 1);
  }
  if (cursor + size - 1 > config.rtcPoolEnd) {
    throw new HttpError(
      409,
      `В пуле RTC не хватает ${size} портов для ${participants} участников. Уменьшите лимит или расширьте пул`,
    );
  }
  return { min: cursor, max: cursor + size - 1 };
}

function serverView(server: TenantRecord) {
  const runtime = supervisor.view(server.id);
  return {
    id: server.id,
    name: server.name,
    domains: server.domains,
    httpPort: server.httpPort,
    rtcMinPort: server.rtcMinPort,
    rtcMaxPort: server.rtcMaxPort,
    maxParticipants: server.maxParticipants,
    adminLogin: server.adminLogin,
    createdAt: server.createdAt,
    desiredRunning: server.running,
    status: runtime.status,
    lastError: runtime.lastError,
    startedAt: runtime.startedAt,
    restarts: runtime.restarts,
  };
}

function findDesktopInstaller(): { file: string; name: string; size: number } | null {
  try {
    const candidates = fs
      .readdirSync(config.desktopInstallerDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.exe$/i.test(entry.name))
      .map((entry) => {
        const file = path.join(config.desktopInstallerDir, entry.name);
        const stat = fs.statSync(file);
        return { file, name: entry.name, size: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    const newest = candidates[0];
    return newest ? { file: newest.file, name: newest.name, size: newest.size } : null;
  } catch {
    return null;
  }
}

function platformMeta() {
  const installer = findDesktopInstaller();
  return {
    publicHost: config.publicHost,
    tenantDomainSuffix: config.tenantDomainSuffix,
    announcedIp: config.announcedIp,
    httpPortStart: config.httpPortStart,
    httpPortEnd: config.httpPortEnd,
    rtcPoolStart: config.rtcPoolStart,
    rtcPoolEnd: config.rtcPoolEnd,
    defaultMaxParticipants: config.defaultMaxParticipants,
    maxParticipantsLimit: MAX_VOICE_PARTICIPANTS,
    adminLogin: store.adminLogin,
    version: APP_VERSION,
    desktop: {
      available: Boolean(installer),
      fileName: installer?.name ?? null,
      size: installer?.size ?? 0,
    },
  };
}

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const times = cpu.times;
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total };
}

let lastCpuTimes = cpuTimes();
let cpuPercent = 0;

setInterval(() => {
  const current = cpuTimes();
  const totalDelta = current.total - lastCpuTimes.total;
  const idleDelta = current.idle - lastCpuTimes.idle;
  if (totalDelta > 0) {
    cpuPercent = Math.min(100, Math.max(0, (1 - idleDelta / totalDelta) * 100));
    lastCpuTimes = current;
  }
}, 3000).unref();

function memoryMetrics() {
  const total = os.totalmem();
  let available = os.freemem();
  try {
    const match = /^MemAvailable:\s+(\d+)\s+kB/im.exec(fs.readFileSync('/proc/meminfo', 'utf8'));
    if (match) available = Number(match[1]) * 1024;
  } catch {
    /* не Linux — используем os.freemem */
  }
  const used = Math.max(0, total - available);
  return { total, used, percent: total > 0 ? (used / total) * 100 : 0 };
}

function diskMetrics() {
  try {
    const stat = fs.statfsSync('/');
    const total = stat.blocks * stat.bsize;
    const free = stat.bavail * stat.bsize;
    const used = Math.max(0, total - free);
    return { total, used, percent: total > 0 ? (used / total) * 100 : 0 };
  } catch {
    return null;
  }
}

function systemMetrics() {
  const load = os.loadavg();
  const memory = memoryMetrics();
  const disk = diskMetrics();
  return {
    cpu: {
      percent: Number(cpuPercent.toFixed(1)),
      cores: os.cpus().length,
      load1: Number(load[0].toFixed(2)),
      load5: Number(load[1].toFixed(2)),
      load15: Number(load[2].toFixed(2)),
    },
    memory: {
      percent: Number(memory.percent.toFixed(1)),
      used: memory.used,
      total: memory.total,
    },
    disk: disk && {
      percent: Number(disk.percent.toFixed(1)),
      used: disk.used,
      total: disk.total,
    },
  };
}

// ---------- rate limiting ----------

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function checkLoginRateLimit(key: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 60_000 });
    return;
  }
  entry.count += 1;
  if (entry.count > 10) {
    throw new HttpError(429, 'Слишком много попыток входа. Попробуйте через минуту');
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of loginAttempts) {
    if (entry.resetAt <= now) loginAttempts.delete(key);
  }
}, 60_000).unref();

// ---------- platform API ----------

const loginSchema = z.object({
  login: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
});

const participantsSchema = z
  .number()
  .int('Участники: целое число')
  .min(MIN_VOICE_PARTICIPANTS, `Участники: минимум ${MIN_VOICE_PARTICIPANTS}`)
  .max(MAX_VOICE_PARTICIPANTS, `Участники: максимум ${MAX_VOICE_PARTICIPANTS}`);

const createServerSchema = z.object({
  name: z.string().trim().min(2, 'Название: минимум 2 символа').max(48),
  domains: z.array(z.string()).max(20).optional(),
  maxParticipants: participantsSchema.optional(),
  adminLogin: z
    .string()
    .trim()
    .min(3, 'Логин администратора: минимум 3 символа')
    .max(32)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Логин: латиница, цифры, точка, дефис и подчёркивание')
    .optional(),
  adminPassword: z.string().min(8, 'Пароль: минимум 8 символов').max(100).optional(),
});

const updateServerSchema = z.object({
  name: z.string().trim().min(2).max(48).optional(),
  domains: z.array(z.string()).max(20).optional(),
  maxParticipants: participantsSchema.optional(),
});

const deleteServerSchema = z.object({
  confirmName: z.string().trim().min(1).max(64),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8, 'Новый пароль: минимум 8 символов').max(200),
});

const platformApi = express.Router();
platformApi.use(express.json({ limit: '64kb' }));

platformApi.get('/health', (_req, res) => {
  const servers = store.servers();
  res.json({
    ok: true,
    version: APP_VERSION,
    servers: servers.length,
    running: servers.filter((server) => supervisor.isRunning(server.id)).length,
  });
});

platformApi.post(
  '/login',
  wrap(async (req, res) => {
    checkLoginRateLimit(`login:${req.ip}`);
    const body = parseBody(loginSchema, req.body);
    if (body.login !== store.adminLogin || !store.verifyAdminPassword(body.password)) {
      throw new HttpError(401, 'Неверный логин или пароль');
    }
    res.json({ token: auth.sign(), admin: { login: store.adminLogin } });
  }),
);

platformApi.get('/me', requireAdmin, (_req, res) => {
  res.json({ admin: { login: store.adminLogin } });
});

platformApi.get('/overview', requireAdmin, (_req, res) => {
  res.json({
    servers: store.servers().map(serverView),
    meta: platformMeta(),
    system: systemMetrics(),
  });
});

platformApi.get('/servers/:id/stats', requireAdmin, (req, res, next) => {
  try {
    const tenant = store.serverById(req.params.id);
    if (!tenant) throw new HttpError(404, 'Сервер не найден');
    const raw = Number.parseInt(String(req.query.days ?? '7'), 10);
    const days = Number.isFinite(raw) ? Math.min(90, Math.max(1, raw)) : 7;
    const file = path.join(config.dataDir, 'tenants', tenant.id, 'data', 'stats.json');
    let data: OnlineStatsFile = { version: 1, days: {} };
    if (fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as OnlineStatsFile;
        if (parsed?.version === 1 && parsed.days) data = parsed;
      } catch {
        /* повреждённый файл — показываем пустую статистику */
      }
    }
    const now = Date.now();
    const from = now - days * 86_400_000;
    const cutoff = statsDateKey(from);
    const list = Object.values(data.days).filter((day) => day.date >= cutoff);
    res.json({ stats: summarizeOnlineStats(list, from, now) });
  } catch (error) {
    next(error);
  }
});

platformApi.post(
  '/servers',
  requireAdmin,
  wrap(async (req, res) => {
    const body = parseBody(createServerSchema, req.body);
    const requestedDomains = body.domains ?? [];
    const domains = cleanDomains(
      requestedDomains.length > 0 ? requestedDomains : defaultTenantDomains(body.name),
    );
    const maxParticipants = body.maxParticipants ?? config.defaultMaxParticipants;
    const httpPort = allocateHttpPort();
    const rtc = allocateRtcRange(maxParticipants);
    const id = crypto.randomUUID();
    const adminLogin = body.adminLogin?.trim() || 'admin';
    const adminPassword = body.adminPassword || randomPassword(16);

    const server: TenantRecord = {
      id,
      name: body.name,
      domains,
      httpPort,
      rtcMinPort: rtc.min,
      rtcMaxPort: rtc.max,
      maxParticipants,
      jwtSecret: randomToken(32),
      adminLogin,
      adminPasswordEnc: encryptSecret(adminPassword, config.secretKey),
      createdAt: Date.now(),
      running: true,
    };
    store.addServer(server);
    await supervisor.start(id);
    const created = store.serverById(id) ?? server;
    res.status(201).json({
      server: serverView(created),
      credentials: { login: adminLogin, password: adminPassword },
    });
  }),
);

platformApi.patch(
  '/servers/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const tenant = store.serverById(req.params.id);
    if (!tenant) throw new HttpError(404, 'Сервер не найден');
    const body = parseBody(updateServerSchema, req.body);
    const patch: {
      name?: string;
      domains?: string[];
      maxParticipants?: number;
      rtcMinPort?: number;
      rtcMaxPort?: number;
    } = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.domains !== undefined) patch.domains = cleanDomains(body.domains, tenant.id);

    const participantsChanged =
      body.maxParticipants !== undefined && body.maxParticipants !== tenant.maxParticipants;
    if (participantsChanged) {
      const rtc = allocateRtcRange(body.maxParticipants!, tenant.id);
      patch.maxParticipants = body.maxParticipants;
      patch.rtcMinPort = rtc.min;
      patch.rtcMaxPort = rtc.max;
    }

    const updated = store.updateServer(tenant.id, patch);
    if (!updated) throw new HttpError(404, 'Сервер не найден');
    const nameChanged = patch.name !== undefined && patch.name !== tenant.name;
    if ((nameChanged || participantsChanged) && updated.running) {
      void supervisor.restart(updated.id);
    }
    res.json({ server: serverView(updated) });
  }),
);

platformApi.post(
  '/servers/:id/start',
  requireAdmin,
  wrap(async (req, res) => {
    const tenant = store.serverById(req.params.id);
    if (!tenant) throw new HttpError(404, 'Сервер не найден');
    store.setRunning(tenant.id, true);
    void supervisor.start(tenant.id);
    res.json({ server: serverView(store.serverById(tenant.id) ?? tenant) });
  }),
);

platformApi.post(
  '/servers/:id/stop',
  requireAdmin,
  wrap(async (req, res) => {
    const tenant = store.serverById(req.params.id);
    if (!tenant) throw new HttpError(404, 'Сервер не найден');
    store.setRunning(tenant.id, false);
    await supervisor.stop(tenant.id);
    res.json({ server: serverView(store.serverById(tenant.id) ?? tenant) });
  }),
);

platformApi.post(
  '/servers/:id/restart',
  requireAdmin,
  wrap(async (req, res) => {
    const tenant = store.serverById(req.params.id);
    if (!tenant) throw new HttpError(404, 'Сервер не найден');
    store.setRunning(tenant.id, true);
    void supervisor.restart(tenant.id);
    res.json({ server: serverView(store.serverById(tenant.id) ?? tenant) });
  }),
);

platformApi.get('/servers/:id/credentials', requireAdmin, (req, res, next) => {
  try {
    const tenant = store.serverById(req.params.id);
    if (!tenant) throw new HttpError(404, 'Сервер не найден');
    res.json({
      login: tenant.adminLogin,
      password: decryptSecret(tenant.adminPasswordEnc, config.secretKey),
    });
  } catch (error) {
    next(error);
  }
});

platformApi.delete(
  '/servers/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const tenant = store.serverById(req.params.id);
    if (!tenant) throw new HttpError(404, 'Сервер не найден');
    const body = parseBody(deleteServerSchema, req.body);
    if (body.confirmName.trim() !== tenant.name) {
      throw new HttpError(400, 'Введите точное название сервера для подтверждения');
    }
    store.setRunning(tenant.id, false);
    await supervisor.stop(tenant.id);

    const trashDir = path.join(config.dataDir, 'trash');
    fs.mkdirSync(trashDir, { recursive: true });
    const suffix = `${tenant.id}-${Date.now()}`;
    let archivedTo: string | null = null;
    const dataDir = path.join(config.dataDir, 'tenants', tenant.id);
    if (fs.existsSync(dataDir)) {
      archivedTo = path.join(trashDir, suffix);
      fs.renameSync(dataDir, archivedTo);
    }
    const logFile = path.join(config.dataDir, 'logs', `${tenant.id}.log`);
    if (fs.existsSync(logFile)) {
      try {
        fs.renameSync(logFile, path.join(trashDir, `${suffix}.log`));
      } catch {
        /* keep log if it is still locked */
      }
    }
    store.removeServer(tenant.id);
    res.json({ ok: true, archivedTo });
  }),
);

platformApi.post(
  '/account/password',
  requireAdmin,
  wrap(async (req, res) => {
    const body = parseBody(passwordSchema, req.body);
    if (!store.verifyAdminPassword(body.currentPassword)) {
      throw new HttpError(400, 'Текущий пароль неверен');
    }
    store.setAdminPassword(body.newPassword);
    res.json({ ok: true });
  }),
);

platformApi.use((_req, res) => {
  res.status(404).json({ error: 'Не найдено' });
});

app.use('/api/platform', platformApi);

// ---------- ACME / Caddy on-demand TLS ----------

app.get('/api/tls/ask', (req, res) => {
  const raw = req.query.domain;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) {
    res.status(400).type('text/plain').send('domain required');
    return;
  }
  let domain: string;
  try {
    domain = normalizeDomain(String(value));
  } catch {
    res.status(404).type('text/plain').send('unknown domain');
    return;
  }
  if (config.publicHost && domain === config.publicHost) {
    res.type('text/plain').send('ok');
    return;
  }
  if (store.serverByDomain(domain)) {
    res.type('text/plain').send('ok');
    return;
  }
  res.status(404).type('text/plain').send('unknown domain');
});

// ---------- desktop app download ----------

app.get('/api/desktop', (_req, res) => {
  const installer = findDesktopInstaller();
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    available: Boolean(installer),
    fileName: installer?.name ?? null,
    size: installer?.size ?? 0,
  });
});

app.get('/download/windows', (_req, res) => {
  const installer = findDesktopInstaller();
  if (!installer) {
    res.status(404).type('text/plain').send('Установщик YHSpeak для Windows пока не загружен.');
    return;
  }
  res.download(installer.file, installer.name);
});

// ---------- platform admin UI ----------

const platformHtml = path.join(config.webDistDir, 'platform.html');

function sendPlatformPage(res: Response): void {
  if (!fs.existsSync(platformHtml)) {
    res
      .status(503)
      .type('text/plain')
      .send('Админка платформы не собрана. Выполните npm run build.');
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(platformHtml);
}

app.use(
  '/assets',
  express.static(path.join(config.webDistDir, 'assets'), {
    index: false,
    maxAge: '30d',
    immutable: true,
  }),
);
app.use(
  express.static(config.webDistDir, {
    index: false,
    maxAge: '1h',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
      if (filePath.endsWith('sw.js') || filePath.endsWith('manifest.webmanifest')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }),
);
app.get(['/platform', '/platform/', '/platform.html'], (_req, res) => sendPlatformPage(res));

app.get('/', (req, res, next) => {
  const host = normalizeHostHeader(req.headers.host);
  if (isPlatformHost(host) || !store.serverByDomain(host)) {
    res.redirect('/platform');
    return;
  }
  next();
});

// ---------- tenant proxy ----------

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
}

function offlinePage(title: string, message: string, hint: string): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
    :root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0c11;color:#e2e8f0;font:15px/1.55 Inter,"Segoe UI",system-ui,sans-serif}
    main{max-width:460px;padding:32px;border:1px solid #232a3b;border-radius:16px;background:#141824;box-shadow:0 20px 60px rgba(0,0,0,.45)}
    h1{margin:0 0 8px;font-size:20px}p{margin:0 0 10px;color:#8a93a8}code{color:#9a6bff}
  </style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p>${escapeHtml(hint)}</p></main></body></html>`;
}

function tenantForHost(host: string): TenantRecord | undefined {
  return host ? store.serverByDomain(host) : undefined;
}

app.use((req, res) => {
  const host = normalizeHostHeader(req.headers.host);
  const tenant = tenantForHost(host);
  if (!tenant) {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: 'Сервер не найден' });
      return;
    }
    res
      .status(404)
      .type('html')
      .send(
        offlinePage(
          'Сервер не найден',
          'К этому домену не привязан ни один голосовой сервер.',
          'Откройте панель платформы и добавьте домен к нужному серверу.',
        ),
      );
    return;
  }
  if (!supervisor.isRunning(tenant.id)) {
    if (req.path.startsWith('/api/')) {
      res.status(503).json({ error: 'Сервер сейчас не запущен' });
      return;
    }
    res
      .status(503)
      .type('html')
      .send(
        offlinePage(
          'Сервер сейчас не запущен',
          `«${tenant.name}» временно недоступен.`,
          'Администратор платформы может запустить его в панели управления.',
        ),
      );
    return;
  }
  forwardHttp(req, res, tenant.httpPort);
});

httpServer.on('upgrade', (req, socket, head) => {
  const host = normalizeHostHeader(req.headers.host);
  const tenant = tenantForHost(host);
  if (!tenant || !supervisor.isRunning(tenant.id)) {
    socket.end(
      `HTTP/1.1 ${tenant ? '503 Service Unavailable' : '404 Not Found'}\r\nConnection: close\r\n\r\n`,
    );
    return;
  }
  const proto = (req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http') as string;
  forwardUpgrade(req, socket, head, tenant.httpPort, proto);
});

// ---------- errors ----------

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof DomainError) {
    res.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: error.issues[0]?.message || 'Некорректные данные' });
    return;
  }
  console.error('[platform] необработанная ошибка', error);
  res.status(500).json({ error: 'Внутренняя ошибка платформы' });
});

// ---------- startup ----------

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[platform] ${signal}: завершение работы`);
  httpServer.close();
  await supervisor.stopAll().catch((error) => console.error('[platform] stop tenants failed', error));
  store.save();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

httpServer.listen(config.port, config.bind, () => {
  console.log(`[platform] YHSpeak Platform ${APP_VERSION} слушает http://${config.bind}:${config.port}`);
  console.log(`[platform] админка: http://127.0.0.1:${config.port}/platform`);
  console.log(`[platform] публичный хост панели: ${config.publicHost || 'не задан'}`);
  console.log(`[platform] ANNOUNCED_IP=${config.announcedIp}, HTTP ${config.httpPortStart}-${config.httpPortEnd}, RTC ${config.rtcPoolStart}-${config.rtcPoolEnd}`);
  console.log(`[platform] администратор платформы: ${store.adminLogin}`);
  void supervisor.startAll().catch((error) => console.error('[platform] start tenants failed', error));
});
