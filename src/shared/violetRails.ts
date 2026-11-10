/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  DiscoverSectionType,
  type DiscoverSection,
  type DiscoverSectionItem,
  type PagedResults,
} from "@paperback/types";
import * as cheerio from "cheerio";
import { type CheerioAPI } from "cheerio";

import type { MangaStreamGeneric } from "../mangastream/main";
import type { MangaStreamDiscoverSection, MangaStreamSearchMetadata } from "../mangastream/models";

// Several Themesia "mangareader" sites run the same "violet" child theme, which
// builds each home rail as a swiper with its own id instead of the heading-then-
// sibling markup the MangaStream base walks.
export function violetRail(
  id: string,
  title: string,
  container: string,
  itemType: MangaStreamDiscoverSection["itemType"] = "simpleCarouselItem",
): MangaStreamDiscoverSection {
  return {
    id,
    title,
    type: DiscoverSectionType.simpleCarousel,
    selectorFunc: ($: CheerioAPI) => $("div.bsx", $(container)),
    titleSelectorFunc: ($: CheerioAPI, element) => $("a", element).attr("title") ?? "",
    subtitleSelectorFunc: ($: CheerioAPI, element) =>
      $("div.epxs, div.extra-info a", element).first().text().trim(),
    itemType,
    enabled: true,
  };
}

export function violetSections(featured: MangaStreamDiscoverSection): MangaStreamDiscoverSection[] {
  featured.selectorFunc = ($: CheerioAPI) => $("div.bsx", $("div.violet-popular-today-slider"));

  return [
    featured,
    violetRail(
      "latest_comics",
      "Latest Comics",
      "div.latest-updates",
      "chapterUpdatesCarouselItem",
    ),
    violetRail("new_series", "New Series", "div.violet-new-series-slider"),
    violetRail("latest_manga", "Latest Manga", "div.violet-latest-manga-slider"),
    violetRail("completed_series", "Completed Series", "div.violet-completed-series-slider"),
  ];
}

// The base resolves rails through a switch that only knows "popular" and
// "latest_updates"; every other id silently falls through to latest updates.
export async function railItems(
  extension: MangaStreamGeneric,
  section: DiscoverSection,
  metadata: MangaStreamSearchMetadata | undefined,
): Promise<PagedResults<DiscoverSectionItem>> {
  const resolved = extension.discoverSections.find((entry) => entry.id === section.id);

  if (!resolved) {
    throw new Error(`Unknown discover section ${section.id}`);
  }

  const [, buffer] = await Application.scheduleRequest({
    url: extension.domain,
    method: "GET",
  });
  const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));

  return { items: await extension.parser.parseHomeSection($, resolved, extension), metadata };
}
