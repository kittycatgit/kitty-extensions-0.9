/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  ContentRating,
  DiscoverSectionType,
  type DiscoverSection,
  type DiscoverSectionItem,
  type SourceManga,
  type Tag,
} from "@paperback/types";
import type { CheerioAPI } from "cheerio";

import type { MadaraGeneric } from "../generic/main";
import { MadaraParser } from "../generic/parsers";

// Madara underneath, but the "aqua" child theme renames every class, so none of
// the base selectors match. The chapter ajax route is untouched.
export class AquaReaderParser extends MadaraParser {
  override async parseMangaDetails(
    $: CheerioAPI,
    mangaId: string,
    source: MadaraGeneric,
  ): Promise<SourceManga> {
    const secondaryTitles: string[] = [];
    $("span.aqua-alt-pill").each((_, element) => {
      const title = Application.decodeHTMLEntities($(element).text().trim());

      if (title) {
        secondaryTitles.push(title);
      }
    });

    const tags: Tag[] = [];
    $("a.aqua-series-genre-pill").each((_, element) => {
      const name = $(element).text().trim();
      const id = ($(element).attr("href") ?? "").replace(/\/$/, "").split("/").pop() ?? "";

      if (name && id && !tags.some((tag) => tag.id === id)) {
        tags.push({ id, title: name });
      }
    });

    const author = $("span.aqua-series-info__creator-value")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const status = $("span.aqua-series-meta__status").first().text().replace(/\s+/g, " ").trim();
    const rating = Number(
      /([\d.]+)\s*\/\s*5/.exec($("span.aqua-series-meta__rating").first().text())?.[1] ?? NaN,
    );

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: Application.decodeHTMLEntities(
          $("h1.aqua-series-info__title").first().text().trim(),
        ),
        secondaryTitles,
        thumbnailUrl: encodeURI($("img.aqua-series-cover__img").first().attr("src") ?? ""),
        synopsis: Application.decodeHTMLEntities(
          $("div.aqua-series-synopsis").first().text().replace(/\s+/g, " ").trim(),
        ),
        contentRating: source.defaultContentRating ?? ContentRating.EVERYONE,
        shareUrl: `${source.domain}/manga/${mangaId}`,
        ...(status ? { status: status.toUpperCase() } : {}),
        ...(author ? { author } : {}),
        ...(isNaN(rating) ? {} : { rating }),
        ...(tags.length ? { tagGroups: [{ id: "genres", title: "Genres", tags }] } : {}),
      },
    };
  }

  // `?s=` keeps the stock Madara result markup while the archive and the home
  // page use aqua cards, so both shapes are read here.
  override async parseSearchResults($: CheerioAPI, source: MadaraGeneric) {
    const cards = this.cards($);

    if (cards.length === 0) {
      return super.parseSearchResults($, source);
    }

    return cards.map((card) => ({
      slug: card.slug,
      image: card.image,
      title: card.title,
      subtitle: card.subtitle,
    }));
  }

  override async parseDiscoverSections(
    $: CheerioAPI,
    section: DiscoverSection,
    _source: MadaraGeneric,
  ): Promise<DiscoverSectionItem[]> {
    return this.cards($).map((card) =>
      section.type === DiscoverSectionType.featured
        ? {
            mangaId: card.slug,
            imageUrl: card.image,
            title: card.title,
            supertitle: card.subtitle,
            type: "featuredCarouselItem" as const,
          }
        : {
            mangaId: card.slug,
            imageUrl: card.image,
            title: card.title,
            subtitle: card.subtitle,
            type: "simpleCarouselItem" as const,
          },
    );
  }

  private cards($: CheerioAPI): {
    slug: string;
    title: string;
    image: string;
    subtitle: string;
  }[] {
    const cards: { slug: string; title: string; image: string; subtitle: string }[] = [];
    const seen = new Set<string>();

    for (const element of $("article.aqua-archive-card").toArray()) {
      const card = $(element);
      const anchor = card.find("h3.aqua-archive-card__title a").first();
      const slug = (anchor.attr("href") ?? "").replace(/\/$/, "").split("/").pop() ?? "";

      // The cover's alt attribute is empty here, so the title comes from the
      // card heading.
      const title = anchor.text().replace(/\s+/g, " ").trim();

      if (!slug || !title || seen.has(slug)) {
        continue;
      }
      seen.add(slug);

      cards.push({
        slug,
        title: Application.decodeHTMLEntities(title),
        image: encodeURI(card.find("img").first().attr("src") ?? ""),
        subtitle: card.find("span.aqua-archive-card__rating-badge").first().text().trim(),
      });
    }

    return cards;
  }
}
