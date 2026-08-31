/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

// The site is a client-rendered SPA - its HTML carries no content, so
// everything is read from the tRPC API the page itself calls.

export class ReaderForbiddenError extends Error {}

export class UnauthorisedError extends Error {}

type TrpcEnvelope = {
  result?: { data?: { json?: unknown } };
  error?: { json?: { message?: string; data?: { httpStatus?: number } } };
};

// The input schema rejects an explicit null for an optional field, so an unset
// filter has to be absent rather than present and empty.
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

  private primed = false;

  constructor(domain: string) {
    this.domain = domain;
  }

  private url(procedure: string, input: unknown): string {
    // A batch of one, keyed by position, with the input wrapped in `json` for
    // tRPC's transformer.
    const payload = encodeURIComponent(JSON.stringify({ 0: { json: input ?? null } }));
    return `${this.domain}/api/trpc/${procedure}?batch=1&input=${payload}`;
  }

  // Every procedure answers 401 without the anonymous session cookie the root
  // document issues. This fetch is only for its `Set-Cookie`.
  async primeSession(): Promise<void> {
    await Application.scheduleRequest({ url: `${this.domain}/`, method: "GET" });
    this.primed = true;
  }

  // A failed entry comes back undefined rather than sinking the rest, since
  // this only ever decorates results.
  async queryEach<T>(procedure: string, inputs: unknown[]): Promise<(T | undefined)[]> {
    if (inputs.length === 0) {
      return [];
    }

    const payload: Record<number, { json: unknown }> = {};
    inputs.forEach((input, index) => {
      payload[index] = { json: input ?? null };
    });

    // A batch repeats the procedure name once per input.
    const url = `${this.domain}/api/trpc/${inputs.map(() => procedure).join(",")}?batch=1&input=${encodeURIComponent(JSON.stringify(payload))}`;

    try {
      const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });

      if (response.status !== 200) {
        return inputs.map(() => undefined);
      }

      const envelopes = JSON.parse(Application.arrayBufferToUTF8String(buffer)) as TrpcEnvelope[];

      return inputs.map((_, index) => {
        const envelope = envelopes[index];
        return envelope?.error ? undefined : (envelope?.result?.data?.json as T | undefined);
      });
    } catch {
      return inputs.map(() => undefined);
    }
  }

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
