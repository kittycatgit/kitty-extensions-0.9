/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { PaperbackInterceptor, type Request, type Response } from "@paperback/types";

import { imageToken } from "./auth";

export class SuwayomiInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const token = imageToken(request.url);

    if (token) {
      request.headers = { ...request.headers, authorization: `Bearer ${token}` };
    }

    return request;
  }

  override async interceptResponse(
    _request: Request,
    _response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    return data;
  }
}
