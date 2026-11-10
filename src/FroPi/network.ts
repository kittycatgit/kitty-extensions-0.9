/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { PaperbackInterceptor, type Request, type Response } from "@paperback/types";

const DOMAIN = "https://fropi.net";

export class FroPiInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      "user-agent": await Application.getDefaultUserAgent(),
      // The media hosts answer 403 without the site as referer, which otherwise
      // shows up as a reader full of blank pages.
      referer: `${DOMAIN}/`,
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
    if (response.status !== 200) {
      throw new Error(`Request failed with status ${response.status.toString()}: ${request.url}`);
    }

    return data;
  }
}
