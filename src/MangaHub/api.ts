/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { API_URL, DOMAIN } from "./models";

// The site's pages are client rendered and carry no content; it all comes from GraphQL.
export class MangaHubApi {
  private minted = 0;

  // The API counts what each token has done and then rejects it with "API rate limit
  // excessed!", so mint a fresh one per request the way the site does per visit.
  private freshToken(): string {
    this.minted += 1;

    return Application.crypto_md5Hash(`mangahub-${Date.now()}-${this.minted}`);
  }

  async query<T>(query: string): Promise<T> {
    const token = this.freshToken();
    const [response, buffer] = await Application.scheduleRequest({
      url: API_URL,
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        // The site issues this and the API checks it - see MangaHubInterceptor.
        "x-mhub-access": token,
        origin: DOMAIN,
        referer: `${DOMAIN}/`,
      },
      // The same token has to go out as a cookie as well as a header.
      cookies: { mhub_access: token },
      body: JSON.stringify({ query }),
    });

    const body = Application.arrayBufferToUTF8String(buffer);

    let payload: { data?: T; errors?: { message?: string }[] };
    try {
      payload = JSON.parse(body) as { data?: T; errors?: { message?: string }[] };
    } catch {
      throw new Error(
        `The API replied with something that was not JSON (status ${response.status})`,
      );
    }

    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message ?? "unknown").join("; "));
    }

    if (!payload.data) {
      throw new Error(`The API returned no data (status ${response.status})`);
    }

    return payload.data;
  }
}

export function gqlString(value: string): string {
  return JSON.stringify(value);
}
