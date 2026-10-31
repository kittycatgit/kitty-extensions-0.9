/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { DOMAIN } from "./models";

export class ManhwaToonInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      "user-agent": await Application.getDefaultUserAgent(),
      referer: `${DOMAIN}/`,
      "accept-language": "en-US,en;q=0.9",
      ...request.headers,
    };
    // Madara's adult gate; without it 18+ series are hidden from listings.
    request.cookies = { "wpmanga-adault": "1", ...request.cookies };

    return request;
  }

  override async interceptResponse(
    _request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const challenged =
      response.headers?.["cf-mitigated"] === "challenge" ||
      (response.status === 403 &&
        /just a moment|challenge-platform|cf-chl/i.test(Application.arrayBufferToUTF8String(data)));

    if (challenged) {
      // Raise against the site root, never the failing URL, or a burst of
      // failures stacks one bypass window per request.
      throw new CloudflareError(
        {
          url: DOMAIN,
          method: "GET",
          headers: {
            referer: `${DOMAIN}/`,
            "user-agent": await Application.getDefaultUserAgent(),
          },
        },
        "Bot verification detected, bypass it to continue!",
      );
    }

    return data;
  }
}
