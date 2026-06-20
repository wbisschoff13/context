/**
 * sitemap.xml discovery for documentation sites that don't publish an
 * llms.txt index. Parses sitemap documents (including sitemap indexes),
 * recurses into nested sitemaps, and returns the deduped URL list.
 */

import { buildFetchOptions, fetchWithTimeout } from "./fetch.js";

export type ParsedSitemap =
  | { kind: "urlset"; urls: string[] }
  | { kind: "index"; sitemaps: string[] }
  | { kind: "empty" };

const LOC_RE = /<(?:[a-z0-9_-]+:)?loc>\s*([^<]+?)\s*<\/(?:[a-z0-9_-]+:)?loc>/gi;
const SITEMAPINDEX_RE = /<(?:[a-z0-9_-]+:)?sitemapindex[\s>]/i;

/**
 * Parse a sitemap XML document. Returns a flat urlset, a sitemap index
 * pointing at nested sitemaps, or `empty` when no URLs were found.
 * Relative `<loc>` values are resolved against `baseUrl`.
 */
export function parseSitemap(xml: string, baseUrl: string): ParsedSitemap {
  const matches = Array.from(xml.matchAll(LOC_RE));
  if (matches.length === 0) return { kind: "empty" };

  const locs: string[] = [];
  for (const m of matches) {
    const raw = m[1]?.trim();
    if (!raw) continue;
    try {
      locs.push(new URL(raw, baseUrl).toString());
    } catch {
      // skip invalid URLs
    }
  }

  if (locs.length === 0) return { kind: "empty" };
  return SITEMAPINDEX_RE.test(xml)
    ? { kind: "index", sitemaps: locs }
    : { kind: "urlset", urls: locs };
}

const SITEMAP_PATHS = ["/sitemap.xml", "/sitemap_index.xml"];

/** Build candidate sitemap URLs to try for a given source URL.
 * Tries both the source's path and the site root, since many sites only
 * publish a single root-level sitemap.xml. */
export function resolveSitemapUrls(source: string): string[] {
  const url = new URL(source);
  const sourceBase = url.origin + url.pathname.replace(/\/$/, "");
  const root = url.origin;
  return [
    ...SITEMAP_PATHS.map((p) => `${sourceBase}${p}`),
    ...SITEMAP_PATHS.map((p) => `${root}${p}`),
  ];
}

export interface FetchSitemapOptions {
  /** Maximum number of concurrent fetches. Default 5. */
  concurrency?: number;
  /** Per-request timeout in milliseconds. Default 30s. */
  timeoutMs?: number;
  /** Maximum number of URLs to return. Default 500. */
  maxUrls?: number;
  /** Custom fetch implementation (for tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Optional logger. */
  log?: (message: string) => void;
}

interface SitemapTask {
  url: string;
}

/**
 * Fetch the sitemap at `sourceUrl`, recursing into sitemap indexes.
 * Returns a deduped list of all URLs found across the sitemap tree.
 * Returns an empty array when no candidate sitemap responds successfully.
 */
export async function fetchSitemapUrls(
  sourceUrl: string,
  options: FetchSitemapOptions = {},
): Promise<string[]> {
  const {
    concurrency = 5,
    timeoutMs = 30_000,
    maxUrls = 500,
    fetchImpl = fetch,
    log,
  } = options;

  const queue: SitemapTask[] = [];
  const seenDocs = new Set<string>();
  const seenSitemaps = new Set<string>();
  const docs: string[] = [];

  for (const candidate of resolveSitemapUrls(sourceUrl)) {
    const parsed = await tryFetchSitemap(candidate, fetchImpl, timeoutMs);
    if (!parsed || parsed.kind === "empty") continue;
    log?.(`✓ Found sitemap at ${candidate}`);
    enqueueSitemap(parsed, queue, seenSitemaps, seenDocs, docs, maxUrls);
    break;
  }

  if (queue.length === 0) return docs.slice(0, maxUrls);

  let next = 0;
  async function worker(): Promise<void> {
    while (next < queue.length) {
      if (docs.length >= maxUrls) return;
      const task = queue[next++];
      if (!task) return;
      const parsed = await tryFetchSitemap(task.url, fetchImpl, timeoutMs);
      if (parsed && parsed.kind !== "empty") {
        enqueueSitemap(parsed, queue, seenSitemaps, seenDocs, docs, maxUrls);
      }
    }
  }

  const workerCount = Math.min(concurrency, queue.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return docs.slice(0, maxUrls);
}

async function tryFetchSitemap(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ParsedSitemap | null> {
  try {
    const response = await fetchWithTimeout(
      fetchImpl,
      url,
      buildFetchOptions(url),
      timeoutMs,
    );
    if (!response.ok) return null;
    const xml = await response.text();
    if (!xml.trim()) return null;
    return parseSitemap(xml, url);
  } catch {
    return null;
  }
}

function enqueueSitemap(
  parsed: ParsedSitemap,
  queue: SitemapTask[],
  seenSitemaps: Set<string>,
  seenDocs: Set<string>,
  docs: string[],
  maxUrls: number,
): void {
  if (parsed.kind === "index") {
    for (const url of parsed.sitemaps) {
      if (seenSitemaps.has(url)) continue;
      seenSitemaps.add(url);
      queue.push({ url });
    }
    return;
  }
  if (parsed.kind === "empty") return;
  for (const url of parsed.urls) {
    if (docs.length >= maxUrls) return;
    if (seenDocs.has(url)) continue;
    seenDocs.add(url);
    docs.push(url);
  }
}
