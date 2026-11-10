/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  DiscoverSectionType,
  type ContentRating,
  type DiscoverSection,
  type DiscoverSectionItem,
  type PagedResults,
} from "@paperback/types";
import { type CheerioAPI } from "cheerio";

import { MangaStreamGeneric } from "../mangastream/main";
import type { MangaStreamDiscoverSection, MangaStreamSearchMetadata } from "../mangastream/models";
import { railItems } from "../shared/violetRails";
import pbconfig from "./pbconfig";

const DOMAIN = "https://athreascans.com";

class AthreaScansExtension extends MangaStreamGeneric {
  domain = DOMAIN;
  name = pbconfig.name;
  contentRating: ContentRating = pbconfig.contentRating;

  // The home page carries two rails: a `listupd` grid and a sidebar `serieslist`.
  override configureSections(): void {
    this.featuredSection.selectorFunc = ($: CheerioAPI) =>
      $("div.bsx", $("h2:contains(Latest Update)").closest("div.bixbox, div.releases").next());

    this.discoverSections = [
      {
        id: "latest_update",
        title: "Latest Update",
        type: DiscoverSectionType.featured,
        selectorFunc: ($: CheerioAPI) => $("div.bsx", $("div.listupd")),
        titleSelectorFunc: ($: CheerioAPI, element) => $("a", element).attr("title") ?? "",
        subtitleSelectorFunc: ($: CheerioAPI, element) =>
          $("div.epxs, div.adds div.epxs", element).first().text().trim(),
        itemType: "featuredCarouselItem",
        enabled: true,
      },
      this.newSeriesRail(),
    ];
  }

  // Sidebar list: titles live in the cover's alt text, not a link attribute.
  private newSeriesRail(): MangaStreamDiscoverSection {
    return {
      id: "new_series",
      title: "New Series",
      type: DiscoverSectionType.simpleCarousel,
      selectorFunc: ($: CheerioAPI) => $("div.serieslist ul li"),
      titleSelectorFunc: ($: CheerioAPI, element) =>
        $("img", element).attr("alt") ?? $("div.leftseries h2 a", element).first().text().trim(),
      subtitleSelectorFunc: ($: CheerioAPI, element) =>
        $("div.leftseries span, span.mgen", element).first().text().trim(),
      itemType: "simpleCarouselItem",
      enabled: true,
    };
  }

  override async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: MangaStreamSearchMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    return railItems(this, section, metadata);
  }
}

export const AthreaScans = new AthreaScansExtension();
