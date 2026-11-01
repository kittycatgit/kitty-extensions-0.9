/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  ACCESS_LIFETIME_MS,
  CLIENT_ID,
  LIBRARY,
  RESOURCE,
  REVOKE_URL,
  SESSION_KEY,
  TOKEN_URL,
  USER_KEY,
  type Session,
} from "./models";

export class SessionError extends Error {}

export type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

export type LibraryResult<T> = { status: number; body: T | undefined; text: string };

export function currentSession(): Session | undefined {
  const stored = Application.getSecureState(SESSION_KEY) as Session | undefined;

  return stored?.accessToken && stored.refreshToken ? stored : undefined;
}

export function storedUsername(): string | undefined {
  const user = Application.getState(USER_KEY);

  return typeof user === "string" && user ? user : undefined;
}

export function saveSession(session: Session | undefined): void {
  Application.setSecureState(session, SESSION_KEY);
}

export function clearSession(): void {
  saveSession(undefined);
  Application.setState(undefined, USER_KEY);
}

// A token response replaces every field at once; a rotated refresh token
// invalidates the old one immediately, so there is no partial update.
export function sessionFrom(json: TokenResponse, previous: Session, now: number): Session {
  if (!json.access_token) {
    throw new SessionError(json.error_description ?? json.error ?? "Comick issued no access token");
  }

  const lifetime = json.expires_in ? Math.min(json.expires_in * 1000, ACCESS_LIFETIME_MS) : 0;

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? previous.refreshToken,
    expiresAt: now + (lifetime || ACCESS_LIFETIME_MS),
  };
}

function form(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

let refreshing: Promise<Session> | undefined;

// Refreshes are serialised and never retried: Comick revokes the whole token
// family when a rotated refresh token is reused.
export function refreshSession(session: Session): Promise<Session> {
  if (!refreshing) {
    refreshing = (async () => {
      const [response, buffer] = await Application.scheduleRequest({
        url: TOKEN_URL,
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form({
          grant_type: "refresh_token",
          client_id: CLIENT_ID,
          refresh_token: session.refreshToken,
          resource: RESOURCE,
        }),
      });
      const text = Application.arrayBufferToUTF8String(buffer);
      let json: TokenResponse = {};

      try {
        json = JSON.parse(text) as TokenResponse;
      } catch {
        throw new SessionError(
          `Comick token refresh returned ${response.status}: ${text.slice(0, 120)}`,
        );
      }

      if (response.status === 400 || response.status === 401) {
        clearSession();
        throw new SessionError("Comick session expired, log in again in settings");
      }

      if (response.status !== 200) {
        throw new SessionError(
          `Comick token refresh failed (${response.status}): ${json.error_description ?? json.error ?? text.slice(0, 120)}`,
        );
      }

      const fresh = sessionFrom(json, session, Date.now());
      saveSession(fresh);

      return fresh;
    })().finally(() => {
      refreshing = undefined;
    });
  }

  return refreshing;
}

async function validSession(): Promise<Session> {
  const session = currentSession();

  if (!session) {
    throw new SessionError("You need to be logged in");
  }

  return Date.now() < session.expiresAt ? session : refreshSession(session);
}

async function send<T>(
  session: Session,
  path: string,
  method: string,
  body?: object,
): Promise<LibraryResult<T>> {
  const [response, buffer] = await Application.scheduleRequest({
    url: `${LIBRARY}${path}`,
    method,
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = Application.arrayBufferToUTF8String(buffer);
  let parsed: T | undefined;

  try {
    parsed = text ? (JSON.parse(text) as T) : undefined;
  } catch {
    parsed = undefined;
  }

  return { status: response.status, body: parsed, text };
}

// One refresh then one retry on a 401, as the docs ask; anything else is the
// caller's to interpret (404 means "not followed" for entry reads).
export async function library<T>(
  path: string,
  method = "GET",
  body?: object,
  okStatuses: number[] = [200, 204],
): Promise<LibraryResult<T>> {
  let session = await validSession();
  let result = await send<T>(session, path, method, body);

  if (result.status === 401) {
    session = await refreshSession(session);
    result = await send<T>(session, path, method, body);
  }

  if (okStatuses.includes(result.status)) {
    return result;
  }

  const detail = (result.body as { message?: string; error?: string } | undefined) ?? {};

  throw new SessionError(
    `Comick library ${method} ${path} failed (${result.status}): ${detail.message ?? detail.error ?? result.text.slice(0, 120)}`,
  );
}

export async function fetchUsername(session: Session): Promise<string> {
  const result = await send<{ username?: string | null; id?: string }>(session, "/me", "GET");

  if (result.status !== 200 || !result.body?.id) {
    throw new SessionError(`Comick rejected the new session (${result.status})`);
  }

  return result.body.username ?? result.body.id;
}

export async function revokeSession(session: Session): Promise<void> {
  await Application.scheduleRequest({
    url: REVOKE_URL,
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({
      client_id: CLIENT_ID,
      token: session.refreshToken,
      token_type_hint: "refresh_token",
    }),
  });
}
