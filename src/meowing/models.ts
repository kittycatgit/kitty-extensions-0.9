/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

export interface CatalogEntry {
  id: string;
  title: string;
  secondaryTitles: string[];
  imageUrl: string;
  tags: string[];
  type: string;
  status: string;
}

export type MeowingFilters = {
  genres?: string[];
  status?: string;
  type?: string;
};

export type MeowingMetadata = MeowingFilters & {
  page?: number;
};

export const PAGE_SIZE = 40;

// Covers are served through the site's image proxy; pages come straight off the
// CDN. Both are keyed by the same upload id.
export const CDN = "https://cdn.meowing.org/uploads";

export function uploadUrl(id: string): string {
  return `${CDN}/${id}`;
}
