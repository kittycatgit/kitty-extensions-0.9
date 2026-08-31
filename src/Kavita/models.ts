/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

export const SERVER_KEY = "kavita.server";

export const USER_KEY = "kavita.username";

export const PASS_KEY = "kavita.password";

export const API_KEY = "kavita.apikey";

export const MODE_KEY = "kavita.authmode";

export const SHELVES_KEY = "kavita.shelves";

export const SESSION_KEY = "kavita.session";

// Kept so launching does not resend the password: the app logs every request
// body, and readers share those logs.
export interface StoredSession {
  fingerprint: string;
  server: string;
  username: string;
  token: string;
  refresh: string;
  imageKey: string;
}

export function storedSession(): StoredSession | undefined {
  const raw = Application.getSecureState(SESSION_KEY);

  if (typeof raw !== "string" || !raw) {
    return undefined;
  }

  try {
    const value = JSON.parse(raw) as StoredSession;

    return value?.token && value?.refresh ? value : undefined;
  } catch {
    return undefined;
  }
}

export function keepSession(session: StoredSession | undefined): void {
  Application.setSecureState(session ? JSON.stringify(session) : undefined, SESSION_KEY);
}

export const MODE_PASSWORD = "password";
export const MODE_API_KEY = "apikey";

export function storedServer(): string {
  const value = Application.getState(SERVER_KEY);

  return typeof value === "string" ? value : "";
}

export function storedUsername(): string {
  const value = Application.getState(USER_KEY);

  return typeof value === "string" ? value : "";
}

export function storedPassword(): string {
  const value = Application.getSecureState(PASS_KEY);

  return typeof value === "string" ? value : "";
}

export function storedApiKey(): string {
  const value = Application.getSecureState(API_KEY);

  return typeof value === "string" ? value : "";
}

// Off by default: every side nav row fetches a full page of series each time
// Home opens.
export function storedShelves(): boolean {
  return Application.getState(SHELVES_KEY) === true;
}

export function storedAuthMode(): string {
  const value = Application.getState(MODE_KEY);

  return value === MODE_API_KEY ? MODE_API_KEY : MODE_PASSWORD;
}

// The address is whatever the reader typed, so expect trailing slashes, stray
// spaces and a missing scheme.
export function normaliseServer(value: string): string {
  const trimmed = (value ?? "").trim().replace(/\/+$/, "");

  if (!trimmed) {
    return "";
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export type KavitaCredentials =
  | { server: string; mode: typeof MODE_PASSWORD; username: string; password: string }
  | { server: string; mode: typeof MODE_API_KEY; apiKey: string };

export function requireSettings(): KavitaCredentials {
  const server = normaliseServer(storedServer());
  const mode = storedAuthMode();

  if (!server) {
    throw new Error("No Kavita server address is set. Add one in this source's settings.");
  }

  if (mode === MODE_API_KEY) {
    const apiKey = storedApiKey().trim();

    if (!apiKey) {
      throw new Error("No Kavita API key is set. Add one in this source's settings.");
    }

    return { server, mode: MODE_API_KEY, apiKey };
  }

  const username = storedUsername().trim();
  const password = storedPassword();

  if (!username || !password) {
    throw new Error(
      "No Kavita sign-in is set. Enter your username and password in this source's settings.",
    );
  }

  return { server, mode: MODE_PASSWORD, username, password };
}

// Kavita serves artwork to anyone holding the key in the query string, no
// headers, so the app can fetch these addresses on its own.
export function pageUrl(server: string, apiKey: string, chapterId: number, page: number): string {
  return `${server}/api/Reader/image?chapterId=${chapterId}&page=${page}&apiKey=${encodeURIComponent(apiKey)}`;
}

export function seriesCoverUrl(server: string, apiKey: string, seriesId: number): string {
  return `${server}/api/Image/series-cover?seriesId=${seriesId}&apiKey=${encodeURIComponent(apiKey)}`;
}

export const FORMAT_IMAGE = 0;
export const FORMAT_ARCHIVE = 1;
export const FORMAT_EPUB = 3;
export const FORMAT_PDF = 4;

export interface KavitaSeries {
  id?: number;
  seriesId?: number;
  name?: string | null;
  // The recently-updated endpoint names its series here instead.
  seriesName?: string | null;
  originalName?: string | null;
  localizedName?: string | null;
  format?: number;
  libraryId?: number;
  pages?: number;
  pagesRead?: number;
}

export interface KavitaChapter {
  id: number;
  minNumber?: number;
  number?: string;
  range?: string;
  title?: string | null;
  titleName?: string | null;
  pages?: number;
  pagesRead?: number;
  isSpecial?: boolean;
  volumeId?: number;
  sortOrder?: number;
  releaseDate?: string | null;
}

export interface KavitaVolume {
  id: number;
  minNumber?: number;
  maxNumber?: number;
  name?: string | null;
  pages?: number;
  chapters?: KavitaChapter[];
}

export interface KavitaSeriesDetail {
  volumes?: KavitaVolume[];
  chapters?: KavitaChapter[];
  specials?: KavitaChapter[];
  storylineChapters?: KavitaChapter[];
  totalCount?: number;
}

// Kavita's own names for the keys an account holds; not ours to choose.
export const GENERIC_KEY_NAME = "opds";
export const IMAGE_KEY_NAME = "image-only";

export interface KavitaAuthKey {
  id?: number;
  name?: string | null;
  key?: string | null;
}

export interface KavitaLogin {
  username?: string | null;
  token?: string | null;
  refreshToken?: string | null;
  // Servers from before keys were named answer with a single key here.
  apiKey?: string | null;
  authKeys?: KavitaAuthKey[] | null;
}

// The image-only key opens pages and covers but nothing else, so prefer the
// general one.
export function imageKeyFrom(login: KavitaLogin, fallback = ""): string {
  const keys = login.authKeys ?? [];
  const byName = (name: string): string =>
    (keys.find((key) => key.name === name)?.key ?? "").trim();

  const chosen =
    byName(GENERIC_KEY_NAME) ||
    byName(IMAGE_KEY_NAME) ||
    (keys.map((key) => (key.key ?? "").trim()).find((key) => key.length > 0) ?? "") ||
    (login.apiKey ?? "").trim() ||
    fallback.trim();

  if (!chosen) {
    throw new Error("Kavita signed in but issued no key, so artwork cannot be addressed.");
  }

  return chosen;
}

export const STREAM_ON_DECK = 1;
export const STREAM_RECENTLY_UPDATED = 2;
export const STREAM_NEWLY_ADDED = 3;
export const STREAM_SMART_FILTER = 4;
export const STREAM_MORE_IN_GENRE = 5;

export interface KavitaDashboardStream {
  id?: number;
  name?: string | null;
  isProvided?: boolean;
  streamType?: number;
  order?: number;
  visible?: boolean;
  smartFilterEncoded?: string | null;
}

// A smart filter is an encoded query only Kavita's web client unpacks, and the
// genre row picks a genre at random per load, so neither is listed here.
export const STREAM_PATHS: Record<number, string> = {
  [STREAM_ON_DECK]: "/api/Series/on-deck",
  [STREAM_RECENTLY_UPDATED]: "/api/Series/recently-updated-series",
  [STREAM_NEWLY_ADDED]: "/api/Series/recently-added-v2",
};

// Keyed by the server's row name, valued with its wording in the web client.
export const STREAM_TITLES: Record<string, string> = {
  "on-deck": "On Deck",
  "recently-updated": "Recently Updated Series",
  "newly-added": "Newly Added Series",
};

export function streamTitle(stream: KavitaDashboardStream): string {
  const name = (stream.name ?? "").trim();

  return STREAM_TITLES[name] ?? (name || `Row ${stream.id ?? 0}`);
}

export const NAV_COLLECTIONS = 1;
export const NAV_READING_LISTS = 2;
export const NAV_BOOKMARKS = 3;
export const NAV_LIBRARY = 4;
export const NAV_ALL_SERIES = 7;
export const NAV_WANT_TO_READ = 8;
export const NAV_BROWSE_PEOPLE = 9;

export interface KavitaSideNavStream {
  id?: number;
  name?: string | null;
  isProvided?: boolean;
  streamType?: number;
  order?: number;
  visible?: boolean;
  libraryId?: number | null;
  smartFilterId?: number | null;
}

export const NAV_TITLES: Record<string, string> = {
  "want-to-read": "Want To Read",
  "all-series": "All Series",
};

export function navTitle(stream: KavitaSideNavStream): string {
  const name = (stream.name ?? "").trim();

  return NAV_TITLES[name] ?? (name || `Row ${stream.id ?? 0}`);
}

export const FIELD_LIBRARY = 19;

export const COMPARISON_EQUAL = 0;

// Collections, reading lists, bookmarks and people hold no series, so they get
// no row.
export function navSource(
  streamType: number,
  libraryId: number | undefined | null,
): { path: string; body: unknown } | undefined {
  if (streamType === NAV_ALL_SERIES) {
    // all-v2 refuses an empty filter with a 400. This endpoint takes the same
    // body the library row sends, and no statement means every series.
    return { path: "/api/Series/v2", body: { statements: [], combination: 1, limitTo: 0 } };
  }

  if (streamType === NAV_WANT_TO_READ) {
    return { path: "/api/want-to-read/v2", body: {} };
  }

  if (streamType === NAV_LIBRARY && libraryId) {
    return {
      path: "/api/Series/v2",
      body: {
        statements: [
          { comparison: COMPARISON_EQUAL, field: FIELD_LIBRARY, value: String(libraryId) },
        ],
        combination: 1,
        limitTo: 0,
      },
    };
  }

  return undefined;
}

export interface KavitaLibrary {
  id: number;
  name?: string | null;
  type?: number;
}

export type KavitaMetadata = {
  page?: number;
  completed?: boolean;
};

export const PAGE_SIZE = 30;
