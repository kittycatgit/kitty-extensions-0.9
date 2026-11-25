/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { API_URL, CHAPTER_CRYPTO_URL, DOMAIN } from "./models";
import type { MangaHubInterceptor } from "./network";

/** A key the site issues for one access token, good for a few minutes. */
type ChapterKeys = { token: string; keys: Record<string, string>; expiresAt: number };

// The site's pages are client rendered and carry no content; it all comes from GraphQL.
export class MangaHubApi {
  private minted = 0;
  private own = "";
  private chapterKeys: ChapterKeys | null = null;

  constructor(private readonly interceptor: MangaHubInterceptor) {}

  /**
   * The site issues one access token per visit and sends it as both the
   * `mhub_access` cookie and the `x-mhub-access` header; the API rejects a request
   * whose header and cookie disagree. So the token the site gave us wins, and one
   * of our own is minted only until it does.
   */
  private token(): string {
    const issued = this.interceptor.accessToken;

    if (issued) {
      return issued;
    }

    if (!this.own) {
      this.own = Application.crypto_md5Hash(`mangahub-${Date.now()}-${(this.minted += 1)}`);
    }

    return this.own;
  }

  /** Drops our token so the next request mints another. */
  private rotate(): void {
    this.own = "";
    this.chapterKeys = null;
  }

  async query<T>(query: string, token: string = this.token()): Promise<T> {
    const [response, buffer] = await Application.scheduleRequest({
      url: API_URL,
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        // The site issues this and the API checks it - see MangaHubInterceptor.
        "x-mhub-access": token,
        origin: DOMAIN,
        referer: `${DOMAIN}/`,
      },
      // The same token has to go out as a cookie as well as a header.
      cookies: { mhub_access: token },
      body: JSON.stringify({ query }),
    });

    const body = Application.arrayBufferToUTF8String(buffer);

    let payload: { data?: T; errors?: { message?: string }[] };
    try {
      payload = JSON.parse(body) as { data?: T; errors?: { message?: string }[] };
    } catch {
      throw new Error(
        `The API replied with something that was not JSON (status ${response.status})`,
      );
    }

    if (payload.errors?.length) {
      const message = payload.errors.map((error) => error.message ?? "unknown").join("; ");

      // The API counts what each token has done and eventually retires it.
      if (/rate limit/i.test(message)) {
        this.rotate();
      }

      throw new Error(message);
    }

    if (!payload.data) {
      throw new Error(`The API returned no data (status ${response.status})`);
    }

    return payload.data;
  }

  /**
   * Runs a chapter query. The site switches page-list encryption on and off: on,
   * the API answers "Chapter encryption unavailable" until the token holds a key
   * from /api/chapter-crypto and the page list arrives as `enc:v1:<keyId>:...`;
   * off, that endpoint answers 503 chapter_crypto_disabled and the page list is
   * plain JSON. So the query goes out first and a key is fetched only when the
   * answer asks for one. Returns the keys the answer is encrypted with, if any.
   */
  async queryChapter<T extends { chapter?: { pages?: string | null } }>(
    query: string,
  ): Promise<{ data: T; keys: Record<string, string> }> {
    let session =
      this.chapterKeys && this.chapterKeys.expiresAt > Date.now() + 30_000
        ? this.chapterKeys
        : null;

    for (let attempt = 0; ; attempt += 1) {
      let data: T;

      try {
        data = await this.query<T>(query, session?.token ?? this.token());
      } catch (error) {
        this.chapterKeys = null;

        // Encryption is on and this token holds no key (or one the site has rotated
        // away from): a fresh key and a second try fix it.
        if (attempt < 2 && /chapter encryption/i.test(String((error as Error)?.message ?? error))) {
          session = await this.chapterSession();
          continue;
        }

        throw error;
      }

      const keyId = encryptedKeyId(data.chapter?.pages);

      if (keyId !== null && attempt < 2 && !session?.keys[keyId]) {
        this.chapterKeys = null;
        session = await this.chapterSession();
        continue;
      }

      return { data, keys: session?.keys ?? {} };
    }
  }

  private async chapterSession(): Promise<ChapterKeys> {
    if (this.chapterKeys && this.chapterKeys.expiresAt > Date.now() + 30_000) {
      return this.chapterKeys;
    }

    const token = this.token();
    const [response, buffer] = await Application.scheduleRequest({
      url: CHAPTER_CRYPTO_URL,
      method: "GET",
      headers: {
        accept: "application/json",
        "x-mhub-access": token,
        referer: `${DOMAIN}/`,
      },
      cookies: { mhub_access: token },
    });

    const body = Application.arrayBufferToUTF8String(buffer);

    let payload: {
      keyId?: string;
      key?: string;
      keys?: Record<string, string>;
      expiresAt?: number;
    };
    try {
      payload = JSON.parse(body) as typeof payload;
    } catch {
      throw new Error(`The site did not hand out a chapter key (status ${response.status})`);
    }

    const keys = { ...payload.keys };
    if (payload.keyId && payload.key) {
      keys[payload.keyId] = payload.key;
    }

    if (Object.keys(keys).length === 0) {
      throw new Error(`The site handed out no chapter key (status ${response.status})`);
    }

    this.chapterKeys = {
      token,
      keys,
      expiresAt: typeof payload.expiresAt === "number" ? payload.expiresAt : Date.now() + 300_000,
    };

    return this.chapterKeys;
  }
}

/** The key id an `enc:<version>:<keyId>:...` page list names; null for a plain one. */
function encryptedKeyId(pages: unknown): string | null {
  if (typeof pages !== "string" || !pages.startsWith("enc:")) {
    return null;
  }

  return pages.split(":")[2] ?? "";
}

export function gqlString(value: string): string {
  return JSON.stringify(value);
}
