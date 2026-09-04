/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  CloudflareError,
  type Tag,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";
import * as cheerio from "cheerio";

import { browseUrl, DOMAIN } from "./models";
import { parseGenres } from "./parsers";

export class SilentQuillInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      "user-agent": await Application.getDefaultUserAgent(),
      // Pages are served from a separate CDN that wants the site's referer.
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

// No try/catch: a Cloudflare challenge here has to reach the app so it can
// raise its bypass instead of leaving the picker silently empty.
export async function fetchGenres(): Promise<Tag[]> {
  const [, buffer] = await Application.scheduleRequest({
    url: browseUrl(1, "update"),
    method: "GET",
  });

  return parseGenres(cheerio.load(Application.arrayBufferToUTF8String(buffer)));
}
