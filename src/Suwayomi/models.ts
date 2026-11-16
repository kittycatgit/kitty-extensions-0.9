/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

export const SERVER_KEY = "suwayomi_server";
export const USER_KEY = "suwayomi_username";
export const PASS_KEY = "suwayomi_password";
export const SESSION_KEY = "suwayomi_session";
export const LANGUAGES_KEY = "suwayomi_languages";
export const KEEP_KEY = "suwayomi_keep_downloaded";

export const PAGE_SIZE = 30;
export const LIBRARY = "library";
export const UPDATES = "updates";
export const POPULAR = "popular";
export const LATEST = "latest";
// Files dropped on the server itself; it has no catalogue to browse.
export const LOCAL_SOURCE = "0";
export const DEFAULT_LANGUAGES = ["en"];

export interface SuwayomiCredentials {
  server: string;
  username: string;
  password: string;
}

export interface StoredSession {
  fingerprint: string;
  server: string;
  username: string;
  token: string;
  refresh: string;
  renewAt: number;
}

export interface SuwayomiSource {
  id: string;
  name: string;
  lang: string;
  displayName: string;
  supportsLatest: boolean;
  contentWarning?: string;
}

export interface SuwayomiManga {
  id: number;
  title: string;
  thumbnailUrl?: string | null;
  description?: string | null;
  author?: string | null;
  artist?: string | null;
  genre?: string[];
  status?: string;
  realUrl?: string | null;
  sourceId?: string;
  initialized?: boolean;
  lastFetchedAt?: string | null;
  source?: SuwayomiSource | null;
  user?: { inLibrary?: boolean; unreadCount?: number; downloadCount?: number };
}

export interface SuwayomiChapter {
  id: number;
  name: string;
  chapterNumber: number;
  scanlator?: string | null;
  uploadDate?: string | null;
  fetchedAt?: string | null;
  sourceOrder: number;
  manga?: SuwayomiManga;
  user?: { isRead?: boolean; isDownloaded?: boolean };
}

export type SuwayomiMetadata = {
  page?: number;
  offset?: number;
  // Sources that still have another page of results.
  open?: string[];
  completed?: boolean;
};

export type SuwayomiSearchMetadata = {
  sources?: string[];
};

export const MANGA_FIELDS =
  "id title thumbnailUrl description author artist genre status realUrl sourceId initialized lastFetchedAt source { id name lang displayName supportsLatest contentWarning } user { inLibrary unreadCount downloadCount }";

export const CHAPTER_FIELDS =
  "id name chapterNumber scanlator uploadDate sourceOrder user { isRead isDownloaded }";

export const STATUSES: Record<string, string> = {
  ONGOING: "Ongoing",
  COMPLETED: "Completed",
  LICENSED: "Licensed",
  PUBLISHING_FINISHED: "Publishing finished",
  CANCELLED: "Cancelled",
  ON_HIATUS: "On hiatus",
};

function text(key: string, secure = false): string {
  const value = secure ? Application.getSecureState(key) : Application.getState(key);

  return typeof value === "string" ? value : "";
}

export const storedServer = (): string => text(SERVER_KEY);
export const storedUsername = (): string => text(USER_KEY);
export const storedPassword = (): string => text(PASS_KEY, true);

export function storedLanguages(): string[] {
  const value = Application.getState(LANGUAGES_KEY);

  return Array.isArray(value) && value.length > 0 ? (value as string[]) : DEFAULT_LANGUAGES;
}

// On unless switched off: a library title is one the server keeps a copy of.
export const storedKeep = (): boolean => Application.getState(KEEP_KEY) !== false;

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

// The address is whatever the reader typed, so expect trailing slashes, stray
// spaces and a missing scheme.
export function normaliseServer(value: string): string {
  const trimmed = (value ?? "").trim().replace(/\/+$/, "");

  if (!trimmed) {
    return "";
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function requireSettings(): SuwayomiCredentials {
  const server = normaliseServer(storedServer());
  const username = storedUsername().trim();
  const password = storedPassword();

  if (!server) {
    throw new Error("No Suwayomi server address is set. Add one in this source's settings.");
  }

  if (!username || !password) {
    throw new Error(
      "No Suwayomi sign-in is set. Enter your username and password in this source's settings.",
    );
  }

  return { server, username, password };
}

// Covers and pages come back as paths on the server; an empty cover breaks a
// whole rail, so a title without one borrows the server's own icon.
export function coverUrl(server: string, path: string | null | undefined): string {
  return path ? absolute(server, path) : `${server}/apple-touch-icon.png`;
}

export function absolute(server: string, path: string): string {
  return /^https?:\/\//i.test(path) ? path : `${server}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function languageLabel(lang: string): string {
  return lang === "all" ? "All languages" : lang.toUpperCase();
}
