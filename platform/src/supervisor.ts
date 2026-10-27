import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { PlatformConfig } from './config.js';
import type { PlatformStore, TenantRecord } from './store.js';

export type RuntimeStatus = 'starting' | 'running' | 'stopped' | 'error';

export interface RuntimeView {
  status: RuntimeStatus;
  lastError?: string;
  startedAt?: number;
  restarts: number;
}

interface Runtime extends RuntimeView {
  child?: ChildProcess;
  logFd?: number;
  stopping: boolean;
  restartTimer?: NodeJS.Timeout;
  healthFails: number;
}

const HEALTH_TIMEOUT_MS = 45_000;
const STOP_TIMEOUT_MS = 6_000;
const HEALTH_INTERVAL_MS = 10_000;
const MAX_LOG_BYTES = 5 * 1024 * 1024;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TenantSupervisor {
  private readonly runtimes = new Map<string, Runtime>();
  private healthTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: PlatformConfig,
    private readonly store: PlatformStore,
    private readonly passwordFor: (tenant: TenantRecord) => string,
  ) {}

  private runtime(id: string): Runtime {
    let runtime = this.runtimes.get(id);
    if (!runtime) {
      runtime = { status: 'stopped', restarts: 0, stopping: false, healthFails: 0 };
      this.runtimes.set(id, runtime);
    }
    return runtime;
  }

  view(id: string): RuntimeView {
    const runtime = this.runtime(id);
    return {
      status: runtime.status,
      lastError: runtime.lastError,
      startedAt: runtime.startedAt,
      restarts: runtime.restarts,
    };
  }

  isRunning(id: string): boolean {
    const runtime = this.runtimes.get(id);
    return Boolean(runtime?.child) && runtime?.status === 'running';
  }

  async startAll(): Promise<void> {
    const servers = this.store.servers().filter((server) => server.running);
    await Promise.all(servers.map((server) => this.start(server.id)));
    this.healthTimer = setInterval(() => void this.checkHealthAll(), HEALTH_INTERVAL_MS);
    this.healthTimer.unref();
  }

  private logsDir(): string {
    return path.join(this.config.dataDir, 'logs');
  }

  private openLog(tenant: TenantRecord): number {
    const dir = this.logsDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${tenant.id}.log`);
    try {
      const stat = fs.statSync(file);
      if (stat.size > MAX_LOG_BYTES) {
        fs.renameSync(file, `${file}.old`);
      }
    } catch {
      /* no log yet */
    }
    const fd = fs.openSync(file, 'a');
    fs.writeSync(fd, `\n=== ${new Date().toISOString()} start ${tenant.name} ===\n`);
    return fd;
  }

  private closeLog(runtime: Runtime): void {
    if (runtime.logFd === undefined) return;
    try {
      fs.closeSync(runtime.logFd);
    } catch {
      /* already closed */
    }
    runtime.logFd = undefined;
  }

  private envFor(tenant: TenantRecord): NodeJS.ProcessEnv {
    return {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(tenant.httpPort),
      DATA_DIR: path.join(this.config.dataDir, 'tenants', tenant.id, 'data'),
      JWT_SECRET: tenant.jwtSecret,
      SERVER_NAME: tenant.name,
      ANNOUNCED_IP: this.config.announcedIp,
      RTC_MIN_PORT: String(tenant.rtcMinPort),
      RTC_MAX_PORT: String(tenant.rtcMaxPort),
      MAX_PARTICIPANTS: String(tenant.maxParticipants),
      TRUST_PROXY: 'true',
      ALLOW_GUESTS: this.config.tenantAllowGuests ? 'true' : 'false',
      GUEST_INVITE_REQUIRED: this.config.tenantGuestInviteRequired ? 'true' : 'false',
      TENANT_ADMIN_LOGIN: tenant.adminLogin,
      TENANT_ADMIN_PASSWORD: this.passwordFor(tenant),
      TENANT_ADMIN_DISPLAY_NAME: tenant.adminLogin,
    };
  }

  async start(id: string): Promise<void> {
    const tenant = this.store.serverById(id);
    if (!tenant) return;
    const runtime = this.runtime(id);
    if (runtime.child) {
      if (runtime.status !== 'running') await this.waitHealthy(tenant, runtime);
      return;
    }
    if (runtime.restartTimer) {
      clearTimeout(runtime.restartTimer);
      runtime.restartTimer = undefined;
    }

    runtime.stopping = false;
    runtime.status = 'starting';
    runtime.lastError = undefined;
    runtime.healthFails = 0;

    if (!fs.existsSync(this.config.serverEntry)) {
      runtime.status = 'error';
      runtime.lastError = `Не найдена сборка сервера: ${this.config.serverEntry}. Выполните npm run build.`;
      return;
    }

    let env: NodeJS.ProcessEnv;
    try {
      env = this.envFor(tenant);
    } catch (error) {
      runtime.status = 'error';
      runtime.lastError =
        error instanceof Error ? error.message : 'Не удалось расшифровать пароль администратора';
      return;
    }

    const logFd = this.openLog(tenant);
    runtime.logFd = logFd;
    let child: ChildProcess;
    try {
      child = spawn(process.execPath, [this.config.serverEntry], {
        cwd: this.config.rootDir,
        env,
        stdio: ['ignore', logFd, logFd],
        windowsHide: true,
      });
    } catch (error) {
      runtime.status = 'error';
      runtime.lastError = error instanceof Error ? error.message : 'Не удалось запустить процесс';
      this.closeLog(runtime);
      return;
    }

    runtime.child = child;
    runtime.startedAt = Date.now();
    child.once('error', (error) => {
      runtime.lastError = error.message;
      runtime.status = 'error';
    });
    child.once('exit', (code, signal) => {
      this.closeLog(runtime);
      runtime.child = undefined;
      runtime.startedAt = undefined;
      this.handleExit(tenant.id, runtime, code, signal);
    });

    console.log(
      `[platform] старт ${tenant.name} (${tenant.id}) на 127.0.0.1:${tenant.httpPort}, RTC ${tenant.rtcMinPort}-${tenant.rtcMaxPort}, до ${tenant.maxParticipants} участников`,
    );
    await this.waitHealthy(tenant, runtime);
  }

  private async waitHealthy(tenant: TenantRecord, runtime: Runtime): Promise<boolean> {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!runtime.child) return false;
      if (await this.checkHealth(tenant.httpPort)) {
        runtime.status = 'running';
        runtime.lastError = undefined;
        runtime.healthFails = 0;
        runtime.startedAt ??= Date.now();
        return true;
      }
      await delay(400);
    }
    if (runtime.child) {
      runtime.status = 'error';
      runtime.lastError = 'Сервер не ответил на проверку здоровья за 45 секунд';
    }
    return false;
  }

  private async checkHealth(port: number): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(2500),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async checkHealthAll(): Promise<void> {
    for (const tenant of this.store.servers()) {
      const runtime = this.runtimes.get(tenant.id);
      if (!runtime?.child) continue;
      const ok = await this.checkHealth(tenant.httpPort);
      if (ok) {
        runtime.healthFails = 0;
        if (runtime.status === 'error' || runtime.status === 'starting') {
          runtime.status = 'running';
          runtime.lastError = undefined;
        }
        if (runtime.startedAt && Date.now() - runtime.startedAt > 60_000) {
          runtime.restarts = 0;
        }
      } else if (runtime.status === 'running') {
        runtime.healthFails += 1;
        if (runtime.healthFails >= 2) {
          runtime.status = 'error';
          runtime.lastError = 'Сервер не отвечает';
        }
      }
    }
  }

  private handleExit(
    id: string,
    runtime: Runtime,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    const reason = code !== null ? `код ${code}` : `сигнал ${signal ?? 'неизвестен'}`;
    if (runtime.stopping) {
      runtime.stopping = false;
      runtime.status = 'stopped';
      runtime.lastError = undefined;
      return;
    }

    const tenant = this.store.serverById(id);
    if (!tenant) {
      runtime.status = 'stopped';
      return;
    }
    if (!tenant.running) {
      runtime.status = 'stopped';
      runtime.lastError = `Процесс завершился (${reason})`;
      return;
    }

    runtime.restarts += 1;
    const delayMs = Math.min(30_000, 1000 * 2 ** Math.min(runtime.restarts - 1, 5));
    runtime.status = 'starting';
    runtime.lastError = `Процесс завершился (${reason}), перезапуск через ${Math.round(delayMs / 1000)} с`;
    runtime.restartTimer = setTimeout(() => {
      runtime.restartTimer = undefined;
      void this.start(id);
    }, delayMs);
    runtime.restartTimer.unref();
  }

  async stop(id: string): Promise<void> {
    const runtime = this.runtime(id);
    runtime.stopping = true;
    if (runtime.restartTimer) {
      clearTimeout(runtime.restartTimer);
      runtime.restartTimer = undefined;
    }
    const child = runtime.child;
    if (!child) {
      runtime.status = 'stopped';
      runtime.lastError = undefined;
      runtime.stopping = false;
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already dead */
        }
        done();
      }, STOP_TIMEOUT_MS);
      child.once('exit', done);
      try {
        child.kill('SIGTERM');
      } catch {
        done();
      }
    });

    runtime.child = undefined;
    runtime.startedAt = undefined;
    runtime.status = 'stopped';
    runtime.lastError = undefined;
    runtime.stopping = false;
  }

  async restart(id: string): Promise<void> {
    await this.stop(id);
    await this.start(id);
  }

  async stopAll(): Promise<void> {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    const ids = [...this.runtimes.keys()];
    await Promise.all(ids.map((id) => this.stop(id)));
  }
}
