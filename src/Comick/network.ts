/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { currentSession } from "./auth";
import { API, DOMAIN, LIBRARY } from "./models";

export class ComickInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const session = request.url.startsWith(LIBRARY) ? currentSession() : undefined;

    request.headers = {
      "user-agent": await Application.getDefaultUserAgent(),
      accept: "application/json",
      referer: `${DOMAIN}/`,
      ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}),
      ...request.headers,
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
      // Raise against the API root, never the failing URL, or a burst of
      // failures stacks one bypass window per request.
      throw new CloudflareError(
        {
          url: request.url.startsWith(API) ? API : DOMAIN,
          method: "GET",
          headers: { "user-agent": await Application.getDefaultUserAgent() },
        },
        "Bot verification detected, bypass it to continue!",
      );
    }

    return data;
  }
}
