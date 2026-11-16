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

/** Text without tags or entities, whitespace collapsed. */
export function plainText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** <meta property="og:image" content="…"> and friends. */
export function metaContent(html: string, names: string[]): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
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
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return t ? plainText(t) || null : null;
}
