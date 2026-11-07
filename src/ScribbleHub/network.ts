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
    const title = /<title[^>]*>([^<]*)/i.exec(body)?.[1] ?? "";
    // A block page ("Attention Required!") embeds Cloudflare's challenge script too, so the title decides: only a real
    // challenge page gets the bypass; a firewall block has nothing to solve.
    const blocked =
      response.status === 403 &&
      (/attention required|access denied/i.test(title) || /you have been blocked/i.test(body));
    const challenged =
      !blocked &&
      (response.headers?.["cf-mitigated"] === "challenge" || /just a moment/i.test(title));

    if (challenged) {
      // One canonical URL so concurrent failures coalesce into a single bypass.
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
    if (blocked) {
      // A firewall rule, not a challenge: there is nothing a bypass could solve.
      throw new Error(`ScribbleHub's firewall refused this request: ${request.url}`);
    }

    if (response.status !== 200) {
      throw new Error(`Request failed with status ${response.status}: ${request.url}`);
    }

    return data;
  }
}
