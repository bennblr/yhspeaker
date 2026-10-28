import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { BaseRole } from '@tsds/shared';
import type { AppConfig } from './config.js';
import type { Store, StoredUser } from './store.js';

export interface Account {
  id: string;
  username: string;
  displayName: string;
  label?: string;
  role: BaseRole;
  roleIds: string[];
  isGuest: boolean;
  banned: boolean;
}

interface TokenPayload {
  sub: string;
  kind: 'user' | 'guest';
  username?: string;
  displayName?: string;
  role?: BaseRole;
}

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    bcrypt.hash(password, 10, (error, hash) => {
      if (error) reject(error);
      else resolve(hash);
    });
  });
}

function comparePassword(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    bcrypt.compare(password, hash, (error, equal) => {
      if (error) reject(error);
      else resolve(equal);
    });
  });
}

export function hashChannelPassword(password: string): Promise<string> {
  return hashPassword(password);
}

export function verifyChannelPassword(password: string, hash: string): Promise<boolean> {
  return comparePassword(password, hash);
}

function accountFromStored(user: StoredUser): Account {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    label: user.label,
    role: user.role,
    roleIds: [...user.roleIds],
    isGuest: false,
    banned: user.banned,
  };
}

export class AuthService {
  constructor(
    private readonly store: Store,
    private readonly config: AppConfig,
    private readonly isNameTaken: (name: string) => boolean,
  ) {}

  private sign(payload: TokenPayload, expiresIn: string): string {
    return jwt.sign(payload, this.config.jwtSecret, { expiresIn } as jwt.SignOptions);
  }

  private issueToken(account: Account): string {
    return this.sign(
      {
        sub: account.id,
        kind: account.isGuest ? 'guest' : 'user',
        username: account.username,
        displayName: account.displayName,
        role: account.role,
      },
      account.isGuest ? '12h' : '7d',
    );
  }

  async register(input: {
    username: string;
    password: string;
    displayName?: string;
  }): Promise<{ token: string; account: Account }> {
    const username = input.username.trim();
    const displayName = (input.displayName?.trim() || username).slice(0, 32);
    if (this.store.userByUsername(username)) {
      throw new Error('Этот логин уже занят');
    }
    if (this.store.isIdentityTaken(displayName)) {
      throw new Error('Это имя уже используется');
    }

    const passwordHash = await hashPassword(input.password);
    const user = this.store.createUser({ username, displayName, passwordHash });
    const account = accountFromStored(user);
    return { token: this.issueToken(account), account };
  }

  async login(input: { username: string; password: string }): Promise<{
    token: string;
    account: Account;
  }> {
    const user = this.store.userByUsername(input.username);
    if (!user) throw new Error('Неверный логин или пароль');
    const valid = await comparePassword(input.password, user.passwordHash);
    if (!valid) throw new Error('Неверный логин или пароль');
    if (user.banned) throw new Error('Аккаунт заблокирован администратором');
    const account = accountFromStored(user);
    return { token: this.issueToken(account), account };
  }

  guest(displayNameRaw: string, inviteCode: string | undefined): { token: string; account: Account } {
    if (!this.config.allowGuests) throw new Error('Гостевой вход отключён');
    const displayName = displayNameRaw.trim().slice(0, 32);
    if (displayName.length < 2) throw new Error('Имя должно содержать минимум 2 символа');

    if (this.store.guestInviteRequired) {
      const expected = Buffer.from(this.store.inviteCode);
      const provided = Buffer.from((inviteCode ?? '').trim());
      if (!provided.length) throw new Error('Введите код приглашения');
      if (
        expected.length !== provided.length ||
        !crypto.timingSafeEqual(expected, provided)
      ) {
        throw new Error('Неверный код приглашения');
      }
    }
    if (this.isNameTaken(displayName)) {
      throw new Error('Это имя уже используется');
    }

    const account: Account = {
      id: crypto.randomUUID(),
      username: displayName,
      displayName,
      role: 'guest',
      roleIds: [],
      isGuest: true,
      banned: false,
    };
    return { token: this.issueToken(account), account };
  }

  verifyToken(token: string): Account | null {
    try {
      const payload = jwt.verify(token, this.config.jwtSecret) as TokenPayload;
      // Авторизованный гость сохраняется с тем же id, поэтому его старый токен
      // должен сразу резолвиться в аккаунт участника.
      const user = this.store.userById(payload.sub);
      if (user) {
        if (user.banned) return null;
        return accountFromStored(user);
      }
      if (payload.kind !== 'guest' || !payload.displayName) return null;
      return {
        id: payload.sub,
        username: payload.displayName,
        displayName: payload.displayName,
        role: 'guest',
        roleIds: [],
        isGuest: true,
        banned: false,
      };
    } catch {
      return null;
    }
  }

  private uniqueUsername(displayName: string): string {
    const base = displayName
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '_')
      .replace(/^[_.-]+|[_.-]+$/g, '')
      .slice(0, 20);
    const root = base.length >= 3 ? base : 'guest';
    let candidate = root;
    let suffix = 1;
    while (this.store.userByUsername(candidate)) {
      suffix += 1;
      candidate = `${root}${suffix}`;
    }
    return candidate;
  }

  async authorizeGuest(input: { id: string; displayName: string }): Promise<{
    token: string;
    account: Account;
    username: string;
    password: string;
  }> {
    if (this.store.userById(input.id)) throw new Error('Гость уже авторизован');
    const username = this.uniqueUsername(input.displayName);
    const password = crypto.randomBytes(9).toString('base64url');
    const passwordHash = await hashPassword(password);
    if (this.store.userById(input.id)) throw new Error('Гость уже авторизован');
    const user = this.store.createAuthorizedUser({
      id: input.id,
      username,
      displayName: input.displayName,
      passwordHash,
    });
    const account = accountFromStored(user);
    return { token: this.issueToken(account), account, username, password };
  }
}
