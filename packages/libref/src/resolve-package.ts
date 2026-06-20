import type { PackageInfo } from "./store.js";

/**
 * Parse a "registry/name[@version]" string (e.g., "npm/next",
 * "pip/django", "npm/next@16.1.7", "npm/@trpc/server@10.0.0").
 * Returns { registry, name, version? } or null if the format is invalid.
 */
export function parseRegistryPackage(input: string): {
  registry: string;
  name: string;
  version?: string;
} | null {
  // Handle scoped packages: npm/@scope/name → registry=npm, name=@scope/name
  const firstSlash = input.indexOf("/");
  if (firstSlash <= 0) return null;

  const registry = input.slice(0, firstSlash);
  let name = input.slice(firstSlash + 1);
  if (!name) return null;

  // Split off an optional trailing "@version". Use lastIndexOf so scoped
  // package names like "@trpc/server" aren't mistaken for a version marker.
  let version: string | undefined;
  const atIdx = name.lastIndexOf("@");
  if (atIdx > 0) {
    const v = name.slice(atIdx + 1);
    if (v) version = v;
    name = name.slice(0, atIdx);
  }
  if (!name) return null;

  return version ? { registry, name, version } : { registry, name };
}

/** Parse a `--libs` spec into name (optionally with @version). */
// Uses lastIndexOf so scoped names like `@trpc/server@1.0.0` split correctly,
// while a bare scoped name `@trpc/server` (leading `@` only) keeps its name.
export function parseLibSpec(spec: string): { name: string; version?: string } {
  const at = spec.lastIndexOf("@");
  if (at <= 0) return { name: spec };
  return { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

/**
 * Resolve a user-typed library spec against the installed packages.
 *
 * Accepts:
 *   - `name` (e.g. `opentofu`) — matches any installed version of `name`.
 *   - `name@version` (e.g. `opentofu@1.12`) — exact name+version match.
 *   - `@scope/name[@version]` (e.g. `@trpc/server@10.0.0`) — scoped names
 *     are kept intact; the leading `@` is treated as part of the name.
 *   - `registry/name[@version]` (e.g. `npm/opentofu@1.12`) — tried as a
 *     fallback when a direct match fails, so a spec copied from
 *     `libref install` works here too.
 *   - A trailing `@` (e.g. `opentofu@`) is treated as no version.
 *   - The SLD or full main domain (e.g. `cloudflare` or `cloudflare.com`)
 *     — tried as a last-resort fallback for bare inputs without a
 *     `@version`, so `cloudflare` matches `developers.cloudflare.com`
 *     when no `cloudflare` package is installed.
 *
 * Returns the matched package, or `null` if no installed package fits.
 */
export function resolveQueryPackage(
  input: string,
  packages: PackageInfo[],
): PackageInfo | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Match the input as a name[@version] first. parseLibSpec keeps a
  // leading "@" attached to scoped names ("@trpc/server@1.0.0" splits on
  // the last "@" only), so this path covers scoped names too.
  const direct = findBySpec(parseLibSpec(trimmed), packages);
  if (direct) return direct;

  // Fall back to stripping a leading "registry/" segment. We only consult
  // parseRegistryPackage here so a scoped name like "@trpc/server" is
  // never misread as registry="@trpc", name="server".
  if (trimmed.indexOf("/") > 0) {
    const registryParsed = parseRegistryPackage(trimmed);
    if (registryParsed) {
      const fromRegistry = findBySpec(
        { name: registryParsed.name, version: registryParsed.version },
        packages,
      );
      if (fromRegistry) return fromRegistry;
    }
  }

  // Last-resort fallback: match the input against the second-level
  // domain (e.g. "cloudflare") or the full main domain ("cloudflare.com")
  // of a package name. Only when the user did not pin a version — a
  // pinned `cloudflare@1.0.0` is a precise spec, not a brand hint.
  if (!parseLibSpec(trimmed).version) {
    const byDomain = packages.find((p) => matchesByDomain(trimmed, p.name));
    if (byDomain) return byDomain;
  }

  return null;
}

function findBySpec(
  spec: { name: string; version?: string },
  packages: PackageInfo[],
): PackageInfo | null {
  if (!spec.name) return null;
  return (
    packages.find((p) => {
      if (p.name !== spec.name) return false;
      if (spec.version && p.version !== spec.version) return false;
      return true;
    }) ?? null
  );
}

/**
 * True when `input` matches the second-level domain or the full main
 * domain of `packageName`. `developers.cloudflare.com` → SLD `cloudflare`,
 * main domain `cloudflare.com`. Names with fewer than two dot-separated
 * labels have no main domain to match against.
 */
function matchesByDomain(input: string, packageName: string): boolean {
  const parts = packageName.split(".");
  if (parts.length < 2) return false;
  const sld = parts[parts.length - 2];
  const tld = parts[parts.length - 1];
  if (!sld || !tld) return false;
  if (input === sld) return true;
  if (input === `${sld}.${tld}`) return true;
  return false;
}
