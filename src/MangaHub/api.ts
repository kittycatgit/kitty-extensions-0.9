/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { API_URL, DOMAIN } from "./models";

/**
 * Client for the site's GraphQL API.
 *
 * The pages are client rendered and carry no content, so everything is read
 * from the same endpoint the site itself calls.
 */
export class MangaHubApi {
  /** Distinguishes tokens minted within the same millisecond. */
  private minted = 0;

  /**
   * A token nobody has spent yet.
   *
   * The API does not care what this value is, but it counts what each one has
   * done and refuses a token that has done too much - with "API rate limit
   * excessed! Go to mangahub.io to continue reading!", which sounds like the
   * caller is going too fast and is really the token being used up. The site
   * itself gets a new one each visit, which is why reading there never stops.
   *
   * A single token kept in state, as this source used to do, is therefore a
   * token that works for a while and then never works again. Minting one per
   * request is the whole fix.
   */
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
      // Sent as a cookie too, the way the site sends it.
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

/** Escapes a value for inline use in a GraphQL query string. */
export function gqlString(value: string): string {
  return JSON.stringify(value);
}
