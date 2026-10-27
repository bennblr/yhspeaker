import crypto from 'node:crypto';

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function randomPassword(length = 16): string {
  let value = '';
  while (value.length < length) {
    value += crypto.randomBytes(24).toString('base64url');
  }
  return value.slice(0, length);
}

function keyFrom(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptSecret(value: string, secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(
    ':',
  );
}

export function decryptSecret(payload: string, secret: string): string {
  const [version, ivRaw, tagRaw, dataRaw] = payload.split(':');
  if (version !== 'v1' || !ivRaw || !tagRaw || !dataRaw) {
    throw new Error('Повреждённый секрет');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    keyFrom(secret),
    Buffer.from(ivRaw, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
