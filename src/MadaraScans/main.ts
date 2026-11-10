/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  type ContentRating,
  type DiscoverSection,
  type DiscoverSectionItem,
  type PagedResults,
} from "@paperback/types";

import { MangaStreamGeneric } from "../mangastream/main";
import type { MangaStreamSearchMetadata } from "../mangastream/models";
import { railItems, violetSections } from "../shared/violetRails";
import pbconfig from "./pbconfig";

const DOMAIN = "https://madarascans.net";

class MadaraScansExtension extends MangaStreamGeneric {
  domain = DOMAIN;
  name = pbconfig.name;
  contentRating: ContentRating = pbconfig.contentRating;

  override directoryPath = "series";

  override configureSections(): void {
    this.discoverSections = violetSections(this.featuredSection);
  }

  override async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: MangaStreamSearchMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    return railItems(this, section, metadata);
  }
}

export const MadaraScans = new MadaraScansExtension();
