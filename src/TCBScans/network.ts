/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { DOMAIN, USER_AGENT } from "./models";

/**
 * Headers and bot verification - nothing else.
 *
 * The site serves plain pages and its artwork off an ordinary content host,
 * with nothing signed, counted or rationed, so there is no pacing to do here.
 */
export class TCBScansInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      "user-agent": USER_AGENT,
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

    // One challenge, raised against the site itself rather than whichever page
    // happened to meet it - asking per page stacks several at once.
    if (challenged) {
      throw new CloudflareError(
        {
          url: DOMAIN,
          method: "GET",
          headers: { referer: `${DOMAIN}/`, "user-agent": USER_AGENT },
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
