/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { DOMAIN, HTML_GAP_MS, READER_TOKEN_HEADER, USER_AGENT, pagesInfoUrl } from "./models";

// Copied from BasicRateLimiter: the same lock exists in @paperback/types but is
// not exported, and it is the only primitive that serialises on the native bridge.
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

// Page URLs are minted only in the WebView when the chapter opens. Do not add a
// fallback resolver here - it takes over silently and refetches every few seconds.
export class OniSagaInterceptor extends PaperbackInterceptor {
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

  // Images are skipped: they are not metered and their URLs were already signed
  // when the chapter opened.
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
