/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  keepSession,
  normaliseServer,
  requireSettings,
  storedServer,
  storedSession,
  type StoredSession,
  type SuwayomiCredentials,
} from "./models";

let session: StoredSession | undefined;
let pending: Promise<StoredSession> | undefined;

// Changes whenever the credentials do, so edited settings force a fresh sign-in
// rather than leaving a stale token in place.
const fingerprint = (credentials: SuwayomiCredentials): string =>
  [credentials.server, credentials.username, credentials.password].join("\n");

interface Reply<T> {
  status: number;
  data?: T;
  errors: string[];
}

// Errors arrive as one line of reason followed by a Java stack trace.
function reason(message: string): string {
  const line = (message.split(/\r?\n/)[0] ?? "").trim();

  return line.replace(/^Exception while fetching data \([^)]*\)\s*:\s*/, "") || "Unknown error";
}

async function post<T>(
  server: string,
  token: string | undefined,
  query: string,
  variables: Record<string, unknown>,
): Promise<Reply<T>> {
  const [response, buffer] = await Application.scheduleRequest({
    url: `${server}/api/graphql`,
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });

  let body: { data?: T | null; errors?: { message?: string }[] } | undefined;

  try {
    body = JSON.parse(Application.arrayBufferToUTF8String(buffer)) as typeof body;
  } catch {
    body = undefined;
  }

  return {
    status: response.status,
    ...(body?.data ? { data: body.data } : {}),
    errors: (body?.errors ?? []).map((error) => reason(error.message ?? "")),
  };
}

// Tokens are renewed at half their life, read from the token itself: the server
// default is five minutes and images cannot wait for a renewal mid-chapter.
function renewAt(token: string): number {
  const now = Date.now();

  try {
    const part = (token.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Application.base64Decode(part + "=".repeat((4 - (part.length % 4)) % 4));
    const claims = JSON.parse(
      typeof decoded === "string" ? decoded : Application.arrayBufferToUTF8String(decoded),
    ) as { exp?: number };
    const life = (claims.exp ?? 0) * 1000 - now;

    if (life > 0) {
      return now + life / 2;
    }
  } catch {
    // An unreadable token is treated as short-lived below.
  }

  return now + 60_000;
}

function started(server: string, status: number): void {
  if (status === 401) {
    throw new Error(
      'This server is not using Suwayomi\'s own login. Set its authentication mode to "UI login".',
    );
  }

  if (status !== 200) {
    throw new Error(
      `Suwayomi answered ${status} at ${server}. Check the address is right and the server is reachable.`,
    );
  }
}

export async function signIn(credentials: SuwayomiCredentials): Promise<StoredSession> {
  const reply = await post<{ login?: { accessToken?: string; refreshToken?: string } }>(
    credentials.server,
    undefined,
    "mutation($username:String!,$password:String!){ login(input:{username:$username,password:$password}) { accessToken refreshToken } }",
    { username: credentials.username, password: credentials.password },
  );

  started(credentials.server, reply.status);

  const tokens = reply.data?.login;

  if (!tokens?.accessToken || !tokens.refreshToken) {
    throw new Error(
      reply.errors.some((error) => /incorrect username or password/i.test(error))
        ? "Suwayomi did not accept that username and password."
        : (reply.errors[0] ?? "Suwayomi accepted the sign-in but returned no token."),
    );
  }

  session = {
    fingerprint: fingerprint(credentials),
    server: credentials.server,
    username: credentials.username,
    token: tokens.accessToken,
    refresh: tokens.refreshToken,
    renewAt: renewAt(tokens.accessToken),
  };
  keepSession(session);

  return session;
}

// Preferred over signing in again: the app logs every request body, and those
// logs get shared when readers ask for help - so keep the password out of them.
async function renew(kept: StoredSession): Promise<StoredSession | undefined> {
  const reply = await post<{ refreshToken?: { accessToken?: string } }>(
    kept.server,
    undefined,
    "mutation($token:String!){ refreshToken(input:{refreshToken:$token}) { accessToken } }",
    { token: kept.refresh },
  );
  const token = reply.data?.refreshToken?.accessToken;

  if (!token) {
    // Refresh token aged out or was revoked; the caller signs in again.
    return undefined;
  }

  session = { ...kept, token, renewAt: renewAt(token) };
  keepSession(session);

  return session;
}

async function open(credentials: SuwayomiCredentials): Promise<StoredSession> {
  const wanted = fingerprint(credentials);
  const kept = session?.fingerprint === wanted ? session : storedSession();

  if (kept?.fingerprint !== wanted) {
    return signIn(credentials);
  }

  if (Date.now() < kept.renewAt) {
    session = kept;

    return kept;
  }

  return (await renew(kept)) ?? (await signIn(credentials));
}

async function signedIn(): Promise<StoredSession> {
  const credentials = requireSettings();

  if (session?.fingerprint === fingerprint(credentials) && Date.now() < session.renewAt) {
    return session;
  }

  // Home asks for every row at once; they share one renewal.
  pending ??= open(credentials).finally(() => {
    pending = undefined;
  });

  return pending;
}

// The token goes on here rather than in an interceptor - an interceptor that
// had to sign in would be waiting on the request queue it is holding.
export async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const { server, token } = await signedIn();
    const reply = await post<T>(server, token, query, variables);
    const refused =
      reply.status === 401 || reply.errors.some((error) => /^unauthori[sz]ed/i.test(error));

    if (refused && attempt === 0 && session) {
      session = { ...session, renewAt: 0 };
      keepSession(session);
      continue;
    }

    if (refused) {
      throw new Error(
        "Suwayomi refused the sign-in. Check your username and password in this source's settings.",
      );
    }

    started(server, reply.status);

    if (reply.errors.length > 0 || !reply.data) {
      throw new Error(reply.errors[0] ?? "Suwayomi sent an empty answer.");
    }

    return reply.data;
  }
}

export function forgetSession(): void {
  session = undefined;
  keepSession(undefined);
}

// Covers and pages are plain image requests, so the interceptor signs them with
// whatever token is current; it never renews one itself.
export function imageToken(url: string): string | undefined {
  const server = normaliseServer(storedServer());

  if (!server || !url.startsWith(`${server}/api/v1/`)) {
    return undefined;
  }

  return (session ?? storedSession())?.token;
}
