/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

export class MangaballInterceptor extends PaperbackInterceptor {
  private readonly domain: string;

  constructor(id: string, domain: string) {
    super(id);
    this.domain = domain;
  }

  // The cover and page CDNs answer 403 unless the site is the referer.
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      "user-agent": await Application.getDefaultUserAgent(),
      referer: `${this.domain}/`,
      accept: request.url.includes("/api/v1/") ? "application/json" : "*/*",
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
        /challenge-platform|Attention Required|Just a moment/i.test(body));

    if (challenged) {
      // Each CDN host is its own Cloudflare zone, so the challenge must be
      // solved on that host; the root is enough and avoids one prompt per image.
      const origin = /^https?:\/\/[^/]+/.exec(request.url)?.[0] ?? this.domain;
      throw new CloudflareError(
        {
          url: `${origin}/`,
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
