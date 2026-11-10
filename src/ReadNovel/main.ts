/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  ContentRating,
  DiscoverSectionType,
  type Chapter,
  type ChapterDetails,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import { toXhtmlDocument } from "../novel/xhtml";
import { ReadNovelSearchForm } from "./forms";
import {
  SORTS,
  coverUrl,
  type ListItem,
  type Listing,
  type Novel,
  type ReadNovelFilters,
  type ReadNovelMetadata,
  type Toc,
} from "./models";
import pbconfig from "./pbconfig";

const DOMAIN = "https://readnovel.eu";

const RAILS = [
  { id: "popular", title: "Popular", sort: "popular" },
  { id: "latest", title: "Latest Updates", sort: "latest" },
  { id: "new", title: "New Novels", sort: "new" },
  { id: "rating", title: "Top Rated", sort: "rating" },
] as const;

interface PageProps {
  novel?: Novel;
  toc?: Toc;
  listing?: Listing;
  result?: Listing & { query?: string };
  genres?: string[];
  data?: {
    chapter?: { number: number; title: string; paragraphs?: string[] };
  };
}

// A Next.js pages-router app: every route ships its data in __NEXT_DATA__, so
// there is no API to call. The same app also answers on wuxia.click and
// wuxiaworld.eu, which are the same library under another name.
class ReadNovelExtension implements ExtensionImpl<typeof pbconfig> {
  domain = DOMAIN;

  name = pbconfig.name;

  contentRating: ContentRating = pbconfig.contentRating;

  language = "en";

  async initialise(): Promise<void> {
    // No cookies or tokens are involved.
  }

  private async getProps(path: string): Promise<PageProps> {
    const url = `${DOMAIN}${path}`;
    const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });

    if (response.status !== 200) {
      throw new Error(`${url} answered ${response.status.toString()}`);
    }

    const html = Application.arrayBufferToUTF8String(buffer);
    const payload = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(
      html,
    )?.[1];

    if (!payload) {
      throw new Error(`No page data in ${url}`);
    }

    return (JSON.parse(payload) as { props?: { pageProps?: PageProps } }).props?.pageProps ?? {};
  }

  private query(params: Record<string, string>): string {
    const pairs = Object.entries(params)
      .filter(([, value]) => value.length > 0)
      .map(([key, value]) => `${key}=${encodeURIComponent(value).replaceAll("%20", "+")}`);

    return pairs.length ? `?${pairs.join("&")}` : "";
  }

  private toItem(item: ListItem) {
    return {
      mangaId: item.slug,
      imageUrl: coverUrl(item.coverKey, item.coverOriginal),
      title: Application.decodeHTMLEntities(item.title),
      subtitle: item.latestChapterTitle ?? "",
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return RAILS.map((rail, index) => ({
      id: rail.id,
      title: rail.title,
      type: index === 0 ? DiscoverSectionType.featured : DiscoverSectionType.simpleCarousel,
    }));
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: ReadNovelMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const rail = RAILS.find((entry) => entry.id === section.id);

    if (!rail) {
      throw new Error(`Unknown discover section ${section.id}`);
    }

    const page = metadata?.page ?? 1;
    const props = await this.getProps(
      `/browse${this.query({ sort: rail.sort, page: page.toString() })}`,
    );
    const listing = props.listing;

    const items: DiscoverSectionItem[] = (listing?.items ?? []).map((item) =>
      section.type === DiscoverSectionType.featured
        ? { ...this.toItem(item), type: "featuredCarouselItem" as const }
        : { ...this.toItem(item), type: "simpleCarouselItem" as const },
    );

    return {
      items,
      ...(listing && page < listing.totalPages ? { metadata: { page: page + 1 } } : {}),
    };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTS.map((sort) => ({ id: sort.id, label: sort.title }));
  }

  async getAdvancedSearchForm(query: SearchQuery<ReadNovelFilters>) {
    const props = await this.getProps("/browse");

    return new ReadNovelSearchForm(query.metadata, props.genres ?? []);
  }

  async getSearchResults(
    query: SearchQuery<ReadNovelFilters>,
    metadata: ReadNovelMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const filters: ReadNovelFilters = { ...query.metadata, ...metadata };
    const page = metadata?.page ?? 1;
    const title = (query.title ?? "").trim();

    // Title search is its own path; /browse ignores every query parameter that
    // looks like a search term.
    const props = title
      ? await this.getProps(
          `/search/${encodeURIComponent(title).replaceAll("%20", "+")}${this.query({
            page: page.toString(),
          })}`,
        )
      : await this.getProps(
          `/browse${this.query({
            genre: filters.genre ?? "",
            status: filters.status ?? "",
            sort: sortingOption?.id ?? filters.sort ?? "",
            page: page.toString(),
          })}`,
        );

    const listing = props.result ?? props.listing;

    return {
      items: (listing?.items ?? []).map((item) => this.toItem(item)),
      ...(listing && page < listing.totalPages ? { metadata: { ...filters, page: page + 1 } } : {}),
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const props = await this.getProps(`/novel/${encodeURIComponent(mangaId)}`);
    const novel = props.novel;

    if (!novel) {
      throw new Error(`No novel record for ${mangaId}`);
    }

    const additionalInfo: Record<string, string> = {
      ...(novel.sourceChapterCount ? { Chapters: novel.sourceChapterCount.toString() } : {}),
      ...(novel.originalLanguage ? { Language: novel.originalLanguage } : {}),
      // Machine translations are flagged by the site itself.
      ...(novel.isMtl ? { Translation: "Machine translated" } : {}),
    };

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: Application.decodeHTMLEntities(novel.title),
        secondaryTitles: (novel.altTitles ?? []).map((title) =>
          Application.decodeHTMLEntities(title),
        ),
        thumbnailUrl: coverUrl(novel.coverKey),
        synopsis: Application.decodeHTMLEntities(
          (novel.description ?? "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        ),
        contentRating: novel.isAdult ? ContentRating.ADULT : this.contentRating,
        contentType: "novel",
        shareUrl: `${DOMAIN}/novel/${mangaId}`,
        ...(novel.status ? { status: novel.status } : {}),
        ...(Object.keys(additionalInfo).length ? { additionalInfo } : {}),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const first = await this.getProps(`/novel/${encodeURIComponent(sourceManga.mangaId)}`);
    const pages = first.toc?.ranges?.length ?? 1;
    const chapters: Chapter[] = [];

    const collect = (toc: Toc | undefined): void => {
      for (const item of toc?.items ?? []) {
        chapters.push({
          chapterId: item.number.toString(),
          sourceManga,
          langCode: this.language,
          chapNum: item.number,
          ...(item.title ? { title: Application.decodeHTMLEntities(item.title) } : {}),
          ...(item.createdAt && !isNaN(new Date(item.createdAt).getTime())
            ? { publishDate: new Date(item.createdAt) }
            : {}),
        });
      }
    };

    collect(first.toc);

    // The table of contents is served a hundred at a time, and long novels run
    // to thousands, so every range page is fetched.
    for (let page = 2; page <= pages; page += 1) {
      const props = await this.getProps(
        `/novel/${encodeURIComponent(sourceManga.mangaId)}?page=${page.toString()}`,
      );
      collect(props.toc);
    }

    if (chapters.length === 0) {
      throw new Error(`No chapters listed for ${sourceManga.mangaId}`);
    }

    return chapters.sort((left, right) => right.chapNum - left.chapNum);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const props = await this.getProps(
      `/chapter/${chapter.sourceManga.mangaId}-${chapter.chapterId}`,
    );
    const paragraphs = props.data?.chapter?.paragraphs ?? [];

    if (paragraphs.length === 0) {
      throw new Error(`Chapter ${chapter.chapterId} serves no text`);
    }

    const body = paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n");

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      type: "html",
      html: toXhtmlDocument(body, chapter.title),
    };
  }
}

// Paragraphs arrive as plain text, so the markup is built here.
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export const ReadNovel = new ReadNovelExtension();
