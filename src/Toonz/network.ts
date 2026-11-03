/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

// The archive hides explicit titles unless the adult gate was accepted; both
// cookies the site sets for that are sent so the app's own rating filter
// decides what is shown.
const ADULT_COOKIES: Record<string, string> = {
  adult_ok: "1",
  reader_prefs: encodeURIComponent(
    JSON.stringify({ rating: "pornographic", types: [], blockedGenres: [] }),
  ),
};

export class ToonzInterceptor extends PaperbackInterceptor {
  private readonly domain: string;

  constructor(id: string, domain: string) {
    super(id);
    this.domain = domain;
  }

  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      "user-agent": await Application.getDefaultUserAgent(),
      referer: `${this.domain}/`,
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
    };

    if (request.url.startsWith(this.domain)) {
      request.cookies = { ...ADULT_COOKIES, ...request.cookies };
    }

    return request;
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    // Series, chapter and ranking pages sit behind a managed challenge; raising
    // a CloudflareError keyed to the domain lets the app solve it once.
    const body = response.status === 200 ? "" : Application.arrayBufferToUTF8String(data);
    const challenged =
      response.headers?.["cf-mitigated"] === "challenge" ||
      (response.status === 403 &&
        /cf-mitigated|challenge-platform|Just a moment|Attention Required/i.test(body));

    if (challenged) {
      throw new CloudflareError(
        {
          url: this.domain,
          method: "GET",
          headers: {
            referer: `${this.domain}/`,
            "user-agent": await Application.getDefaultUserAgent(),
          },
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
