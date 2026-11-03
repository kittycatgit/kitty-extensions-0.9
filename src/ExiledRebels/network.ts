/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { PaperbackInterceptor, type Request, type Response } from "@paperback/types";

import { DOMAIN } from "./models";

const BROWSER_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export class RateLimitedError extends Error {
  readonly retryAfterMs: number;

  constructor(url: string, retryAfter: string | undefined) {
    super(`The site answered 429 for ${url}`);
    this.name = "RateLimitedError";
    const seconds = Number(retryAfter);
    this.retryAfterMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
  }
}

export class ExiledRebelsInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      // WordPress.com answers 429 to the app's own "Paperback/… CFNetwork" agent
      // on the large page-body queries; a browser agent is never limited.
      "user-agent": BROWSER_UA,
      referer: `${DOMAIN}/`,
      "accept-language": "en-US,en;q=0.9",
    };

    return request;
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    // 429 is handed back untouched: an error thrown here reaches the caller as
    // a plain Error, so the retry logic in api.ts checks the status itself.
    if (response.status !== 200 && response.status !== 429) {
      throw new Error(`Request failed with status ${response.status}: ${request.url}`);
    }

    return data;
  }
}
