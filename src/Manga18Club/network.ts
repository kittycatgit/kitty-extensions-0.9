/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

export class Manga18Interceptor extends PaperbackInterceptor {
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
      origin: this.domain,
    };

    return request;
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    // The site sits behind Cloudflare. Raising a CloudflareError lets the app
    // present its bypass webview; the cookies it collects come back through
    // `cloudflareBypassCompleted`.
    const challenged =
      response.headers?.["cf-mitigated"] === "challenge" ||
      (response.status === 403 &&
        /recaptcha|challenge-platform|Attention Required/i.test(
          Application.arrayBufferToUTF8String(data),
        ));

    if (challenged) {
      throw new CloudflareError(
        {
          url: this.domain,
          method: "GET",
          headers: {
            referer: `${this.domain}/`,
            origin: this.domain,
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
