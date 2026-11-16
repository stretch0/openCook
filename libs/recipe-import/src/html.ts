const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  deg: '°',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
  times: '×',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n =
        code[1].toLowerCase() === 'x'
          ? parseInt(code.slice(2), 16)
          : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000
        ? String.fromCodePoint(n)
        : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

export type Element = {
  /** Everything between the tag name and the `>`, e.g. ` type="…"`. */
  attrs: string;
  inner: string;
  start: number;
  end: number;
};

/**
 * Every `<tag …>…</tag>` in the page, in order. Found with indexOf rather
 * than a regular expression, so a hostile page can't make it slow.
 */
export function elements(html: string, tag: string): Element[] {
  const lower = html.toLowerCase();
  const open = `<${tag.toLowerCase()}`;
  const close = `</${tag.toLowerCase()}`;
  const out: Element[] = [];
  let pos = 0;
  for (;;) {
    const start = lower.indexOf(open, pos);
    if (start < 0) break;
    const after = lower[start + open.length] ?? '';
    if (after && !/[\s>/]/.test(after)) {
      pos = start + open.length;
      continue;
    }
    const gt = lower.indexOf('>', start);
    if (gt < 0) break;
    const closeAt = lower.indexOf(close, gt);
    if (closeAt < 0) break;
    const closeGt = lower.indexOf('>', closeAt);
    const end = closeGt < 0 ? html.length : closeGt + 1;
    out.push({
      attrs: html.slice(start + open.length, gt),
      inner: html.slice(gt + 1, closeAt),
      start,
      end,
    });
    pos = end;
  }
  return out;
}

/** The page with these elements (and HTML comments) cut out. */
function withoutElements(html: string, tags: string[]): string {
  const ranges = tags
    .flatMap((t) => elements(html, t))
    .map((e) => [e.start, e.end] as const);
  let pos = 0;
  for (;;) {
    const start = html.indexOf('<!--', pos);
    if (start < 0) break;
    const end = html.indexOf('-->', start + 4);
    ranges.push([start, end < 0 ? html.length : end + 3]);
    pos = end < 0 ? html.length : end + 3;
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let out = '';
  let last = 0;
  for (const [start, end] of ranges) {
    if (start < last) {
      last = Math.max(last, end);
      continue;
    }
    out += html.slice(last, start) + ' ';
    last = end;
  }
  return out + html.slice(last);
}

/** Text without tags or entities, whitespace collapsed. */
export function plainText(html: string): string {
  return decodeEntities(
    withoutElements(html, ['script', 'style', 'noscript', 'svg', 'template'])
      .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)\b[^<>]*>/gi, '\n')
      .replace(/<[^<>]+>/g, ' '),
  )
    .replace(/[ \t\f\v\r]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

/** <meta property="og:image" content="…"> and friends. */
export function metaContent(html: string, names: string[]): string | null {
  for (const tag of html.match(/<meta\b[^<>]*>/gi) ?? []) {
    const key = tag.match(
      /\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i,
    )?.[1];
    if (key && names.includes(key.toLowerCase())) {
      const content = tag.match(
        /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i,
      );
      const value = content?.[1] ?? content?.[2];
      if (value) return decodeEntities(value).trim();
    }
  }
  return null;
}

export function pageTitle(html: string): string | null {
  const t = elements(html, 'title')[0]?.inner;
  return t ? plainText(t) || null : null;
}
