import { importRecipeFromUrl, parseRecipePage } from './import.js';
import { isoMinutes, servingsFrom } from './jsonld.js';
import { isPrivateAddress, safeFetch } from './safe-fetch.js';

const recipePage = `<!doctype html><html><head>
<title>Best Banana Bread | Example Kitchen</title>
<meta property="og:site_name" content="Example Kitchen">
<meta property="og:image" content="/img/og.jpg">
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"WebSite","name":"Example Kitchen"},
  {"@type":["Recipe"],"name":"Best Banana Bread",
   "description":"Moist &amp; easy.",
   "recipeYield":["8","8 slices"],
   "prepTime":"PT15M","totalTime":"PT1H15M",
   "recipeCuisine":["American"],
   "keywords":"baking, bread, Banana",
   "image":[{"@type":"ImageObject","url":"https://cdn.example.com/bread.jpg"}],
   "recipeIngredient":["3 ripe bananas","250g plain flour","1 tsp bicarbonate of soda"],
   "recipeInstructions":[
     {"@type":"HowToSection","name":"Batter","itemListElement":[
       {"@type":"HowToStep","text":"Mash the bananas."},
       {"@type":"HowToStep","text":"Stir in the flour &amp; soda."}]},
     {"@type":"HowToStep","text":"Bake for 1 hour at 180&deg;C."}
   ]}
]}
</script></head><body><h1>Best Banana Bread</h1></body></html>`;

describe('parseRecipePage', () => {
  it('reads a schema.org recipe inside @graph', () => {
    const result = parseRecipePage(
      recipePage,
      'https://example.com/banana-bread',
    );
    expect(result.found).toBe(true);
    expect(result.recipe).toMatchObject({
      title: 'Best Banana Bread',
      description: 'Moist & easy.',
      servings: 8,
      prepMinutes: 15,
      cookMinutes: 60,
      cuisine: 'American',
      tags: ['baking', 'bread', 'banana'],
      sourceName: 'Example Kitchen',
      sourceUrl: 'https://example.com/banana-bread',
      imageUrl: 'https://cdn.example.com/bread.jpg',
      ingredients: [
        '3 ripe bananas',
        '250g plain flour',
        '1 tsp bicarbonate of soda',
      ],
      steps: [
        'Mash the bananas.',
        'Stir in the flour & soda.',
        'Bake for 1 hour at 180°C.',
      ],
    });
  });

  it('hands back the caption and text when there is no structured recipe', () => {
    const html = `<html><head><meta property="og:title" content="Chef on Instagram">
      <meta property="og:description" content="Pasta! 200g spaghetti, 2 eggs...">
      <meta property="og:image" content="https://cdn.example.com/p.jpg"></head>
      <body><script>var x=1</script><p>Comments</p></body></html>`;
    const result = parseRecipePage(html, 'https://social.example/p/1');
    expect(result).toMatchObject({
      found: false,
      recipe: null,
      pageTitle: 'Chef on Instagram',
      imageUrl: 'https://cdn.example.com/p.jpg',
    });
    expect(result.pageText).toContain('200g spaghetti');
    expect(result.pageText).not.toContain('var x');
  });

  it('splits instructions given as one block of text', () => {
    const html = `<script type="application/ld+json">{"@type":"Recipe","name":"X",
      "recipeInstructions":"1. Boil water. 2. Add pasta."}</script>`;
    expect(parseRecipePage(html, 'https://e.com').recipe?.steps).toEqual([
      'Boil water.',
      'Add pasta.',
    ]);
  });
});

describe('helpers', () => {
  it('reads durations and yields', () => {
    expect(isoMinutes('PT1H30M')).toBe(90);
    expect(isoMinutes('P0DT0H20M')).toBe(20);
    expect(isoMinutes('nonsense')).toBeNull();
    expect(servingsFrom('Serves 4-6')).toBe(4);
    expect(servingsFrom(2)).toBe(2);
    expect(servingsFrom(undefined)).toBeNull();
  });

  it('knows private addresses', () => {
    for (const a of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.1.1',
      '172.20.0.1',
      '169.254.169.254',
      '::1',
      'fd00::1',
      '::ffff:10.0.0.1',
      '100.64.0.1',
    ]) {
      expect(isPrivateAddress(a)).toBe(true);
    }
    for (const a of ['93.184.216.34', '2606:4700::1111', '172.32.0.1']) {
      expect(isPrivateAddress(a)).toBe(false);
    }
  });
});

describe('safeFetch', () => {
  const publicDns = async () => ['93.184.216.34'];

  it('refuses private addresses, including after a redirect', async () => {
    await expect(safeFetch('http://127.0.0.1/admin')).rejects.toThrow(
      /public internet/,
    );
    await expect(safeFetch('http://localhost:3000/')).rejects.toThrow(
      /public internet/,
    );
    await expect(safeFetch('file:///etc/passwd')).rejects.toThrow(/http/);
    const fetchImpl = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/' },
      })) as typeof fetch;
    await expect(
      safeFetch('https://example.com/', { fetchImpl, resolve: publicDns }),
    ).rejects.toThrow(/public internet/);
  });

  it('limits the size of what it reads', async () => {
    const fetchImpl = (async () =>
      new Response('x'.repeat(2000))) as typeof fetch;
    await expect(
      safeFetch('https://example.com/', {
        fetchImpl,
        resolve: publicDns,
        maxBytes: 1000,
      }),
    ).rejects.toThrow(/too large/);
  });

  it('imports a page end to end', async () => {
    const fetchImpl = (async () =>
      new Response(recipePage, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })) as typeof fetch;
    const result = await importRecipeFromUrl(
      'https://example.com/banana-bread',
      {
        fetchImpl,
        resolve: publicDns,
      },
    );
    expect(result.recipe?.title).toBe('Best Banana Bread');
  });
});

describe('hostile pages', () => {
  it('stays fast on pages built to make regular expressions backtrack', () => {
    const started = Date.now();
    parseRecipePage('<svg'.repeat(50_000), 'https://e.com');
    parseRecipePage('<title'.repeat(50_000), 'https://e.com');
    parseRecipePage('<body'.repeat(50_000), 'https://e.com');
    parseRecipePage(
      '<script type="application/ld+json"'.repeat(20_000),
      'https://e.com',
    );
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('drops scripts, styles and comments from page text', () => {
    const html =
      '<body><p>Keep</p><script>bad()</script><SCRIPT>also()</SCRIPT><style>x{}</style><!-- note --><p>this</p></body>';
    const result = parseRecipePage(html, 'https://e.com');
    expect(result.pageText).toBe('Keep\nthis');
  });
});
