/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

const SESSION_STATE_KEY = "hiperdex.session";

export class HiperDexInterceptor extends PaperbackInterceptor {
  private readonly domain: string;

  // Every API procedure answers 401 without these. Tracked here rather than in
  // the shared cookie store, which drops entries by expiry date.
  private session: Record<string, string>;

  constructor(id: string, domain: string) {
    super(id);
    this.domain = domain;

    const stored = Application.getState(SESSION_STATE_KEY);
    this.session =
      stored && typeof stored === "object" ? { ...(stored as Record<string, string>) } : {};
  }

  get hasSession(): boolean {
    return Object.keys(this.session).length > 0;
  }

  get sessionCookies(): Readonly<Record<string, string>> {
    return { ...this.session };
  }

  override async interceptRequest(request: Request): Promise<Request> {
    const isImage = /r2d2storage\.com/i.test(request.url);

    request.headers = {
      ...request.headers,
      "user-agent": await Application.getDefaultUserAgent(),
      referer: `${this.domain}/`,
      "accept-language": "en-US,en;q=0.9",
      accept: isImage
        ? "image/avif,image/webp,image/*,*/*;q=0.8"
        : "application/json,text/plain,*/*",
    };

    // Images come from a separate host that never sees these cookies.
    if (!isImage && this.hasSession) {
      request.cookies = { ...request.cookies, ...this.session };
    }

    return request;
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    this.rememberSession(response);

    const challenged =
      response.headers?.["cf-mitigated"] === "challenge" ||
      (response.status === 403 &&
        /just a moment|challenge-platform|attention required|cf-chl/i.test(
          Application.arrayBufferToUTF8String(data),
        ));

    if (challenged) {
      // Point every challenge at the domain root, never the URL that failed:
      // one shared URL collapses concurrent failures into a single prompt.
      throw new CloudflareError(
        {
          url: this.domain,
          method: "GET",
          headers: {
            referer: `${this.domain}/`,
            "user-agent": await Application.getDefaultUserAgent(),
          },
        },
        "Bot verification detected, bypass it to continue!",
      );
    }

    // 401 and 403 carry a JSON body the API client reads, so let them through.
    if (response.status !== 200 && response.status !== 401 && response.status !== 403) {
      throw new Error(`Request failed with status ${response.status}: ${request.url}`);
    }

    return data;
  }

  private rememberSession(response: Response): void {
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
        // An empty value is how the server clears a cookie.
        delete this.session[cookie.name];
        changed = true;
      }
    }

    if (changed) {
      Application.setState({ ...this.session }, SESSION_STATE_KEY);
    }
  }

  setCookie(name: string, value: string): void {
    if (!name || !value || this.session[name] === value) {
      return;
    }

    this.session[name] = value;
    Application.setState({ ...this.session }, SESSION_STATE_KEY);
  }
}
