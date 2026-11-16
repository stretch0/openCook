import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class FetchError extends Error {}

export type SafeFetchOptions = {
  /** Largest response body to read, in bytes. */
  maxBytes?: number;
  timeoutMs?: number;
  accept?: string;
  /**
   * Allow addresses on private networks. Off by default, so links can't be
   * used to reach things inside the server's network.
   */
  allowPrivate?: boolean;
  /** For tests. */
  fetchImpl?: typeof fetch;
  /** For tests: resolves a hostname to addresses. */
  resolve?: (host: string) => Promise<string[]>;
};

export type FetchedBody = {
  url: string;
  contentType: string;
  body: Uint8Array;
};

const USER_AGENT =
  'Mozilla/5.0 (compatible; openCook recipe import; +https://github.com/stretch0/openCook)';

/**
 * Fetches a URL someone gave us (a recipe page, a photo). Only http(s), only
 * public addresses unless allowed, redirects checked hop by hop, and the body
 * size and time are limited.
 */
export async function safeFetch(
  input: string,
  {
    maxBytes = 5 * 1024 * 1024,
    timeoutMs = 15_000,
    accept = '*/*',
    allowPrivate = false,
    fetchImpl = fetch,
    resolve = defaultResolve,
  }: SafeFetchOptions = {},
): Promise<FetchedBody> {
  let url = new URL(input);
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop < 6; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new FetchError('Only http and https links can be imported.');
    }
    if (url.username || url.password) {
      throw new FetchError(
        'Links with a username or password are not allowed.',
      );
    }
    if (!allowPrivate) await assertPublic(url.hostname, resolve);

    let res: Response;
    try {
      res = await fetchImpl(url, {
        redirect: 'manual',
        signal,
        headers: { accept, 'user-agent': USER_AGENT, 'accept-language': 'en' },
      });
    } catch (e) {
      throw new FetchError(
        `Couldn't reach ${url.hostname}: ${e instanceof Error ? e.message : e}`,
      );
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location') as string, url);
      await res.body?.cancel();
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new FetchError(`${url.hostname} answered ${res.status}.`);
    }
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > maxBytes) {
      await res.body?.cancel();
      throw new FetchError('That page is too large to import.');
    }
    return {
      url: url.toString(),
      contentType: res.headers.get('content-type') ?? '',
      body: await readLimited(res, maxBytes),
    };
  }
  throw new FetchError('Too many redirects.');
}

async function readLimited(res: Response, maxBytes: number) {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new FetchError('That page is too large to import.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

async function defaultResolve(host: string) {
  return (await lookup(host, { all: true })).map((a) => a.address);
}

async function assertPublic(
  hostname: string,
  resolve: (host: string) => Promise<string[]>,
) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal')
  ) {
    throw new FetchError('That address is not on the public internet.');
  }
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await resolve(host);
  } catch {
    throw new FetchError(`Couldn't find ${host}.`);
  }
  if (!addresses.length || addresses.some(isPrivateAddress)) {
    throw new FetchError('That address is not on the public internet.');
  }
}

/** Loopback, private, link-local and other non-public ranges, IPv4 and IPv6. */
export function isPrivateAddress(address: string): boolean {
  let a = address.toLowerCase();
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) a = mapped[1];
  if (isIP(a) === 4) {
    const [p, q] = a.split('.').map(Number);
    return (
      p === 0 ||
      p === 10 ||
      p === 127 ||
      (p === 100 && q >= 64 && q <= 127) ||
      (p === 169 && q === 254) ||
      (p === 172 && q >= 16 && q <= 31) ||
      (p === 192 && q === 168) ||
      (p === 192 && q === 0) ||
      (p === 198 && (q === 18 || q === 19)) ||
      p >= 224
    );
  }
  return (
    a === '::' ||
    a === '::1' ||
    a.startsWith('fc') ||
    a.startsWith('fd') ||
    a.startsWith('fe8') ||
    a.startsWith('fe9') ||
    a.startsWith('fea') ||
    a.startsWith('feb') ||
    a.startsWith('ff') ||
    a.startsWith('64:ff9b:')
  );
}
