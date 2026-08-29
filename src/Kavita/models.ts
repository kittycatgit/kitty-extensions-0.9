/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

/** Where the server's address is kept. */
export const SERVER_KEY = "kavita.server";

/** Where the account name is kept. */
export const USER_KEY = "kavita.username";

/** Where the password is kept, out of ordinary state. */
export const PASS_KEY = "kavita.password";

/** Where the API key is kept, out of ordinary state. */
export const API_KEY = "kavita.apikey";

/** Which way this source signs in. */
export const MODE_KEY = "kavita.authmode";

/** Whether the side nav's own rows are shown beside the dashboard's. */
export const SHELVES_KEY = "kavita.shelves";

/** Where a sign-in that has already happened is kept, out of ordinary state. */
export const SESSION_KEY = "kavita.session";

/**
 * A sign-in the server has already granted.
 *
 * Kept so that starting the app does not mean sending a password again. The app
 * writes the body of every request it makes into its own log, and readers hand
 * those logs to whoever is helping them - so a password sent on each launch is a
 * password in every log they ever share. A token can be rotated; an account
 * password is the account, and is usually a password used somewhere else too.
 */
export interface StoredSession {
  fingerprint: string;
  server: string;
  username: string;
  token: string;
  refresh: string;
  imageKey: string;
}

/** The sign-in kept from last time, if there is a usable one. */
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

/** Keeps a sign-in for next time, or clears it. */
export function keepSession(session: StoredSession | undefined): void {
  Application.setSecureState(session ? JSON.stringify(session) : undefined, SESSION_KEY);
}

/** The ways Kavita will let a source in. */
export const MODE_PASSWORD = "password";
export const MODE_API_KEY = "apikey";

/** The address of the server, as the reader entered it, or nothing. */
export function storedServer(): string {
  const value = Application.getState(SERVER_KEY);

  return typeof value === "string" ? value : "";
}

/** The account name, or nothing. */
export function storedUsername(): string {
  const value = Application.getState(USER_KEY);

  return typeof value === "string" ? value : "";
}

/** The password, or nothing. */
export function storedPassword(): string {
  const value = Application.getSecureState(PASS_KEY);

  return typeof value === "string" ? value : "";
}

/** The API key, or nothing. */
export function storedApiKey(): string {
  const value = Application.getSecureState(API_KEY);

  return typeof value === "string" ? value : "";
}

/**
 * Whether to show the rows that come from the side nav.
 *
 * Kavita's home page loads three rows; the rest of the side nav is a set of
 * links a reader clicks. Turning each of those into a row here means the home
 * screen fetches every one of them at once - a server with several libraries
 * answers a full page of series for each, every time Home is opened, which is
 * what makes scrolling it feel heavy.
 *
 * So they are off unless asked for. Nothing is hidden by accident: the setting
 * says what it costs, and the dashboard rows are unaffected either way.
 */
export function storedShelves(): boolean {
  return Application.getState(SHELVES_KEY) === true;
}

/**
 * The way this source signs in, defaulting to an account.
 *
 * Kavita accepts either an account or a key, and which one a reader wants is
 * not something to infer: a key is narrower and revocable, an account does not
 * expire. The choice is stored so that a half-filled form for one method never
 * silently signs in by the other.
 */
export function storedAuthMode(): string {
  const value = Application.getState(MODE_KEY);

  return value === MODE_API_KEY ? MODE_API_KEY : MODE_PASSWORD;
}

/**
 * An address the rest of this source can build on.
 *
 * Kavita runs on a machine its owner chose, so there is no address to write
 * down here - it is whatever the reader typed. A trailing slash, a missing
 * scheme or stray spaces are all things a person reasonably types, and all
 * things that would otherwise turn into a broken URL further down.
 */
export function normaliseServer(value: string): string {
  const trimmed = (value ?? "").trim().replace(/\/+$/, "");

  if (!trimmed) {
    return "";
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** What this source signs in with, whichever method the reader chose. */
export type KavitaCredentials =
  | { server: string; mode: typeof MODE_PASSWORD; username: string; password: string }
  | { server: string; mode: typeof MODE_API_KEY; apiKey: string };

/** The server and sign-in, or a refusal that says which part is missing. */
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

/**
 * A page or cover, addressed so the app can fetch it on its own.
 *
 * Kavita serves artwork to anyone holding the API key in the query string, with
 * no header of any kind. That means an address handed to the app is complete:
 * the app fetches, caches and retries it however it sees fit, and this source
 * stays out of the way entirely.
 */
export function pageUrl(server: string, apiKey: string, chapterId: number, page: number): string {
  return `${server}/api/Reader/image?chapterId=${chapterId}&page=${page}&apiKey=${encodeURIComponent(apiKey)}`;
}

export function seriesCoverUrl(server: string, apiKey: string, seriesId: number): string {
  return `${server}/api/Image/series-cover?seriesId=${seriesId}&apiKey=${encodeURIComponent(apiKey)}`;
}

/** What Kavita calls the shape of a series' files. */
export const FORMAT_IMAGE = 0;
export const FORMAT_ARCHIVE = 1;
export const FORMAT_EPUB = 3;
export const FORMAT_PDF = 4;

/** A series as the server lists it. */
export interface KavitaSeries {
  id?: number;
  seriesId?: number;
  name?: string | null;
  /** The recently-updated row names its series differently to the rest. */
  seriesName?: string | null;
  originalName?: string | null;
  localizedName?: string | null;
  format?: number;
  libraryId?: number;
  pages?: number;
  pagesRead?: number;
}

/** A chapter inside a volume. */
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

/** A volume, which is where a series keeps its chapters. */
export interface KavitaVolume {
  id: number;
  minNumber?: number;
  maxNumber?: number;
  name?: string | null;
  pages?: number;
  chapters?: KavitaChapter[];
}

/** What the series-detail endpoint answers with. */
export interface KavitaSeriesDetail {
  volumes?: KavitaVolume[];
  chapters?: KavitaChapter[];
  specials?: KavitaChapter[];
  storylineChapters?: KavitaChapter[];
  totalCount?: number;
}

/**
 * The names Kavita gives the keys it issues an account.
 *
 * A key is what artwork addresses carry, and an account can hold several: one
 * general key and one that is only good for images. The names are not ours to
 * choose - they are what the server's own reader looks these up by, and it
 * builds its page addresses from the general one.
 */
export const GENERIC_KEY_NAME = "opds";
export const IMAGE_KEY_NAME = "image-only";

/** One of the keys an account holds. */
export interface KavitaAuthKey {
  id?: number;
  name?: string | null;
  key?: string | null;
}

/** What the server answers a sign-in with. */
export interface KavitaLogin {
  username?: string | null;
  token?: string | null;
  refreshToken?: string | null;
  /** Servers before keys were named answer with a single key here. */
  apiKey?: string | null;
  authKeys?: KavitaAuthKey[] | null;
}

/**
 * The key to put in artwork addresses, from a sign-in.
 *
 * Preferring the general key over the image-only one matters: the image-only
 * key opens pages and covers but nothing else, so a source that picked it
 * would show artwork and then fail at everything around it.
 */
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

/**
 * The kinds of row Kavita's own dashboard is built from.
 *
 * These are the server's numbers, not ours: the reader arranges their dashboard
 * in Kavita, and this source shows the same rows in the same order rather than
 * inventing its own. Smart filters and the genre row are deliberately absent
 * from the map below - see STREAM_PATHS.
 */
export const STREAM_ON_DECK = 1;
export const STREAM_RECENTLY_UPDATED = 2;
export const STREAM_NEWLY_ADDED = 3;
export const STREAM_SMART_FILTER = 4;
export const STREAM_MORE_IN_GENRE = 5;

/** A row on the reader's dashboard, as the server describes it. */
export interface KavitaDashboardStream {
  id?: number;
  name?: string | null;
  isProvided?: boolean;
  streamType?: number;
  order?: number;
  visible?: boolean;
  smartFilterEncoded?: string | null;
}

/**
 * Where each row's series come from.
 *
 * Only the rows this source can reproduce exactly are listed. A smart filter is
 * held by Kavita as an encoded query its web client unpacks for itself, and the
 * genre row picks a genre at random on every load; reproducing either from here
 * would mean guessing at a row the reader arranged deliberately, so both are
 * left out rather than filled with something that merely looks similar.
 */
export const STREAM_PATHS: Record<number, string> = {
  [STREAM_ON_DECK]: "/api/Series/on-deck",
  [STREAM_RECENTLY_UPDATED]: "/api/Series/recently-updated-series",
  [STREAM_NEWLY_ADDED]: "/api/Series/recently-added-v2",
};

/**
 * What Kavita calls its own provided rows.
 *
 * Taken from the server's own wording so the rows read the same here as they do
 * in the browser. A row the reader renamed, or one this source does not know,
 * keeps whatever name the server gave it.
 */
export const STREAM_TITLES: Record<string, string> = {
  "on-deck": "On Deck",
  "recently-updated": "Recently Updated Series",
  "newly-added": "Newly Added Series",
};

/** The title to put on a dashboard row. */
export function streamTitle(stream: KavitaDashboardStream): string {
  const name = (stream.name ?? "").trim();

  return STREAM_TITLES[name] ?? (name || `Row ${stream.id ?? 0}`);
}

/**
 * The kinds of entry Kavita keeps in its side navigation.
 *
 * These numbers are the server's, read from a real server's own side nav rather
 * than guessed: Collections 1, Reading Lists 2, Bookmarks 3, a Library 4, All
 * Series 7, Want To Read 8, Browse People 9.
 */
export const NAV_COLLECTIONS = 1;
export const NAV_READING_LISTS = 2;
export const NAV_BOOKMARKS = 3;
export const NAV_LIBRARY = 4;
export const NAV_ALL_SERIES = 7;
export const NAV_WANT_TO_READ = 8;
export const NAV_BROWSE_PEOPLE = 9;

/** An entry in the reader's side navigation, as the server describes it. */
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

/** What Kavita calls its own side nav entries. */
export const NAV_TITLES: Record<string, string> = {
  "want-to-read": "Want To Read",
  "all-series": "All Series",
};

/** The title to put on a side nav row. A library keeps the name its owner gave it. */
export function navTitle(stream: KavitaSideNavStream): string {
  const name = (stream.name ?? "").trim();

  return NAV_TITLES[name] ?? (name || `Row ${stream.id ?? 0}`);
}

/** Which field a filter means by "the library this series is in". */
export const FIELD_LIBRARY = 19;

/** The comparison a filter uses for an exact match. */
export const COMPARISON_EQUAL = 0;

/**
 * Where a side nav entry's series come from, or nothing if it holds no series.
 *
 * Collections, reading lists, bookmarks and people are all real parts of the
 * side nav, and none of them is a shelf of series: a reading list holds
 * chapters, a bookmark holds a page, and browsing people lists authors. A
 * carousel of series cannot honestly stand in for any of them, so they are left
 * out rather than filled with something that merely looks busy.
 */
export function navSource(
  streamType: number,
  libraryId: number | undefined | null,
): { path: string; body: unknown } | undefined {
  if (streamType === NAV_ALL_SERIES) {
    // all-v2 refuses an empty filter with a 400. This is the same endpoint and
    // body the library row uses, which the server does accept, with no
    // statement to narrow it - so it means every series.
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

/** A library the server exposes. */
export interface KavitaLibrary {
  id: number;
  name?: string | null;
  type?: number;
}

/** Paging state carried between pages of results. */
export type KavitaMetadata = {
  page?: number;
  completed?: boolean;
};

/** How many rows a page of results carries. */
export const PAGE_SIZE = 30;
