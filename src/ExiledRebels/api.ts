/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { API, DOMAIN } from "./models";
import { RateLimitedError } from "./network";

export type Listed<T> = { body: T; totalPages: number };

// WordPress.com rate-limits bursts hard, and the app fires every rail at once
// on a cold start, so every API call goes through one serial queue.
const MIN_GAP_MS = 600;
const BACKOFF_MS = [2_000, 4_000, 8_000, 16_000, 32_000];

let chain: Promise<void> = Promise.resolve();
let lastStart = 0;

function wait(ms: number): Promise<void> {
  return ms > 0 ? Application.sleep(ms / 1000) : Promise.resolve();
}

async function once(url: string): Promise<[Record<string, string>, string]> {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(response.headers ?? {})) {
    headers[name.toLowerCase()] = String(value);
  }
  if (response.status === 429) {
    throw new RateLimitedError(url, headers["retry-after"]);
  }
  return [headers, Application.arrayBufferToUTF8String(buffer)];
}

// One request in flight at a time, at least MIN_GAP_MS between starts, and a
// 429 backs off (Retry-After when the site sends one) before giving up.
function queued(url: string): Promise<[Record<string, string>, string]> {
  const run = async (): Promise<[Record<string, string>, string]> => {
    for (let attempt = 0; ; attempt += 1) {
      await wait(lastStart + MIN_GAP_MS - Date.now());
      lastStart = Date.now();
      try {
        return await once(url);
      } catch (error: unknown) {
        const backoff = BACKOFF_MS[attempt];
        if (!(error instanceof RateLimitedError) || backoff === undefined) {
          throw error;
        }
        await wait(Math.max(backoff, error.retryAfterMs));
      }
    }
  };

  const result = chain.then(run);
  chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export class ExiledRebelsApi {
  async list<T>(resource: string, query: string): Promise<Listed<T>> {
    const [headers, text] = await queued(`${API}/${resource}?${query}`);
    const totalPages = Number(headers["x-wp-totalpages"] ?? "1");
    return {
      body: JSON.parse(text) as T,
      totalPages: Number.isFinite(totalPages) ? totalPages : 1,
    };
  }

  // Walks every page of a list; WordPress caps per_page at 100.
  async all<T>(resource: string, query: string): Promise<T[]> {
    const rows: T[] = [];
    for (let page = 1; ; page += 1) {
      const { body, totalPages } = await this.list<T[]>(resource, `${query}&page=${page}`);
      rows.push(...body);
      if (page >= totalPages || body.length === 0) {
        return rows;
      }
    }
  }

  async html(path: string): Promise<string> {
    const [, text] = await queued(`${DOMAIN}${path}`);
    return text;
  }
}
