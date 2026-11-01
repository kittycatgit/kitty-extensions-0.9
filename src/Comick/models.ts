/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { DiscoverSectionType } from "@paperback/types";

export const DOMAIN = "https://comick.dev";
export const API = "https://api.comick.dev";
export const LIBRARY = `${API}/integrations/v1`;
export const COVERS = "https://meo.comick.pictures";

// Not a real asset: the app draws its own placeholder when a cover fails.
export const MISSING_COVER = `${COVERS}/none.webp`;

export const CLIENT_ID = "NYkivlMXotQixhHCmArAhyyrAEmiqHYu";
// The sign-in page runs the PKCE flow in the browser and hands back a refresh token.
export const LOGIN_PAGE = "https://kittycatgit.github.io/kitty-extensions-0.9/oauth/comick/";
export const RESOURCE = `${LIBRARY}`;
export const TOKEN_URL = `${DOMAIN}/api/auth/oauth2/token`;
export const REVOKE_URL = `${DOMAIN}/api/auth/oauth2/revoke`;

export const SESSION_KEY = "comick-session";
export const USER_KEY = "comick-user";
export const RATING_KEY = "comick-rating";

// Comick issues 15 minute access tokens; refresh a little early.
export const ACCESS_LIFETIME_MS = 14 * 60 * 1000;

export const PAGE_SIZE = 50;
export const SEEN_LIMIT = 500;
export const TOP_SHELF = 30;

export type Session = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type TriState = Record<string, "included" | "excluded">;

export type ComickMetadata = {
  page?: number;
  completed?: boolean;
  seen?: string[];
  genres?: TriState;
  demographics?: string[];
  countries?: string[];
  statuses?: string[];
  rating?: string;
  from?: string;
  to?: string;
  minimum?: string;
};

export const COLLECTIONS = [
  { id: "1", title: "Reading" },
  { id: "2", title: "Completed" },
  { id: "3", title: "On Hold" },
  { id: "4", title: "Dropped" },
  { id: "5", title: "Plan to Read" },
];

// Ordered: a ceiling includes every rating before it.
export const RATINGS = [
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
];

export const DEFAULT_RATING = "suggestive";

export const DEMOGRAPHICS = [
  { id: "1", title: "Shounen" },
  { id: "2", title: "Shoujo" },
  { id: "3", title: "Seinen" },
  { id: "4", title: "Josei" },
];

export const COUNTRIES = [
  { id: "jp", title: "Manga (Japan)" },
  { id: "kr", title: "Manhwa (Korea)" },
  { id: "cn", title: "Manhua (China)" },
  { id: "hk", title: "Hong Kong" },
  { id: "gb", title: "English original" },
];

export const PUBLICATION = [
  { id: "1", title: "Ongoing" },
  { id: "2", title: "Completed" },
  { id: "3", title: "Cancelled" },
  { id: "4", title: "Hiatus" },
];

export const SORTS = [
  { id: "follow", label: "Most followed" },
  { id: "view", label: "Most viewed" },
  { id: "rating", label: "Top rated" },
  { id: "uploaded", label: "Recently updated" },
  { id: "created_at", label: "Newest" },
];

export type RowSource =
  | { kind: "top"; list: "trending" | "topFollowNewComics" | "completions" | "rank" }
  | { kind: "latest" }
  | { kind: "search"; query: string }
  | { kind: "genres" };

export type Row = {
  id: string;
  title: string;
  type: DiscoverSectionType;
  source: RowSource;
};

export const ROWS: Row[] = [
  {
    id: "trending",
    title: "Trending this week",
    type: DiscoverSectionType.featured,
    source: { kind: "top", list: "trending" },
  },
  {
    id: "latest",
    title: "Latest updates",
    type: DiscoverSectionType.chapterUpdates,
    source: { kind: "latest" },
  },
  {
    id: "rising",
    title: "Rising this week",
    type: DiscoverSectionType.prominentCarousel,
    source: { kind: "top", list: "topFollowNewComics" },
  },
  {
    id: "followed",
    title: "Most followed",
    type: DiscoverSectionType.simpleCarousel,
    source: { kind: "search", query: "sort=follow" },
  },
  {
    id: "rated",
    title: "Top rated",
    type: DiscoverSectionType.simpleCarousel,
    source: { kind: "search", query: "sort=rating" },
  },
  {
    id: "new",
    title: "New comics",
    type: DiscoverSectionType.simpleCarousel,
    source: { kind: "search", query: "sort=created_at" },
  },
  {
    id: "completed",
    title: "Recently completed",
    type: DiscoverSectionType.simpleCarousel,
    source: { kind: "top", list: "completions" },
  },
  {
    id: "genres",
    title: "Genres",
    type: DiscoverSectionType.genres,
    source: { kind: "genres" },
  },
];
