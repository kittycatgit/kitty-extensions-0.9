/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { DOMAIN } from "./models";

/**
 * Everything this source asks of the site, and nothing about what comes back.
 *
 * This deliberately does no work on responses. Fetching, queueing, how many
 * requests are in flight, what happens when one fails and when to ask again are
 * all the app's, and the app is the only part that knows which page a reader is
 * looking at. Earlier versions of this source retried refused images here, held
 * responses open waiting for them, and fetched pages ahead of the reader - each
 * of those ran inside the app's own request queue and fought the scheduler that
 * owns it, which is what left readers staring at a chapter stuck at nothing
 * loaded. A source's job is to say where a page is and how to ask for it.
 *
 * The one response this does read is a Cloudflare challenge, and only because
 * raising it is how the app is told to offer its bypass. Saying nothing there
 * would leave the source looking broken with no way to put it right.
 */
export class ZinMangaInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      "user-agent": await Application.getDefaultUserAgent(),
      // The image hosts refuse a request with no referer outright, whatever the
      // user agent is; with the site's own referer they serve it.
      referer: `${DOMAIN}/`,
      "accept-language": "en-US,en;q=0.9",
    };

    // What the site sets on itself once a reader confirms they want adult
    // titles; without them a part of the catalogue is simply missing.
    request.cookies = {
      ...request.cookies,
      "toonily-mature": "1",
      "wpmanga-adault": "1",
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
        /just a moment|challenge-platform|attention required|cf-chl/i.test(
          Application.arrayBufferToUTF8String(data),
        ));

    if (challenged) {
      // Raised against the site root rather than the URL that happened to meet
      // it, so several failing at once collapse into one prompt instead of
      // stacking a bypass window per request.
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
