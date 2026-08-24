/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

/**
 * Client for the site's tRPC API.
 *
 * The site is a client-rendered single page app: its HTML carries no content,
 * so everything here is read from the same JSON API the page itself calls.
 */

/** Marker for a reply the API refused because the reader token was rejected. */
export class ReaderForbiddenError extends Error {}

/** Marker for a reply the API refused because no session cookie was sent. */
export class UnauthorisedError extends Error {}

type TrpcEnvelope = {
  result?: { data?: { json?: unknown } };
  error?: { json?: { message?: string; data?: { httpStatus?: number } } };
};

/**
 * Drops keys whose value is undefined.
 *
 * The API validates its input with a schema that rejects an explicit `null`
 * for an optional field, so an unset filter has to be absent from the object
 * rather than present and empty.
 */
export function compact<T extends Record<string, unknown>>(input: T): Partial<T> {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null) {
      output[key] = value;
    }
  }

  return output as Partial<T>;
}

export class HiperDexApi {
  private readonly domain: string;

  /** Set once a session cookie has been picked up, to avoid re-priming. */
  private primed = false;

  constructor(domain: string) {
    this.domain = domain;
  }

  private url(procedure: string, input: unknown): string {
    // tRPC reads a batch of one, keyed by position, with the payload wrapped
    // in `json` for its transformer.
    const payload = encodeURIComponent(JSON.stringify({ 0: { json: input ?? null } }));
    return `${this.domain}/api/trpc/${procedure}?batch=1&input=${payload}`;
  }

  /**
   * Fetches the site root purely for its `Set-Cookie`.
   *
   * Every procedure answers 401 without the anonymous session cookie the root
   * document issues, so a cold extension has to collect it before its first
   * call. The cookie interceptor stores whatever comes back.
   */
  async primeSession(): Promise<void> {
    await Application.scheduleRequest({ url: `${this.domain}/`, method: "GET" });
    this.primed = true;
  }

  /**
   * Calls a procedure, priming the session once if the API reports the request
   * as unauthenticated.
   */
  async query<T>(procedure: string, input: unknown, headers?: Record<string, string>): Promise<T> {
    try {
      return await this.request<T>(procedure, input, headers);
    } catch (error: unknown) {
      if (!(error instanceof UnauthorisedError) || this.primed) {
        throw error;
      }

      await this.primeSession();
      return await this.request<T>(procedure, input, headers);
    }
  }

  private async request<T>(
    procedure: string,
    input: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const [response, buffer] = await Application.scheduleRequest({
      url: this.url(procedure, input),
      method: "GET",
      ...(headers ? { headers } : {}),
    });

    const body = Application.arrayBufferToUTF8String(buffer);

    if (response.status === 401) {
      throw new UnauthorisedError(`${procedure} requires a session`);
    }

    let envelopes: TrpcEnvelope[];
    try {
      envelopes = JSON.parse(body) as TrpcEnvelope[];
    } catch {
      throw new Error(`${procedure} returned a reply that was not JSON`);
    }

    const envelope = Array.isArray(envelopes) ? envelopes[0] : (envelopes as TrpcEnvelope);

    if (envelope?.error) {
      const message = envelope.error.json?.message ?? "unknown error";
      const status = envelope.error.json?.data?.httpStatus;

      if (status === 401) {
        throw new UnauthorisedError(`${procedure} requires a session`);
      }

      // The reader route answers 403 when its token is missing or stale.
      if (status === 403) {
        throw new ReaderForbiddenError(message);
      }

      throw new Error(`${procedure} failed: ${message}`);
    }

    return envelope?.result?.data?.json as T;
  }
}
