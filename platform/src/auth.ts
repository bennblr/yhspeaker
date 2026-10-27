import jwt from 'jsonwebtoken';

interface PlatformTokenPayload {
  sub: string;
  kind: 'platform';
  login: string;
}

export class PlatformAuth {
  constructor(
    private readonly secret: string,
    private readonly adminLogin: string,
  ) {}

  sign(): string {
    const payload: PlatformTokenPayload = {
      sub: 'platform-admin',
      kind: 'platform',
      login: this.adminLogin,
    };
    return jwt.sign(payload, this.secret, { expiresIn: '7d' } as jwt.SignOptions);
  }

  verify(token: string): string | null {
    try {
      const payload = jwt.verify(token, this.secret) as PlatformTokenPayload;
      if (payload.kind !== 'platform' || payload.sub !== 'platform-admin') return null;
      if (payload.login !== this.adminLogin) return null;
      return payload.login;
    } catch {
      return null;
    }
  }
}
