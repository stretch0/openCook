import type { ImportResult } from '@opencook/schemas';
import { metaContent, pageTitle, plainText } from './html.js';
import { findRecipeNode, jsonLdBlocks, recipeFromNode } from './jsonld.js';
import { type SafeFetchOptions, safeFetch } from './safe-fetch.js';

/** Reads a recipe out of a page's HTML. `url` makes relative links absolute. */
export function parseRecipePage(html: string, url: string): ImportResult {
  const node = findRecipeNode(jsonLdBlocks(html));
  const ogImage = metaContent(html, [
    'og:image',
    'og:image:url',
    'twitter:image',
  ]);
  const siteName = metaContent(html, ['og:site_name', 'application-name']);
  const absolute = (u: string | null) => {
    if (!u) return null;
    try {
      return new URL(u, url).toString();
    } catch {
      return null;
    }
  };

  if (node) {
    const r = recipeFromNode(node);
    const imageUrl = absolute(r.imageUrl) ?? absolute(ogImage);
    return {
      found: true,
      recipe: {
        title: r.title,
        description: r.description,
        servings: r.servings ?? 4,
        prepMinutes: r.prepMinutes,
        cookMinutes: r.cookMinutes,
        cuisine: r.cuisine,
        tags: r.tags,
        visibility: 'private',
        sourceUrl: url,
        sourceName:
          siteName ?? r.author ?? new URL(url).hostname.replace(/^www\./, ''),
        imageUrl,
        ingredients: r.ingredients,
        steps: r.steps,
      },
      pageTitle: pageTitle(html),
      pageText: null,
      imageUrl,
    };
  }

  // No structured recipe (often social posts): hand back the words on the
  // page, starting with the post's caption, for an agent to read.
  const caption = metaContent(html, [
    'og:description',
    'description',
    'twitter:description',
  ]);
  const text = [caption, plainText(bodyOf(html))]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 20_000);
  return {
    found: false,
    recipe: null,
    pageTitle: metaContent(html, ['og:title']) ?? pageTitle(html),
    pageText: text || null,
    imageUrl: absolute(ogImage),
  };
}

/** Fetches a page and reads the recipe on it. */
export async function importRecipeFromUrl(
  url: string,
  options: SafeFetchOptions = {},
): Promise<ImportResult> {
  const page = await safeFetch(url, {
    accept: 'text/html,application/xhtml+xml',
    maxBytes: 5 * 1024 * 1024,
    ...options,
  });
  if (!/html|xml|text\/plain/i.test(page.contentType) && page.contentType) {
    return {
      found: false,
      recipe: null,
      pageTitle: null,
      pageText: null,
      imageUrl: /^image\//.test(page.contentType) ? page.url : null,
    };
  }
  return parseRecipePage(new TextDecoder().decode(page.body), page.url);
}

/** The page's <body>, or the whole page if it has none. */
function bodyOf(html: string): string {
  const lower = html.toLowerCase();
  const start = lower.indexOf('<body');
  const end = lower.lastIndexOf('</body>');
  return start >= 0 && end > start ? html.slice(start, end) : html;
}
