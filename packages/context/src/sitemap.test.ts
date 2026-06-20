import { describe, expect, it, vi } from "vitest";
import {
  fetchSitemapUrls,
  parseSitemap,
  resolveSitemapUrls,
} from "./sitemap.js";

describe("parseSitemap", () => {
  it("parses a urlset with absolute URLs", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/a</loc></url>
  <url><loc>https://example.com/b</loc></url>
</urlset>`;
    const result = parseSitemap(xml, "https://example.com/sitemap.xml");
    expect(result).toEqual({
      kind: "urlset",
      urls: ["https://example.com/a", "https://example.com/b"],
    });
  });

  it("resolves relative loc URLs against baseUrl", () => {
    const xml = `<urlset><url><loc>/docs/a</loc></url></urlset>`;
    const result = parseSitemap(xml, "https://example.com/sitemap.xml");
    expect(result).toEqual({
      kind: "urlset",
      urls: ["https://example.com/docs/a"],
    });
  });

  it("detects a sitemapindex and returns nested sitemap URLs", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemaps/docs.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemaps/blog.xml</loc></sitemap>
</sitemapindex>`;
    const result = parseSitemap(xml, "https://example.com/sitemap.xml");
    expect(result).toEqual({
      kind: "index",
      sitemaps: [
        "https://example.com/sitemaps/docs.xml",
        "https://example.com/sitemaps/blog.xml",
      ],
    });
  });

  it("tolerates namespaced loc tags", () => {
    const xml = `<urlset xmlns:ns="http://example.com/ns"><url><ns:loc>https://example.com/x</ns:loc></url></urlset>`;
    const result = parseSitemap(xml, "https://example.com/sitemap.xml");
    expect(result).toEqual({
      kind: "urlset",
      urls: ["https://example.com/x"],
    });
  });

  it("returns empty when no loc tags are present", () => {
    const xml = `<urlset></urlset>`;
    expect(parseSitemap(xml, "https://example.com/sitemap.xml")).toEqual({
      kind: "empty",
    });
  });

  it("skips URLs that fail to resolve and returns empty if none valid", () => {
    const xml = `<urlset><url><loc>http://[invalid</loc></url></urlset>`;
    expect(parseSitemap(xml, "https://example.com/sitemap.xml")).toEqual({
      kind: "empty",
    });
  });
});

describe("resolveSitemapUrls", () => {
  it("returns candidate paths at the source URL's origin and at the site root", () => {
    expect(resolveSitemapUrls("https://example.com/docs/")).toEqual([
      "https://example.com/docs/sitemap.xml",
      "https://example.com/docs/sitemap_index.xml",
      "https://example.com/sitemap.xml",
      "https://example.com/sitemap_index.xml",
    ]);
  });

  it("dedupes identical source-path and root paths for root URLs", () => {
    expect(resolveSitemapUrls("https://example.com")).toEqual([
      "https://example.com/sitemap.xml",
      "https://example.com/sitemap_index.xml",
      "https://example.com/sitemap.xml",
      "https://example.com/sitemap_index.xml",
    ]);
  });
});

describe("fetchSitemapUrls", () => {
  function jsonResponse(body: string, status = 200): Response {
    return new Response(body, {
      status,
      headers: { "content-type": "application/xml" },
    });
  }

  function notFound(): Response {
    return new Response("not found", { status: 404 });
  }

  it("returns urls from a flat sitemap", async () => {
    const sitemap = `<?xml version="1.0"?>
<urlset><url><loc>https://example.com/docs/a</loc></url><url><loc>https://example.com/docs/b</loc></url></urlset>`;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "https://example.com/sitemap.xml")
        return jsonResponse(sitemap);
      return notFound();
    });

    const urls = await fetchSitemapUrls("https://example.com", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(urls).toEqual([
      "https://example.com/docs/a",
      "https://example.com/docs/b",
    ]);
  });

  it("falls back to sitemap_index.xml when sitemap.xml is 404", async () => {
    const sitemap = `<urlset><url><loc>https://example.com/docs/a</loc></url></urlset>`;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "https://example.com/sitemap.xml") return notFound();
      if (url === "https://example.com/sitemap_index.xml")
        return jsonResponse(sitemap);
      return notFound();
    });

    const urls = await fetchSitemapUrls("https://example.com", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(urls).toEqual(["https://example.com/docs/a"]);
  });

  it("recurses into sitemap indexes", async () => {
    const index = `<?xml version="1.0"?>
<sitemapindex>
  <sitemap><loc>https://example.com/sitemaps/docs.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemaps/blog.xml</loc></sitemap>
</sitemapindex>`;
    const docsSitemap = `<urlset><url><loc>https://example.com/docs/a</loc></url></urlset>`;
    const blogSitemap = `<urlset><url><loc>https://example.com/blog/x</loc></url></urlset>`;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "https://example.com/sitemap.xml") return jsonResponse(index);
      if (url === "https://example.com/sitemaps/docs.xml")
        return jsonResponse(docsSitemap);
      if (url === "https://example.com/sitemaps/blog.xml")
        return jsonResponse(blogSitemap);
      return notFound();
    });

    const urls = await fetchSitemapUrls("https://example.com", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(urls.sort()).toEqual(
      ["https://example.com/docs/a", "https://example.com/blog/x"].sort(),
    );
  });

  it("returns empty when no candidate sitemap responds", async () => {
    const fetchImpl = vi.fn(async () => notFound());
    const urls = await fetchSitemapUrls("https://example.com", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(urls).toEqual([]);
  });

  it("dedupes URLs across nested sitemaps", async () => {
    const index = `<sitemapindex><sitemap><loc>https://example.com/a.xml</loc></sitemap><sitemap><loc>https://example.com/b.xml</loc></sitemap></sitemapindex>`;
    const shared = `<urlset><url><loc>https://example.com/docs/shared</loc></url></urlset>`;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "https://example.com/sitemap.xml") return jsonResponse(index);
      if (url === "https://example.com/a.xml") return jsonResponse(shared);
      if (url === "https://example.com/b.xml") return jsonResponse(shared);
      return notFound();
    });

    const urls = await fetchSitemapUrls("https://example.com", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(urls).toEqual(["https://example.com/docs/shared"]);
  });

  it("respects maxUrls cap", async () => {
    const sitemap = Array.from(
      { length: 50 },
      (_, i) => `<url><loc>https://example.com/p${i}</loc></url>`,
    ).join("");
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "https://example.com/sitemap.xml")
        return jsonResponse(`<urlset>${sitemap}</urlset>`);
      return notFound();
    });

    const urls = await fetchSitemapUrls("https://example.com", {
      maxUrls: 5,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(urls).toHaveLength(5);
  });
});
