/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { DOMAIN } from "./models";

export class MangaFoxInterceptor extends PaperbackInterceptor {
  // Mutated in place as well as returned: the app hands every interceptor the original request and keeps only the
  // last one's return value, so headers added to a copy here were lost once the cookie interceptor ran, and the image
  // CDN refuses any request without a fanfox referer (blank pages in the reader).
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      referer: `${DOMAIN}/`,
      "user-agent": await Application.getDefaultUserAgent(),
    };
    request.cookies = { ...request.cookies, isAdult: "1" };
    return request;
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const cfMitigated = response.headers?.["cf-mitigated"];
    if (cfMitigated === "challenge") {
      throw new CloudflareError({
        url: `${DOMAIN}/`,
        method: request.method ?? "GET",
        headers: {
          "user-agent": await Application.getDefaultUserAgent(),
        },
      });
    }

    return data;
  }
}
