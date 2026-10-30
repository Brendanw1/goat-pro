/**
 * Cloudflare R2 client for fetching private analytics data.
 * Uses S3-compatible API. Server-side only — never import in client components.
 */

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
}

/**
 * Optional key prefix (R2_PREFIX), namespacing goat-pro's keys inside the
 * bucket. Set it whenever the bucket is shared with another app: the fork must
 * never read or overwrite another surface's keys. Trailing slashes are trimmed.
 */
export function keyPrefix(): string {
  const raw = process.env.R2_PREFIX ?? "";
  return raw ? `${raw.replace(/\/+$/, "")}/` : "";
}

export function getConfig(): R2Config {
  const config: R2Config = {
    accountId: process.env.R2_ACCOUNT_ID!,
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    bucket: process.env.R2_BUCKET_NAME!,
    endpoint: process.env.R2_ENDPOINT!,
  };

  // Validate at startup
  for (const [key, value] of Object.entries(config)) {
    if (!value) {
      throw new Error(`Missing R2 config: ${key}. Check .env.local`);
    }
  }

  return config;
}

/**
 * Generate AWS Signature v4 authorization header for R2.
 * Uses Web Crypto API (available in Node 20+ and Edge runtime).
 */
export async function sign(
  method: string,
  path: string,
  config: R2Config,
): Promise<Headers> {
  const now = new Date();
  const dateStr = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 8);
  const timeStr = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const region = "auto";
  const service = "s3";
  const scope = `${dateStr}/${region}/${service}/aws4_request`;

  // `path` arrives already prefixed (callers build it with keyPrefix()); signing it twice 403s with SignatureDoesNotMatch.
  const url = new URL(`${config.endpoint}/${config.bucket}/${path}`);
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-date": timeStr,
    "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
  };

  // Canonical request
  const signedHeaderKeys = Object.keys(headers).sort();
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalHeaders = signedHeaderKeys
    .map((k) => `${k}:${headers[k]}\n`)
    .join("");
  const canonicalRequest = [
    method,
    url.pathname,
    url.search.slice(1),
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  // String to sign
  const encoder = new TextEncoder();
  const canonicalHash = await crypto.subtle
    .digest("SHA-256", encoder.encode(canonicalRequest))
    .then((buf) =>
      Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    );

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timeStr,
    scope,
    canonicalHash,
  ].join("\n");

  // Signing key
  async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      key,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  }

  let signingKey: ArrayBuffer = await hmac(
    encoder.encode(`AWS4${config.secretAccessKey}`),
    dateStr,
  );
  signingKey = await hmac(signingKey, region);
  signingKey = await hmac(signingKey, service);
  signingKey = await hmac(signingKey, "aws4_request");

  const signature = Array.from(
    new Uint8Array(await hmac(signingKey, stringToSign)),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const result = new Headers();
  result.set("Authorization", authorization);
  result.set("x-amz-date", timeStr);
  result.set("x-amz-content-sha256", "UNSIGNED-PAYLOAD");

  return result;
}

/**
 * Parsed large files, per server instance: Next's data cache refuses entries
 * over 2 MB, so `revalidate: 300` never held hitters.json (21 MB), pitchers.json
 * (13 MB), splits/hitters.json (26 MB) or spray_points.json (36 MB), and every
 * request downloaded and re-parsed them. Kept for the same 5 minutes, least
 * recently used out, bounded by BYTES (JSON text; parsed heap is ~2.5x), not by
 * count: a count of 4 let one /arsenal view (seven 2.6-12 MB files) or one
 * hitter profile (five) cycle the whole cache, so every view of either missed
 * and evicted hitters/pitchers for the next page. 128 MB of text holds a hitter
 * profile's set (pitchers + hitters + splits/hitters + spray_points = 96 MB)
 * with room for arsenal/ff; a file over 40 MB is never held, so one giant file
 * cannot empty it. Smaller files stay with Next's cache. A failed fetch never
 * lands here.
 *
 * Local mode (USE_LOCAL_DATA) uses the same cache, keyed also on the file's
 * mtime, so a re-bake shows on the next request and dev measures what prod does.
 *
 * Concurrent requests for one file share one download (`inflight`): a profile
 * asks for pitchers.json from three loaders at once. Waiters on a small file
 * each parse their own copy, as before; waiters on a large one share the parse.
 *
 * Callers share these objects across requests and must not mutate them.
 */
const NEXT_CACHE_MAX_BYTES = 2 * 1024 * 1024;
const PARSED_TTL_MS = 5 * 60_000;
const PARSED_MAX_BYTES = 128 * 1024 * 1024;
const PARSED_FILE_MAX_BYTES = 40 * 1024 * 1024;
type Parsed = { at: number; data: unknown; bytes: number; mtime: number | null };
const parsed = new Map<string, Parsed>();
type Loaded = { data: unknown } | { text: string } | null;
const inflight = new Map<string, Promise<Loaded>>();

function keep(path: string, data: unknown, bytes: number, mtime: number | null) {
  parsed.delete(path);
  if (bytes > PARSED_FILE_MAX_BYTES) return;
  parsed.set(path, { at: Date.now(), data, bytes, mtime });
  let total = 0;
  for (const e of parsed.values()) total += e.bytes;
  for (const [k, e] of parsed) {
    if (total <= PARSED_MAX_BYTES) break;
    parsed.delete(k);
    total -= e.bytes;
  }
}

/** Text in, the shared parse out when large (and kept), the text when small. */
function settle(path: string, text: string, mtime: number | null, shared: boolean): Loaded {
  if (!shared && text.length <= NEXT_CACHE_MAX_BYTES) return { text };
  const data = JSON.parse(text);
  keep(path, data, text.length, mtime);
  return { data };
}

/** Route-level checks (defence in depth on top of safeKey): MLBAM ids are digits, seasons are four digits. */
export const isId = (id: string | undefined | null): id is string => !!id && /^\d+$/.test(id);
export const isSeason = (s: string | undefined | null): s is string => !!s && /^\d{4}$/.test(s);
const BAD = () => Response.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
/** 404 when id or (required/optional) season is malformed; null when the input is fine. */
export function badInput(id: string, season?: string | null, required = true): Response | null {
  if (!isId(id)) return BAD();
  if (season == null || season === "") return required ? BAD() : null;
  return isSeason(season) ? null : BAD();
}

/**
 * Object keys come from request input (player ids, seasons, levels). URL parsing resolves `..` and drops `#`, and the
 * signature covers the normalised path, so an unchecked key could climb out of the prefix and the bucket (security
 * audit C1, 2026-10-30). Every baked key is [A-Za-z0-9_.-] segments; anything else is refused as not found.
 */
export function safeKey(path: string): boolean {
  return /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)*$/.test(path) && !path.split("/").some((seg) => seg === "." || seg === "..");
}

async function localFile(path: string): Promise<string> {
  const { join } = await import("path");
  // goat-pro's web bakes live in data/export/web/ (pipeline/web_export.py), one
  // level under the pipeline artifacts so the derived files can be gitignored
  // as a unit.
  return join(process.cwd(), "..", "data", "export", "web", path);
}

async function download(path: string, shared: boolean): Promise<Loaded> {
  if (process.env.USE_LOCAL_DATA === "true") {
    try {
      const fs = await import("fs/promises");
      const file = await localFile(path);
      const mtime = (await fs.stat(file)).mtimeMs;
      return settle(path, await fs.readFile(file, "utf-8"), mtime, shared);
    } catch {
      return null;
    }
  }

  const config = getConfig();
  const full = `${keyPrefix()}${path}`;
  const url = `${config.endpoint}/${config.bucket}/${full}`;
  const headers = await sign("GET", full, config);

  const response = await fetch(url, {
    method: "GET",
    headers,
    // Cache for 5 minutes on the server (ISR-like behavior)
    next: { revalidate: 300 },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error(`[r2] ${response.status} ${response.statusText} for ${path}: ${detail.slice(0, 200)}`);
    throw new Error(
      `R2 fetch failed: ${response.status} ${response.statusText} for ${path}`,
    );
  }

  return settle(path, await response.text(), null, shared);
}

async function cachedHit(path: string): Promise<Parsed | null> {
  const hit = parsed.get(path);
  if (!hit || Date.now() - hit.at >= PARSED_TTL_MS) return null;
  if (hit.mtime !== null) {
    const fs = await import("fs/promises");
    const mtime = await fs.stat(await localFile(path)).then((s) => s.mtimeMs, () => null);
    if (mtime !== hit.mtime) return null;
  }
  parsed.delete(path);
  parsed.set(path, hit);
  return hit;
}

/**
 * Fetch a JSON file from R2. Returns parsed JSON or null if not found.
 *
 * In dev mode with USE_LOCAL_DATA=true, reads from the local export directory
 * instead of making R2 network calls (much faster iteration).
 *
 * `shared` holds a small file in the parsed cache too, so its object identity is
 * stable while the file is unchanged (a memo keyed on it then invalidates by
 * itself); the caller must not mutate it.
 */
export async function fetchFromR2<T>(path: string, opts: { shared?: boolean } = {}): Promise<T | null> {
  if (!safeKey(path)) return null;
  const hit = await cachedHit(path);
  if (hit) return hit.data as T;

  let p = inflight.get(path);
  if (!p) {
    p = download(path, opts.shared === true).finally(() => inflight.delete(path));
    inflight.set(path, p);
  }
  const loaded = await p;
  if (loaded === null) return null;
  if ("data" in loaded) return loaded.data as T;
  try {
    return JSON.parse(loaded.text) as T;
  } catch (e) {
    // Local mode answered a bad file with null before; R2 mode threw.
    if (process.env.USE_LOCAL_DATA === "true") return null;
    throw e;
  }
}

/**
 * One object, streamed, optionally in its compressed form.
 *
 * `fetchFromR2` buffers and `JSON.parse`s, which is right for a 50 KB profile
 * and wrong for a Stuff+ booster. Three reasons, and the first is a hard
 * platform limit:
 *
 * 1. **The 4.5 MB response cap.** A Vercel serverless function that BUILDS its
 *    response body is capped at 4.5 MB. Nine of the sixteen v5 boosters are over
 *    it — `whiff_SL_vs_RHH.json` is 13.8 MB — so `NextResponse.json(model)`
 *    cannot return them in production at all. ADR-002 sized this proxy for
 *    "<200KB per request" and the 2026-08-27 retrain took the round count from
 *    400 to as many as 4,000. Streaming is not subject to that cap: the function
 *    forwards bytes instead of producing them.
 *
 * 2. **Compression.** These artifacts gzip 3.7x — 13.78 MB to 3.74 MB, and the
 *    whole set from 101 MB to 28 MB. `scripts/stage-stuff-models.sh` writes a
 *    `.json.gz` beside each booster and only the compressed copy is uploaded, so
 *    callers ask for the `.gz` path and this reports which form it served.
 *    Truncating the models instead was measured and rejected: at 400 rounds a
 *    third of pitchers move 5+ grade points (scripts/measure_booster_rounds.py).
 *
 * 3. **Memory for nothing.** Parsing 13.8 MB of JSON into an object graph and
 *    re-serialising it, to emit the bytes that arrived, costs the function ~10x
 *    the payload in heap. The route never looks inside the model.
 *
 * Returns null when neither form exists, so callers keep the "not staged" branch
 * they already have.
 */
export interface R2Stream {
  stream: ReadableStream<Uint8Array>;
  /** True when the bytes are gzip and the caller must declare or undo it. */
  gzipped: boolean;
  /** Upstream's byte count, when it gave one. */
  contentLength: string | null;
}

export async function streamFromR2(path: string): Promise<R2Stream | null> {
  if (!safeKey(path)) return null;
  // ONE candidate, and the caller names it — including the `.gz` suffix when it
  // wants the compressed copy.
  //
  // This first tried `${path}.gz` and fell back to `${path}`, which reads as
  // helpful and is not: `upload-to-r2.sh` uses `rclone copy`, which never
  // deletes, so the bucket still holds the pre-retrain plain boosters from
  // 2026-08-26. A fallback would answer a missing `.gz` with a two-day-old
  // model — a silent wrong grade where a 404 would have said "not staged" and
  // named the command that fixes it.
  const candidates = [path];

  if (process.env.USE_LOCAL_DATA === "true") {
    const fs = await import("fs");
    const localPath = await import("path");
    const { Readable } = await import("node:stream");
    for (const candidate of candidates) {
      const filePath = localPath.join(process.cwd(), "..", "data", "export", "web", candidate);
      if (!fs.existsSync(filePath)) continue;
      // Streams here too rather than being the one mode that buffers, so dev and
      // production exercise the same code path. `Readable.toWeb` returns
      // node:stream/web's ReadableStream, structurally the DOM one but not the
      // same declared type — hence the cast.
      const web = Readable.toWeb(fs.createReadStream(filePath));
      return {
        stream: web as unknown as ReadableStream<Uint8Array>,
        gzipped: candidate.endsWith(".gz"),
        contentLength: String(fs.statSync(filePath).size),
      };
    }
    return null;
  }

  const config = getConfig();
  for (const candidate of candidates) {
    const full = `${keyPrefix()}${candidate}`;
    const url = `${config.endpoint}/${config.bucket}/${full}`;
    const headers = await sign("GET", full, config);
    const response = await fetch(url, { method: "GET", headers });
    if (response.status === 404) continue;
    if (!response.ok) {
      throw new Error(
        `R2 stream failed: ${response.status} ${response.statusText} for ${candidate}`,
      );
    }
    if (response.body === null) continue;
    return {
      stream: response.body,
      gzipped: candidate.endsWith(".gz"),
      contentLength: response.headers.get("content-length"),
    };
  }
  return null;
}

/**
 * A gzipped-or-plain JSON object, parsed. For server-side consumers that need
 * the object rather than the bytes.
 *
 * `DecompressionStream` is web-standard and present in both the Node and Edge
 * runtimes, so the same call works wherever the route runs.
 */
export async function fetchGzippedJson<T>(path: string): Promise<T | null> {
  const upstream = await streamFromR2(path);
  if (upstream === null) return null;
  // The cast is the DOM lib's: DecompressionStream declares
  // WritableStream<BufferSource> where pipeThrough wants
  // WritableStream<Uint8Array>, and BufferSource is the wider type.
  const body = upstream.gzipped
    ? upstream.stream.pipeThrough(
        new DecompressionStream("gzip") as unknown as ReadableWritablePair<
          Uint8Array, Uint8Array
        >,
      )
    : upstream.stream;
  return new Response(body).json() as Promise<T>;
}

/**
 * List objects in a prefix. Useful for discovering available player profiles.
 */
export async function listR2Objects(
  prefix: string,
): Promise<string[]> {
  const config = getConfig();
  const path = `?list-type=2&prefix=${encodeURIComponent(prefix)}`;
  const full = `${keyPrefix()}${path}`;
  const url = `${config.endpoint}/${config.bucket}/${full}`;
  const headers = await sign("GET", full, config);

  const response = await fetch(url, { method: "GET", headers });

  if (!response.ok) {
    throw new Error(`R2 list failed: ${response.status}`);
  }

  const text = await response.text();
  // Parse XML response for <Key> elements
  const keys: string[] = [];
  const regex = /<Key>([^<]+)<\/Key>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    keys.push(match[1]);
  }
  return keys;
}
