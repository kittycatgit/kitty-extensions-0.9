/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { DOMAIN, HTML_GAP_MS, READER_TOKEN_HEADER, USER_AGENT, pagesInfoUrl } from "./models";

/**
 * A cross-request lock, module-level so it is shared by every request.
 *
 * This is the one primitive proven to serialise on Paperback's native bridge:
 * the shipped BasicRateLimiter uses exactly this (an identical lock lives in
 * `@paperback/types` but is not re-exported, so it is reproduced here).
 */
const lockPromises: Record<string, Promise<void> | undefined> = {};
const lockResolvers: Record<string, (() => void) | undefined> = {};

async function lock(uid: string): Promise<void> {
  if (lockPromises[uid]) {
    await lockPromises[uid];
    await lock(uid);
    return;
  }

  lockPromises[uid] = new Promise<void>((resolve) => {
    lockResolvers[uid] = () => {
      delete lockPromises[uid];
      resolve();
    };
  });
}

function unlock(uid: string): void {
  const resolver = lockResolvers[uid];
  if (resolver) {
    delete lockResolvers[uid];
    resolver();
  }
}

const HTML_LOCK = "onisaga.htmlFetch";
const LAST_AT_KEY = "onisaga.lastAt";

/**
 * Headers, Cloudflare, and a light hand on browsing - nothing else.
 *
 * Chapter pages are minted in one place, when the chapter opens, inside a
 * WebView. There is deliberately no second way to resolve a page here: a
 * fallback path that quietly takes over is how a chapter ends up loading a page
 * every six seconds with nothing in the log to say why. If minting fails the
 * chapter says so and is opened again, rather than limping along on a slower
 * road nobody chose.
 */
export class OniSagaInterceptor extends PaperbackInterceptor {
  /**
   * Asks the site how long a chapter is and whether it is ready.
   *
   * Used only when the chapter's own page does not say, so an ordinary chapter
   * costs nothing extra and an awkward one still opens.
   */
  async chapterInfo(
    chapterId: string,
    token: string,
  ): Promise<{ total: number; importing: boolean } | undefined> {
    try {
      const [response, buffer] = await Application.scheduleRequest({
        url: pagesInfoUrl(chapterId),
        method: "GET",
        headers: {
          accept: "application/json",
          [READER_TOKEN_HEADER]: token,
          referer: `${DOMAIN}/`,
          "user-agent": USER_AGENT,
        },
      });

      if (response.status !== 200) {
        return undefined;
      }

      const body = JSON.parse(Application.arrayBufferToUTF8String(buffer)) as {
        total_pages?: number;
        importing?: boolean;
      };

      return { total: Number(body.total_pages ?? 0), importing: body.importing === true };
    } catch {
      return undefined;
    }
  }

  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      "user-agent": USER_AGENT,
      referer: `${DOMAIN}/`,
      "accept-language": "en-US,en;q=0.9",
    };

    await this.paceBrowsing(request.url);

    return request;
  }

  /**
   * Spaces ordinary page fetches so a screenful of rails is not asked for all
   * at once. Images are left alone: they are not metered, and their addresses
   * were signed when the chapter opened.
   */
  private async paceBrowsing(url: string): Promise<void> {
    if (!url.startsWith(DOMAIN) || /\/_img\//.test(url)) {
      return;
    }

    await lock(HTML_LOCK);
    try {
      const lastAt = (Application.getState(LAST_AT_KEY) as number | undefined) ?? 0;
      const since = Date.now() - lastAt;

      if (since >= 0 && since < HTML_GAP_MS) {
        await Application.sleep((HTML_GAP_MS - since) / 1000);
      }

      Application.setState(Date.now(), LAST_AT_KEY);
    } finally {
      unlock(HTML_LOCK);
    }
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const challenged =
      response.headers?.["cf-mitigated"] === "challenge" ||
      (response.status === 403 &&
        /just a moment|challenge-platform|cf-chl/i.test(Application.arrayBufferToUTF8String(data)));

    if (challenged) {
      throw new CloudflareError(
        {
          url: DOMAIN,
          method: "GET",
          headers: { referer: `${DOMAIN}/`, "user-agent": USER_AGENT },
        },
        "Bot verification detected, bypass it to continue!",
      );
    }

    if (response.status !== 200) {
      throw new Error(`Request failed with status ${response.status}: ${request.url}`);
    }

    return data;
  }
}
