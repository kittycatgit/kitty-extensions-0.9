/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

export class SirenInterceptor extends PaperbackInterceptor {
  private readonly domain: string;

  constructor(id: string, domain: string) {
    super(id);
    this.domain = domain;
  }

  override async interceptRequest(request: Request): Promise<Request> {
    const onSite = request.url.startsWith(this.domain);

    request.headers = {
      ...request.headers,
      "user-agent": await Application.getDefaultUserAgent(),
      "accept-language": "en-US,en;q=0.9",
      // Pages and covers live on other hosts that want no site referer.
      ...(onSite ? { referer: `${this.domain}/` } : {}),
    };

    return request;
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const body =
      response.status === 403 || response.status === 503
        ? Application.arrayBufferToUTF8String(data)
        : "";
    const challenged =
      response.headers?.["cf-mitigated"] === "challenge" ||
      /<title>Just a moment\.\.\.<\/title>/i.test(body);

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
