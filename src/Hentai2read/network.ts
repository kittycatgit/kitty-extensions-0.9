/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

export class Hentai2readInterceptor extends PaperbackInterceptor {
  private readonly domain: string;

  constructor(id: string, domain: string) {
    super(id);
    this.domain = domain;
  }

  override async interceptRequest(request: Request): Promise<Request> {
    // Per-request headers win: the JSON endpoints need their own Accept.
    request.headers = {
      "user-agent": await Application.getDefaultUserAgent(),
      referer: `${this.domain}/`,
      accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      ...request.headers,
    };

    return request;
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const headers = response.headers ?? {};
    const mitigated = headers["cf-mitigated"] ?? headers["Cf-Mitigated"];
    const body = response.status === 200 ? "" : Application.arrayBufferToUTF8String(data);
    const challenged =
      mitigated === "challenge" ||
      ((response.status === 403 || response.status === 503) &&
        /challenge-platform|Just a moment|Attention Required|cf-browser-verification/i.test(body));

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
