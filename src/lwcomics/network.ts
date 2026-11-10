/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

export class LwInterceptor extends PaperbackInterceptor {
  private readonly domain: string;

  private readonly stateKey: string;

  // Livewire answers "Your session expired" without the session and XSRF
  // cookies. They are held here rather than in the shared cookie store, which
  // drops entries the moment the app re-reads them.
  private session: Record<string, string>;

  constructor(id: string, domain: string) {
    super(id);
    this.domain = domain;
    this.stateKey = `${id}.session`;

    const stored = Application.getState(this.stateKey);
    this.session =
      stored && typeof stored === "object" ? { ...(stored as Record<string, string>) } : {};
  }

  get sessionCookies(): Readonly<Record<string, string>> {
    return { ...this.session };
  }

  override async interceptRequest(request: Request): Promise<Request> {
    const isImage = !request.url.startsWith(this.domain);

    request.headers = {
      ...request.headers,
      "user-agent": await Application.getDefaultUserAgent(),
      referer: `${this.domain}/`,
      "accept-language": "en-US,en;q=0.9",
    };

    // The CDN is a different host and never needs the session.
    if (!isImage && Object.keys(this.session).length > 0) {
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
        /just a moment|challenge-platform|cf-chl/i.test(Application.arrayBufferToUTF8String(data)));

    if (challenged) {
      // Always raised against the site root: a per-URL challenge stacks one
      // bypass prompt per failing request.
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

    if (response.status !== 200 && response.status !== 419) {
      throw new Error(`Request failed with status ${response.status.toString()}: ${request.url}`);
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
        delete this.session[cookie.name];
        changed = true;
      }
    }

    if (changed) {
      Application.setState({ ...this.session }, this.stateKey);
    }
  }
}
