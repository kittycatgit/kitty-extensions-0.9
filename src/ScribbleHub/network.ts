/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

export class ScribbleHubInterceptor extends PaperbackInterceptor {
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
      "accept-language": "en-US,en;q=0.9",
    };

    return request;
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const body = response.status === 200 ? "" : Application.arrayBufferToUTF8String(data);
    const challenged =
      response.headers?.["cf-mitigated"] === "challenge" ||
      ((response.status === 403 || response.status === 503) &&
        /challenge-platform|Attention Required|Just a moment|cf-error/i.test(body));

    if (challenged) {
      // Chapter pages (/read/…) carry a check of their own that the front page's clearance does not cover, so the bypass
      // opens the chapter page itself; everything else shares one canonical URL so concurrent failures coalesce.
      throw new CloudflareError(
        {
          url: /\/read\//.test(request.url) ? request.url : this.domain,
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
