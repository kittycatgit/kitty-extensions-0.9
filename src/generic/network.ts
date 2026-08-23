/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { MadaraGeneric } from "./main";

export class MadaraInterceptor extends PaperbackInterceptor {
  source: MadaraGeneric;
  promise: Promise<string> | undefined;

  constructor(id: string, source: MadaraGeneric) {
    super(id);
    this.source = source;
  }

  override async interceptRequest(request: Request): Promise<Request> {
    // If it's NOT a directoryRequest
    if (!request.url.includes("#directoryRequest")) {
      if (!this.promise) {
        // If it's NOT a directoryRequest
        if (!request.url.includes("#directoryRequest")) {
          if (!this.promise) {
            this.promise = this.source.getDirectoryPath();
          }

          try {
            const directoryPath = await this.promise;
            request.url = request.url.replace("temp_dirpath", directoryPath);
          } catch (error: unknown) {
            this.promise = undefined;
            throw error;
          }
        }

        request.url = request.url.replace("#directoryRequest", "");
      }

      try {
        const directoryPath = await this.promise!;
        request.url = request.url.replace("temp_dirpath", directoryPath);
      } catch (error: unknown) {
        this.promise = undefined;
        throw error;
      }
    }

    request.url = request.url.replace("#directoryRequest", "");

    request.headers = {
      ...request.headers,
      "user-agent": this.source.userAgent ?? (await Application.getDefaultUserAgent()),
      referer: `${this.source.domain}/`,
      origin: `${this.source.domain}/`,
      ...((request.url.includes("wordpress.com") || request.url.includes("wp.com")) && {
        Accept: "image/avif,image/webp,*/*",
      }),
    };

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
    const cfMitigated = response.headers?.["cf-mitigated"];
    const isRecaptcha =
      response.status === 403 && Application.arrayBufferToUTF8String(data).includes("recaptcha");

    if (cfMitigated === "challenge" || isRecaptcha) {
      throw new CloudflareError(
        {
          url: this.source.bypassPage ? this.source.bypassPage : this.source.domain,
          method: "GET",
          headers: {
            referer: `${this.source.domain}/`,
            origin: `${this.source.domain}/`,
            "user-agent": await Application.getDefaultUserAgent(),
          },
        },
        "Bot verification detected, bypass it to continue!",
      );
    }

    if (response.status !== 200) {
      if (response.status === 404 && request.url.includes(this.source.searchPagePathName)) {
        return data;
      }
      throw new Error(`Request failed with status ${response.status}: ${request.url}`);
    }

    return data;
  }
}
