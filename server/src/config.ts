import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { MAX_VOICE_PARTICIPANTS, MIN_VOICE_PARTICIPANTS } from '@tsds/shared';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = path.resolve(serverDir, '..');

for (const envPath of [path.join(rootDir, '.env'), path.join(serverDir, '.env')]) {
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

// Совместимость с развёртываниями, где сервер ещё назывался TSDS.
function normalizeServerName(value: string): string {
  return value.toLowerCase() === 'tsds' ? 'YHSpeak' : value;
}

const isProduction = process.env.NODE_ENV === 'production';

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret && secret.length >= 16) return secret;
  if (isProduction) {
    throw new Error('JWT_SECRET не задан или слишком короткий (минимум 16 символов). Укажите его в .env');
  }
  const generated = crypto.randomBytes(32).toString('hex');
  console.warn('[config] JWT_SECRET не задан — сгенерирован временный. Сессии станут недействительны после перезапуска.');
  return generated;
}

export interface AppConfig {
  rootDir: string;
  isProduction: boolean;
  port: number;
  host: string;
  serverName: string;
  dataDir: string;
  webDistDir: string;
  desktopInstallerDir: string;
  jwtSecret: string;
  allowGuests: boolean;
  guestInviteCode: string;
  guestInviteRequired: boolean;
  announcedIp: string;
  rtcMinPort: number;
  rtcMaxPort: number;
  maxParticipants: number;
  trustProxy: boolean;
  bootstrapAdminLogin: string;
  bootstrapAdminPassword: string;
  bootstrapAdminDisplayName: string;
}

export const config: AppConfig = {
  rootDir,
  isProduction,
  port: envInt('PORT', 4000),
  host: envString('HOST', '0.0.0.0'),
  serverName: normalizeServerName(envString('SERVER_NAME', 'YHSpeak')),
  dataDir: path.resolve(rootDir, envString('DATA_DIR', 'data')),
  webDistDir: path.join(rootDir, 'web', 'dist'),
  desktopInstallerDir: path.resolve(
    rootDir,
    envString('DESKTOP_INSTALLER_DIR', 'desktop/release'),
  ),
  jwtSecret: resolveJwtSecret(),
  allowGuests: envBool('ALLOW_GUESTS', true),
  guestInviteCode: envString('GUEST_INVITE_CODE', ''),
  guestInviteRequired: envBool('GUEST_INVITE_REQUIRED', false),
  announcedIp: envString('ANNOUNCED_IP', '127.0.0.1'),
  rtcMinPort: envInt('RTC_MIN_PORT', 40000),
  rtcMaxPort: envInt('RTC_MAX_PORT', 40500),
  maxParticipants: Math.min(
    MAX_VOICE_PARTICIPANTS,
    Math.max(MIN_VOICE_PARTICIPANTS, envInt('MAX_PARTICIPANTS', MAX_VOICE_PARTICIPANTS)),
  ),
  trustProxy: envBool('TRUST_PROXY', true),
  bootstrapAdminLogin: envString('TENANT_ADMIN_LOGIN', ''),
  bootstrapAdminPassword: envString('TENANT_ADMIN_PASSWORD', ''),
  bootstrapAdminDisplayName: envString('TENANT_ADMIN_DISPLAY_NAME', ''),
};
