import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { MAX_VOICE_PARTICIPANTS, MIN_VOICE_PARTICIPANTS } from '@tsds/shared';

export interface TenantRecord {
  id: string;
  name: string;
  domains: string[];
  httpPort: number;
  rtcMinPort: number;
  rtcMaxPort: number;
  maxParticipants: number;
  jwtSecret: string;
  adminLogin: string;
  adminPasswordEnc: string;
  createdAt: number;
  running: boolean;
}

interface AdminRecord {
  login: string;
  passwordHash: string;
  createdAt: number;
}

interface PlatformData {
  version: 1;
  admin: AdminRecord;
  servers: TenantRecord[];
}

function clone(server: TenantRecord): TenantRecord {
  return { ...server, domains: [...server.domains] };
}

function clampParticipants(value: number): number {
  return Math.min(MAX_VOICE_PARTICIPANTS, Math.max(MIN_VOICE_PARTICIPANTS, Math.round(value)));
}

function withDefaults(server: TenantRecord): TenantRecord {
  const ports = server.rtcMaxPort - server.rtcMinPort + 1;
  return {
    ...server,
    domains: Array.isArray(server.domains) ? server.domains : [],
    maxParticipants:
      typeof server.maxParticipants === 'number'
        ? clampParticipants(server.maxParticipants)
        : clampParticipants(Math.floor(ports / 2)),
  };
}

export class PlatformStore {
  private data: PlatformData;
  private readonly file: string;

  constructor(
    dataDir: string,
    adminLogin: string,
    adminPassword: string,
  ) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'platform.json');

    if (fs.existsSync(this.file)) {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<PlatformData>;
      if (!parsed.admin || !Array.isArray(parsed.servers)) {
        throw new Error(`Повреждён файл платформы: ${this.file}`);
      }
      this.data = {
        version: 1,
        admin: parsed.admin,
        servers: parsed.servers.map(withDefaults),
      };
    } else {
      this.data = {
        version: 1,
        admin: {
          login: adminLogin,
          passwordHash: bcrypt.hashSync(adminPassword, 10),
          createdAt: Date.now(),
        },
        servers: [],
      };
    }
    this.save();
  }

  get adminLogin(): string {
    return this.data.admin.login;
  }

  verifyAdminPassword(password: string): boolean {
    return bcrypt.compareSync(password, this.data.admin.passwordHash);
  }

  setAdminPassword(password: string): void {
    this.data.admin.passwordHash = bcrypt.hashSync(password, 10);
    this.save();
  }

  servers(): TenantRecord[] {
    return this.data.servers.map(clone);
  }

  serverById(id: string): TenantRecord | undefined {
    const server = this.data.servers.find((item) => item.id === id);
    return server ? clone(server) : undefined;
  }

  serverByDomain(domain: string): TenantRecord | undefined {
    const server = this.data.servers.find((item) => item.domains.includes(domain));
    return server ? clone(server) : undefined;
  }

  domainOwner(domain: string, exceptId?: string): TenantRecord | undefined {
    const server = this.data.servers.find(
      (item) => item.id !== exceptId && item.domains.includes(domain),
    );
    return server ? clone(server) : undefined;
  }

  addServer(server: TenantRecord): TenantRecord {
    this.data.servers.push(clone(server));
    this.save();
    return clone(server);
  }

  updateServer(
    id: string,
    patch: Partial<
      Pick<
        TenantRecord,
        'name' | 'domains' | 'adminLogin' | 'maxParticipants' | 'rtcMinPort' | 'rtcMaxPort'
      >
    >,
  ): TenantRecord | undefined {
    const server = this.data.servers.find((item) => item.id === id);
    if (!server) return undefined;
    if (typeof patch.name === 'string') server.name = patch.name;
    if (Array.isArray(patch.domains)) server.domains = [...patch.domains];
    if (typeof patch.adminLogin === 'string') server.adminLogin = patch.adminLogin;
    if (typeof patch.maxParticipants === 'number') {
      server.maxParticipants = clampParticipants(patch.maxParticipants);
    }
    if (typeof patch.rtcMinPort === 'number') server.rtcMinPort = patch.rtcMinPort;
    if (typeof patch.rtcMaxPort === 'number') server.rtcMaxPort = patch.rtcMaxPort;
    this.save();
    return clone(server);
  }

  setRunning(id: string, running: boolean): TenantRecord | undefined {
    const server = this.data.servers.find((item) => item.id === id);
    if (!server) return undefined;
    server.running = running;
    this.save();
    return clone(server);
  }

  removeServer(id: string): TenantRecord | undefined {
    const index = this.data.servers.findIndex((item) => item.id === id);
    if (index < 0) return undefined;
    const [removed] = this.data.servers.splice(index, 1);
    this.save();
    return clone(removed);
  }

  save(): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    try {
      fs.chmodSync(this.file, 0o600);
    } catch {
      /* Windows may ignore POSIX modes */
    }
  }
}
