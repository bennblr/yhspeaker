import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { MAX_VOICE_PARTICIPANTS, MIN_VOICE_PARTICIPANTS } from '@tsds/shared';
import { normalizeDomain } from './domain.js';

const platformDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = path.resolve(platformDir, '..');

for (const envPath of [path.join(rootDir, '.env'), path.join(platformDir, '.env')]) {
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
}

function envString(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function normalizeHostname(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
}

const isProduction = process.env.NODE_ENV === 'production';

function resolveJwtSecret(): string {
  const secret = process.env.PLATFORM_JWT_SECRET?.trim();
  if (secret && secret.length >= 16) return secret;
  if (isProduction) {
    throw new Error(
      'PLATFORM_JWT_SECRET не задан или слишком короткий (минимум 16 символов). Укажите его в .env',
    );
  }
  const generated = crypto.randomBytes(32).toString('hex');
  console.warn(
    '[platform] PLATFORM_JWT_SECRET не задан — сгенерирован временный. Сессии платформы станут недействительны после перезапуска.',
  );
  return generated;
}

function resolveAdminPassword(): string {
  const password = process.env.PLATFORM_ADMIN_PASSWORD?.trim();
  if (password) return password;
  if (isProduction) {
    throw new Error('PLATFORM_ADMIN_PASSWORD не задан. Укажите пароль платформенного администратора в .env');
  }
  return 'admin12345';
}

function resolveSecretKey(jwtSecret: string): string {
  const value = process.env.PLATFORM_SECRET_KEY?.trim();
  if (value && value.length >= 16) return value;
  if (isProduction) {
    console.warn(
      '[platform] PLATFORM_SECRET_KEY не задан — для шифрования паролей используется PLATFORM_JWT_SECRET. Задайте отдельный ключ, чтобы смена JWT-секрета не ломала запуск серверов.',
    );
  }
  return jwtSecret;
}

export interface PlatformConfig {
  rootDir: string;
  isProduction: boolean;
  port: number;
  bind: string;
  publicHost: string;
  tenantDomainSuffix: string;
  dataDir: string;
  webDistDir: string;
  desktopInstallerDir: string;
  serverEntry: string;
  jwtSecret: string;
  secretKey: string;
  adminLogin: string;
  adminPassword: string;
  announcedIp: string;
  httpPortStart: number;
  httpPortEnd: number;
  rtcPoolStart: number;
  rtcPoolEnd: number;
  defaultMaxParticipants: number;
  tenantAllowGuests: boolean;
  tenantGuestInviteRequired: boolean;
  trustProxy: boolean;
}

const httpPortStart = envInt('PLATFORM_HTTP_PORT_START', 4200);
const httpPortEnd = envInt('PLATFORM_HTTP_PORT_END', 4299);
const rtcPoolStart = envInt('PLATFORM_RTC_POOL_START', 40000);
const rtcPoolEnd = envInt('PLATFORM_RTC_POOL_END', 40999);
const defaultMaxParticipants = envInt('PLATFORM_DEFAULT_MAX_PARTICIPANTS', 50);

if (httpPortEnd < httpPortStart) {
  throw new Error('PLATFORM_HTTP_PORT_END должен быть не меньше PLATFORM_HTTP_PORT_START');
}
if (
  defaultMaxParticipants < MIN_VOICE_PARTICIPANTS ||
  defaultMaxParticipants > MAX_VOICE_PARTICIPANTS
) {
  throw new Error(
    `PLATFORM_DEFAULT_MAX_PARTICIPANTS должен быть от ${MIN_VOICE_PARTICIPANTS} до ${MAX_VOICE_PARTICIPANTS}`,
  );
}
if (rtcPoolEnd < rtcPoolStart) {
  throw new Error('PLATFORM_RTC_POOL_END должен быть не меньше PLATFORM_RTC_POOL_START');
}

const jwtSecret = resolveJwtSecret();

function resolveTenantDomainSuffix(): string {
  const raw = envString('PLATFORM_TENANT_DOMAIN_SUFFIX', '');
  if (!raw) return '';
  try {
    return normalizeDomain(raw);
  } catch {
    throw new Error(
      'PLATFORM_TENANT_DOMAIN_SUFFIX должен быть доменом, например example.com',
    );
  }
}

export const config: PlatformConfig = {
  rootDir,
  isProduction,
  port: envInt('PLATFORM_PORT', 4100),
  bind: envString('PLATFORM_BIND', '127.0.0.1'),
  publicHost: normalizeHostname(envString('PLATFORM_HOST', '')),
  tenantDomainSuffix: resolveTenantDomainSuffix(),
  dataDir: path.resolve(rootDir, envString('PLATFORM_DATA_DIR', 'platform-data')),
  webDistDir: path.join(rootDir, 'web', 'dist'),
  desktopInstallerDir: path.resolve(
    rootDir,
    envString('DESKTOP_INSTALLER_DIR', 'desktop/release'),
  ),
  serverEntry: path.join(rootDir, 'server', 'dist', 'index.js'),
  jwtSecret,
  secretKey: resolveSecretKey(jwtSecret),
  adminLogin: envString('PLATFORM_ADMIN_LOGIN', 'admin'),
  adminPassword: resolveAdminPassword(),
  announcedIp: envString('ANNOUNCED_IP', '127.0.0.1'),
  httpPortStart,
  httpPortEnd,
  rtcPoolStart,
  rtcPoolEnd,
  defaultMaxParticipants,
  tenantAllowGuests: envBool('ALLOW_GUESTS', true),
  tenantGuestInviteRequired: envBool('GUEST_INVITE_REQUIRED', false),
  trustProxy: envBool('PLATFORM_TRUST_PROXY', true),
};
