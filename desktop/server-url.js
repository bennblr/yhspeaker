'use strict';

// Домен платформы: короткое имя «chat» превращается в chat.<domain>.
const DEFAULT_SERVER_DOMAIN = 'la2speak.com';

function isIpv4(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function normalizeServerUrl(value, defaultDomain = DEFAULT_SERVER_DOMAIN) {
  if (typeof value !== 'string') return null;
  let raw = value.trim();
  if (!raw) return null;

  if (!/^https?:\/\//i.test(raw)) {
    const match = /^([^:/?#]+)(:\d+)?([/?#].*)?$/.exec(raw);
    if (!match) return null;
    const [, host, port = '', rest = ''] = match;
    const resolved =
      host.includes('.') || host === 'localhost' || isIpv4(host) || !defaultDomain
        ? host
        : `${host}.${defaultDomain}`;
    raw = `https://${resolved}${port}${rest}`;
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

module.exports = { DEFAULT_SERVER_DOMAIN, normalizeServerUrl };
