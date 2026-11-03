/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

const FAMILY_CDN = /(^|\.)(poke-black-and-white\.net|red-and-blue\.net)$/i;

export class LGBToonInterceptor extends PaperbackInterceptor {
  private readonly domain: string;

  constructor(id: string, domain: string) {
    super(id);
    this.domain = domain;
  }

  // The site's own CDN refuses images without a site referer, while the
  // third-party hosts some chapters sit on refuse images with one.
  override async interceptRequest(request: Request): Promise<Request> {
    const host = /^https?:\/\/([^/]+)/.exec(request.url)?.[1] ?? "";
    const ownHost = request.url.startsWith(this.domain) || FAMILY_CDN.test(host);

    request.headers = {
      ...request.headers,
      "user-agent": await Application.getDefaultUserAgent(),
      ...(ownHost ? { referer: `${this.domain}/` } : {}),
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
      (response.status === 403 && /Just a moment|challenge-platform|cf_chl_opt/i.test(body));

    if (challenged) {
      // The site itself is open; the challenge lives on the image CDN, so the
      // bypass has to be solved against whichever origin refused us.
      const origin = request.url.startsWith(this.domain)
        ? this.domain
        : (/^https?:\/\/[^/]+/.exec(request.url)?.[0] ?? this.domain);

      throw new CloudflareError(
        {
          url: origin,
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
