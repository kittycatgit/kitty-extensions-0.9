/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { ACCESS_STATE_KEY, DOMAIN } from "./models";

/** The cookie the site issues and mirrors into its API header. */
const ACCESS_COOKIE = "mhub_access";

export class MangaHubInterceptor extends PaperbackInterceptor {
  private session: Record<string, string>;

  constructor(id: string) {
    super(id);

    const stored = Application.getState(ACCESS_STATE_KEY);
    this.session =
      stored && typeof stored === "object" ? { ...(stored as Record<string, string>) } : {};
  }

  /**
   * The value sent as `x-mhub-access`.
   *
   * The site mirrors its own `mhub_access` cookie into that header. The API
   * only checks that the header is present, not what it holds, so a locally
   * generated value works until the site issues a real one — which keeps the
   * reader working without a token baked into the build.
   */
  get accessToken(): string {
    const issued = this.session[ACCESS_COOKIE];
    if (issued) {
      return issued;
    }

    const generated = Application.crypto_md5Hash(`mangahub-${Date.now()}`);
    this.session[ACCESS_COOKIE] = generated;
    Application.setState({ ...this.session }, ACCESS_STATE_KEY);

    return generated;
  }

  override async interceptRequest(request: Request): Promise<Request> {
    const isImage = /mghcdn\.com/i.test(request.url) && !/api\./i.test(request.url);

    request.headers = {
      ...request.headers,
      "user-agent": await Application.getDefaultUserAgent(),
      referer: `${DOMAIN}/`,
      "accept-language": "en-US,en;q=0.9",
      ...(isImage ? { accept: "image/avif,image/webp,image/*,*/*;q=0.8" } : {}),
    };

    if (!isImage) {
      request.cookies = { ...request.cookies, ...this.session };
    }

    return request;
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    this.rememberCookies(response);

    const challenged =
      response.headers?.["cf-mitigated"] === "challenge" ||
      (response.status === 403 &&
        /just a moment|challenge-platform|attention required|cf-chl/i.test(
          Application.arrayBufferToUTF8String(data),
        ));

    if (challenged) {
      // Resolve every challenge against the site root rather than the URL that
      // happened to fail, so concurrent failures collapse into one prompt
      // instead of stacking a separate bypass per request.
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

    if (response.status !== 200) {
      throw new Error(`Request failed with status ${response.status}: ${request.url}`);
    }

    return data;
  }

  private rememberCookies(response: Response): void {
    let changed = false;

    for (const cookie of response.cookies ?? []) {
      if (!cookie.name) {
        continue;
      }

      if (cookie.value) {
        if (this.session[cookie.name] !== cookie.value) {
          this.session[cookie.name] = cookie.value;
          changed = true;
        }
      } else if (cookie.name in this.session) {
        delete this.session[cookie.name];
        changed = true;
      }
    }

    if (changed) {
      Application.setState({ ...this.session }, ACCESS_STATE_KEY);
    }
  }

  /** Stores a cookie collected by the Cloudflare bypass webview. */
  setCookie(name: string, value: string): void {
    if (!name || !value || this.session[name] === value) {
      return;
    }

    this.session[name] = value;
    Application.setState({ ...this.session }, ACCESS_STATE_KEY);
  }

  get cookies(): Readonly<Record<string, string>> {
    return { ...this.session };
  }
}
