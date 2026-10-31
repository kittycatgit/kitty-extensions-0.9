/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { base64Decode, hexDecode, hmacSha256, utf8Decode, utf8Encode } from "./crypto";
import { DOMAIN, HOST } from "./models";

// The reader page ships one encrypted blob (`reader.x`) that names the manifest
// route and its parameters. Its key is derived in the site's app bundle from a
// constant table and the document's tag name, so the bundle is read at runtime
// and that derivation is replayed here instead of pinning a key that would
// rot on the next deploy.

export type ReaderConfig = {
  endpoint: string;
  params: [string, string, string];
  version: number;
  key: string;
  query: string;
};

export function appScriptUrl(html: string): string {
  const match = /<script[^>]+src="([^"]*\/app-[^"]+\.js)"/.exec(html);

  if (!match) {
    throw new Error("The reader page no longer links its app bundle.");
  }

  return match[1]!;
}

type Expression = { target: number; text: string };

// The key function is minified as a comma chain of 32 assignments like
// `l[18]=(ue[58]-ue[105]-210^r.charCodeAt(3))&255`. The arithmetic only uses
// + - ^ with ordinary JS precedence, so a tiny evaluator covers it.
export function deriveKey(bundle: string): Uint8Array {
  const header =
    /function \w*\(\)\{const (\w+)=new Uint8Array\(32\),(\w+)=document\.documentElement\.tagName;return /.exec(
      bundle,
    );

  if (!header) {
    throw new Error("The reader key function was not found in the app bundle.");
  }

  const [, out, tag] = header as unknown as [string, string, string];
  const start = header.index + header[0].length;
  const end = bundle.indexOf(`,${out}}`, start);

  if (end < 0) {
    throw new Error("The reader key function has an unexpected shape.");
  }

  const expressions: Expression[] = [];

  for (const piece of bundle.slice(start, end).split(new RegExp(`,(?=${out}\\[\\d+\\]=)`))) {
    const match = new RegExp(`^${out}\\[(\\d+)\\]=(?:\\((.+)\\)|(.+))&255$`).exec(piece);

    if (!match) {
      throw new Error(`Unreadable reader key assignment: ${piece}`);
    }

    expressions.push({ target: Number(match[1]), text: (match[2] ?? match[3])! });
  }

  if (expressions.length !== 32) {
    throw new Error(`Expected 32 reader key assignments, found ${expressions.length}.`);
  }

  const tableName = /(\w+)\[\d+\]/.exec(expressions[0]!.text)?.[1];
  const table = tableName
    ? new RegExp(`[^\\w$]${tableName}=\\[([\\d,]+)\\]`).exec(bundle)?.[1]
    : undefined;

  if (!tableName || !table) {
    throw new Error("The reader key table was not found in the app bundle.");
  }

  const constants = table.split(",").map(Number);
  const tagName = "HTML";

  const operand = (token: string): number => {
    const index = new RegExp(`^${tableName}\\[(\\d+)\\]$`).exec(token);

    if (index) {
      return constants[Number(index[1])] ?? 0;
    }

    const char = new RegExp(`^${tag}\\.charCodeAt\\((\\d+)\\)$`).exec(token);

    if (char) {
      return tagName.charCodeAt(Number(char[1]));
    }

    if (/^\d+$/.test(token)) {
      return Number(token);
    }

    throw new Error(`Unreadable reader key operand: ${token}`);
  };

  const key = new Uint8Array(32);

  for (const expression of expressions) {
    let value = 0;

    for (const [i, segment] of expression.text.split("^").entries()) {
      const tokens = segment.match(/[+-]|[^+-]+/g) ?? [];
      let sum = operand(tokens[0]!.trim());

      for (let j = 1; j + 1 < tokens.length; j += 2) {
        const right = operand(tokens[j + 1]!.trim());
        sum = tokens[j] === "+" ? sum + right : sum - right;
      }

      value = i === 0 ? sum : value ^ sum;
    }

    key[expression.target] = value & 255;
  }

  return key;
}

export function readerConfig(token: string, chapterId: number, key: Uint8Array): ReaderConfig {
  const chapterKey = hmacSha256(key, utf8Encode(`rk|${HOST}|${chapterId}`));
  const bytes = base64Decode(token);

  for (let offset = 0, block = 0; offset < bytes.length; offset += 32, block++) {
    const mask = hmacSha256(chapterKey, utf8Encode(`ks|${block}`));

    for (let i = 0; i < 32 && offset + i < bytes.length; i++) {
      bytes[offset + i] = bytes[offset + i]! ^ mask[i]!;
    }
  }

  let parsed: { e?: unknown; p?: unknown; v?: unknown; k?: unknown; q?: unknown };

  try {
    parsed = JSON.parse(utf8Decode(bytes)) as typeof parsed;
  } catch {
    throw new Error("The reader token did not decrypt; the site's key derivation changed.");
  }

  const params = Array.isArray(parsed.p) ? (parsed.p as unknown[]) : [];

  if (
    typeof parsed.e !== "string" ||
    params.length !== 3 ||
    !params.every((item) => typeof item === "string") ||
    typeof parsed.v !== "number" ||
    typeof parsed.k !== "string" ||
    typeof parsed.q !== "string"
  ) {
    throw new Error("The reader token has an unexpected shape.");
  }

  return {
    endpoint: parsed.e,
    params: params as [string, string, string],
    version: parsed.v,
    key: parsed.k,
    query: parsed.q,
  };
}

export function manifestUrl(config: ReaderConfig, chapterId: number, slug: string): string {
  return `${DOMAIN}/${config.endpoint}/${chapterId}?${config.params[0]}=${encodeURIComponent(
    slug,
  )}&${config.params[2]}=${encodeURIComponent(config.query)}`;
}

type Manifest = { c: number; e: number; d: string; s: string };
type PageEntry = { n: number; src?: string | null; srcset?: string | null };

// `v` packs two modes: floor(v / 3) is the envelope shape and v % 3 is how the
// page list inside it is encoded (plain, base64, or base64 XOR `key`).
export function manifestPages(body: string, config: ReaderConfig, chapterId: number): string[] {
  const envelope = Math.floor(config.version / 3);
  const encoding = config.version % 3;
  const raw = JSON.parse(body) as unknown;

  let candidate: unknown = raw;

  if (envelope === 1 && Array.isArray(raw)) {
    candidate = { c: raw[0], e: raw[1], d: raw[2], s: raw[3] };
  } else if (envelope === 2 && raw && typeof raw === "object") {
    candidate = (raw as { r?: unknown }).r;
  }

  const manifest = candidate as Partial<Manifest> | null;

  if (
    !manifest ||
    typeof manifest.c !== "number" ||
    typeof manifest.d !== "string" ||
    manifest.c !== chapterId
  ) {
    throw new Error("The chapter manifest has an unexpected shape.");
  }

  let text = manifest.d;

  if (encoding === 1) {
    text = utf8Decode(base64Decode(manifest.d));
  } else if (encoding === 2) {
    const mask = hexDecode(config.key);
    const bytes = base64Decode(manifest.d);

    if (mask.length > 0) {
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = bytes[i]! ^ mask[i % mask.length]!;
      }
    }

    text = utf8Decode(bytes);
  }

  const entries = JSON.parse(text) as unknown;

  if (!Array.isArray(entries)) {
    throw new Error("The chapter manifest holds no page list.");
  }

  return (entries as PageEntry[])
    .filter((entry) => entry && typeof entry.n === "number")
    .sort((a, b) => a.n - b.n)
    .map((entry) => widest(entry.srcset ?? "") || (entry.src ?? "").trim())
    .filter((url) => url.length > 0);
}

// srcset candidates are ordered by the server; pick the largest declared width.
export function widest(srcset: string): string {
  let best = "";
  let width = -1;

  for (const candidate of srcset.split(",")) {
    const [url, size] = candidate.trim().split(/\s+/);
    const parsed = Number((size ?? "").replace(/[^0-9]/g, ""));

    if (url && parsed > width) {
      best = url;
      width = parsed;
    }
  }

  return best;
}
