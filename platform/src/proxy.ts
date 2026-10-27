import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import type { Request, Response } from 'express';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function clientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? '';
}

function forwardedHeaders(req: http.IncomingMessage, proto: string): Record<string, string> {
  return {
    'x-forwarded-for': clientIp(req),
    'x-forwarded-proto': proto,
    'x-forwarded-host': req.headers.host ?? '',
  };
}

function filterHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const result: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    result[key] = value;
  }
  return result;
}

export function forwardHttp(req: Request, res: Response, port: number): void {
  const headers: http.OutgoingHttpHeaders = {
    ...filterHeaders(req.headers),
    ...forwardedHeaders(req, req.protocol),
  };
  headers.host = req.headers.host;

  const upstream = http.request(
    {
      host: '127.0.0.1',
      port,
      method: req.method,
      path: req.url,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.statusMessage, filterHeaders(upstreamRes.headers));
      upstreamRes.pipe(res);
      upstreamRes.on('error', () => res.destroy());
    },
  );

  upstream.on('error', () => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Сервер временно недоступен');
  });

  req.pipe(upstream);
  res.on('close', () => upstream.destroy());
}

function rawRequestBlock(req: http.IncomingMessage, proto: string): string {
  const lines = [`${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/1.1`];
  const seen = new Set<string>();
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i];
    seen.add(name.toLowerCase());
    lines.push(`${name}: ${req.rawHeaders[i + 1]}`);
  }
  for (const [name, value] of Object.entries(forwardedHeaders(req, proto))) {
    if (!seen.has(name)) lines.push(`${name}: ${value}`);
  }
  return `${lines.join('\r\n')}\r\n\r\n`;
}

export function forwardUpgrade(
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
  port: number,
  proto: string,
): void {
  if (typeof (socket as Duplex & { setNoDelay?: (value: boolean) => void }).setNoDelay === 'function') {
    (socket as Duplex & { setNoDelay: (value: boolean) => void }).setNoDelay(true);
  }
  const upstream = net.connect({ host: '127.0.0.1', port }, () => {
    upstream.write(rawRequestBlock(req, proto));
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });

  upstream.on('error', () => {
    try {
      socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    } catch {
      /* socket already closed */
    }
  });
  upstream.on('close', () => socket.destroy());
  socket.on('close', () => upstream.destroy());
  socket.on('error', () => upstream.destroy());
}
