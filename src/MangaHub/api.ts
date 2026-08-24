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
  private readonly accessToken: () => string;

  constructor(accessToken: () => string) {
    this.accessToken = accessToken;
  }

  async query<T>(query: string): Promise<T> {
    const [response, buffer] = await Application.scheduleRequest({
      url: API_URL,
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        // Required for the reader query, which is refused outright when the
        // header is absent. The value itself is not checked.
        "x-mhub-access": this.accessToken(),
        origin: DOMAIN,
        referer: `${DOMAIN}/`,
      },
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
