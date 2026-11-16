import { createHash } from 'node:crypto';
import { secureHeaders } from 'hono/secure-headers';
import type { Config } from './config.js';

/**
 * Headers that keep browsers from running anything openCook didn't send, from
 * framing it on another site, and (on HTTPS) from ever using plain HTTP.
 *
 * `indexHtml` is the built web app's page: its inline script (the theme, set
 * before the first paint) is allowed by hash, so no other inline script runs.
 */
export function securityHeaders(config: Config, indexHtml?: string) {
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", ...inlineScriptHashes(indexHtml ?? '')],
      styleSrc: ["'self'", "'unsafe-inline'"],
      // blob: previews a photo before it's uploaded; https: shows an imported
      // recipe's photo before it's saved (and downloaded) here.
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'"],
      workerSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    xFrameOptions: 'DENY',
    referrerPolicy: 'strict-origin-when-cross-origin',
    strictTransportSecurity: config.origin.startsWith('https:')
      ? 'max-age=31536000'
      : false,
  });
}

/** 'sha256-…' sources for each inline <script> in the page. */
export function inlineScriptHashes(html: string) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .filter((body) => body.trim())
    .map(
      (body) =>
        `'sha256-${createHash('sha256').update(body).digest('base64')}'`,
    );
}
