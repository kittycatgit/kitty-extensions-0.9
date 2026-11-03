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
  type Tag,
} from "@paperback/types";

import { toXhtmlDocument } from "../novel/xhtml";
import { ExiledRebelsApi } from "./api";
import {
  gmtDate,
  loadCatalogue,
  POST_FIELDS,
  seriesOfPost,
  type Catalogue,
  type Genre,
} from "./catalogue";
import { ExiledRebelsSearchForm } from "./forms";
import {
  DOMAIN,
  GENRE_PAGES,
  ONGOING_PAGE_PATH,
  PAGE_SIZE,
  PLACEHOLDER_COVER,
  REST_PAGE_SIZE,
  SORTING_OPTIONS,
  withCommas,
  type ExiledMetadata,
  type HomePick,
  type Series,
  type WpPost,
} from "./models";
import { ExiledRebelsInterceptor } from "./network";
import {
  cleanChapterHtml,
  decodeEntities,
  parseChapterTitle,
  parseHomePicks,
  parsePhotoLinks,
  slugOfLink,
} from "./parsers";
import type pbconfigType from "./pbconfig";

const HOME_TTL_MS = 60 * 60 * 1000;

// Manga on this site are login-gated archive downloads with no page reader, so
// only the novel categories are listed.
let homePicks: { at: number; picks: HomePick[] } | undefined;

class ExiledRebelsExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly interceptor = new ExiledRebelsInterceptor("main");

  private readonly api = new ExiledRebelsApi();

  async initialise(): Promise<void> {
    this.interceptor.registerInterceptor();
  }

  private async picks(): Promise<HomePick[]> {
    if (homePicks && Date.now() - homePicks.at < HOME_TTL_MS) {
      return homePicks.picks;
    }
    const picks = parseHomePicks(await this.api.html("/"));
    homePicks = { at: Date.now(), picks };
    return picks;
  }

  private async series(mangaId: string): Promise<Series> {
    const catalogue = await loadCatalogue(this.api);
    const series = catalogue.bySlug.get(mangaId);
    if (!series) {
      throw new Error(`No novel is listed under ${mangaId}`);
    }
    return series;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const series = await this.series(mangaId);
    let cover = series.cover;

    // A series without a page only has covers on its chapter posts.
    if (cover === PLACEHOLDER_COVER) {
      const { body } = await this.api.list<WpPost[]>(
        "posts",
        `categories=${series.categoryId}&per_page=1&_fields=${POST_FIELDS}`,
      );
      cover = body[0]?.jetpack_featured_media_url ?? PLACEHOLDER_COVER;
    }

    const tags: Tag[] = series.genreIds.map((id, index) => ({
      id,
      title: series.genres[index]!,
    }));

    const additionalInfo: Record<string, string> = {
      Chapters: withCommas(series.chapterCount),
    };
    if (series.translator) additionalInfo.Translator = series.translator;
    if (series.editor) additionalInfo.Editor = series.editor;
    if (series.year) additionalInfo.Year = series.year;
    if (series.originStatus) additionalInfo["Status in origin"] = series.originStatus;
    if (series.latestChapter) additionalInfo["Latest chapter"] = series.latestChapter.title;

    return {
      mangaId,
      mangaInfo: {
        thumbnailUrl: cover,
        synopsis: series.summary,
        primaryTitle: series.title,
        secondaryTitles: series.abbreviation ? [series.abbreviation] : [],
        contentRating: ContentRating.ADULT,
        contentType: "novel",
        status: series.status === "completed" ? "Completed" : "Ongoing",
        ...(series.author ? { author: series.author } : {}),
        ...(series.translator ? { artist: series.translator } : {}),
        tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : [],
        additionalInfo,
        shareUrl: series.pageSlug
          ? `${DOMAIN}/novels/${series.pageSlug}/`
          : `${DOMAIN}/category/${series.id}/`,
      },
    };
  }

  // The series category also holds its notices; those have no chapter number
  // in the title and are dropped. Volume sub-categories name the volume.
  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const series = await this.series(sourceManga.mangaId);
    const catalogue = await loadCatalogue(this.api);
    const posts = await this.api.all<WpPost>(
      "posts",
      `categories=${series.categoryId}&per_page=${REST_PAGE_SIZE}&orderby=date&order=asc&_fields=${POST_FIELDS}`,
    );

    const chapters: Chapter[] = [];

    posts.forEach((post, index) => {
      const parsed = parseChapterTitle(post.title.rendered);
      if (!parsed) {
        return;
      }

      const volume = post.categories
        .map((id) => catalogue.categories.get(id)?.name ?? "")
        .map((name) => /\b(?:book|volume|vol\.?|arc)\s*(\d+)/i.exec(name)?.[1])
        .find((match) => match !== undefined);
      const published = gmtDate(post.date_gmt);

      chapters.push({
        chapterId: post.slug,
        sourceManga,
        langCode: "en",
        chapNum: parsed.number,
        sortingIndex: index,
        ...(parsed.title ? { title: parsed.title } : {}),
        ...(volume ? { volume: Number(volume) } : {}),
        ...(published ? { publishDate: new Date(published) } : {}),
      });
    });

    if (chapters.length === 0) {
      throw new Error(`No chapters are posted for ${series.title}`);
    }

    return chapters.reverse();
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const { body } = await this.api.list<WpPost[]>(
      "posts",
      `slug=${encodeURIComponent(chapter.chapterId)}&_fields=id,slug,title,content`,
    );
    const post = body[0];

    if (!post?.content) {
      throw new Error(`Chapter ${chapter.chapterId} is no longer posted`);
    }
    if (post.content.protected) {
      throw new Error(`Chapter ${chapter.chapterId} is password protected on the site`);
    }

    const html = cleanChapterHtml(post.content.rendered);
    const heading = /<h[1-6][\s>]/i.test(html) ? undefined : decodeEntities(post.title.rendered);

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      type: "html",
      html: toXhtmlDocument(html, heading),
    };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  private async genres(): Promise<Genre[]> {
    return (await loadCatalogue(this.api)).genres;
  }

  async getAdvancedSearchForm(query: SearchQuery<ExiledMetadata>): Promise<ExiledRebelsSearchForm> {
    return new ExiledRebelsSearchForm(query.metadata as ExiledMetadata | undefined, this.genres());
  }

  // Everything searchable is already in the catalogue, so filters and sorts
  // run in memory over it.
  async getSearchResults(
    query: SearchQuery<ExiledMetadata>,
    metadata: ExiledMetadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const filters = metadata ?? (query.metadata as ExiledMetadata | undefined) ?? {};
    const catalogue = await loadCatalogue(this.api);
    const words = (query.title ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 0);

    let matches = catalogue.series.filter((series) => {
      if (filters.status && series.status !== filters.status) {
        return false;
      }
      if (filters.genres?.some((genre) => !series.genreIds.includes(genre))) {
        return false;
      }
      const haystack = `${series.title} ${series.abbreviation ?? ""} ${series.id}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });

    matches = sortSeries(matches, sortingOption?.id);

    const page = metadata?.page ?? 1;
    const slice = matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    return {
      items: slice.map((series) => this.resultItem(series)),
      metadata:
        page * PAGE_SIZE < matches.length
          ? { ...filters, page: page + 1 }
          : { ...filters, completed: true },
    };
  }

  private subtitle(series: Series): string {
    const status = series.status === "completed" ? "Completed" : "Ongoing";
    const latest = series.latestChapter ? parseChapterTitle(series.latestChapter.title) : undefined;
    const progress =
      latest && latest.number > 0
        ? `Chapter ${latest.number}`
        : `${withCommas(series.chapterCount)} chapter${series.chapterCount === 1 ? "" : "s"}`;
    return `${progress} • ${status}`;
  }

  private resultItem(series: Series): SearchResultItem {
    return {
      mangaId: series.id,
      title: series.title,
      imageUrl: series.cover,
      subtitle: this.subtitle(series),
      contentRating: ContentRating.ADULT,
    };
  }

  private carouselItem(series: Series): DiscoverSectionItem {
    return {
      type: "simpleCarouselItem",
      mangaId: series.id,
      title: series.title,
      imageUrl: series.cover,
      subtitle: this.subtitle(series),
      contentRating: ContentRating.ADULT,
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    const picks = await this.picks();

    return [
      { id: "banner", title: "Latest Releases", type: DiscoverSectionType.featured },
      { id: "latest", title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
      { id: "recent", title: "Recently Added", type: DiscoverSectionType.simpleCarousel },
      ...picks.map((pick) => ({
        id: pick.id,
        title: pick.title,
        type: DiscoverSectionType.simpleCarousel,
      })),
      { id: "ongoing", title: "Ongoing Translations", type: DiscoverSectionType.simpleCarousel },
      ...GENRE_PAGES.map((page) => ({
        id: page.id,
        title: page.title,
        type: DiscoverSectionType.simpleCarousel,
      })),
      { id: "completed", title: "Completed", type: DiscoverSectionType.simpleCarousel },
      { id: "genres", title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: ExiledMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const page = metadata?.page ?? 1;
    const catalogue = await loadCatalogue(this.api);

    if (section.id === "genres") {
      return {
        items: catalogue.genres.map((genre) => ({
          type: "genresCarouselItem" as const,
          name: genre.title,
          searchQuery: { title: "", metadata: { genres: [genre.id] } },
        })),
        metadata: { completed: true },
      };
    }

    if (section.id === "banner") {
      return this.banner(catalogue);
    }

    if (section.id === "latest") {
      return await this.latestUpdates(catalogue, page);
    }

    if (section.id === "recent") {
      return paged(
        [...catalogue.series].sort((a, b) => b.addedAt - a.addedAt),
        page,
        (series) => this.carouselItem(series),
      );
    }

    if (section.id === "completed") {
      return paged(
        sortSeries(
          catalogue.series.filter((series) => series.status === "completed"),
          "latest",
        ),
        page,
        (series) => this.carouselItem(series),
      );
    }

    if (section.id === "ongoing") {
      return this.linked(catalogue, parsePhotoLinks(await this.api.html(ONGOING_PAGE_PATH)));
    }

    const genrePage = GENRE_PAGES.find((entry) => entry.id === section.id);
    if (genrePage) {
      return this.linked(catalogue, parsePhotoLinks(await this.api.html(genrePage.path)));
    }

    const pick = (await this.picks()).find((entry) => entry.id === section.id);
    if (pick) {
      return this.linked(catalogue, pick.links);
    }

    throw new Error(`Invalid sectionId provided: ${section.id}`);
  }

  // Hand-written pages link series by page slug, a few by a legacy top-level slug.
  private linked(catalogue: Catalogue, links: string[]): PagedResults<DiscoverSectionItem> {
    const seen = new Set<string>();
    const items: DiscoverSectionItem[] = [];

    for (const link of links) {
      const slug = slugOfLink(link);
      const series = catalogue.byPageSlug.get(slug) ?? catalogue.bySlug.get(slug);
      if (series && !seen.has(series.id)) {
        seen.add(series.id);
        items.push(this.carouselItem(series));
      }
    }

    return { items, metadata: { completed: true } };
  }

  // The site's banner shows the twenty newest posts, which come from only a
  // couple of series; the most recently updated series read better.
  private banner(catalogue: Catalogue): PagedResults<DiscoverSectionItem> {
    const items: DiscoverSectionItem[] = sortSeries(catalogue.series, "latest")
      .slice(0, PAGE_SIZE)
      .map((series) => ({
        type: "featuredCarouselItem" as const,
        mangaId: series.id,
        title: series.title,
        imageUrl: series.cover,
        supertitle: this.subtitle(series),
        ...(series.summary ? { summary: series.summary } : {}),
        contentRating: ContentRating.ADULT,
      }));

    return { items, metadata: { completed: true } };
  }

  private async latestUpdates(
    catalogue: Catalogue,
    page: number,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const { body, totalPages } = await this.api.list<WpPost[]>(
      "posts",
      `per_page=${PAGE_SIZE}&page=${page}&_fields=${POST_FIELDS}`,
    );
    const items: DiscoverSectionItem[] = [];

    for (const post of body) {
      const series = seriesOfPost(post, catalogue.byCategory);
      const parsed = parseChapterTitle(post.title.rendered);
      if (!series || !parsed) {
        continue;
      }
      const published = gmtDate(post.date_gmt);
      items.push({
        type: "chapterUpdatesCarouselItem",
        mangaId: series.id,
        chapterId: post.slug,
        title: series.title,
        imageUrl: series.cover,
        subtitle: parsed.number > 0 ? `Chapter ${parsed.number}` : parsed.title!,
        ...(published ? { publishDate: new Date(published) } : {}),
        contentRating: ContentRating.ADULT,
      });
    }

    return {
      items,
      metadata: page < totalPages ? { page: page + 1 } : { completed: true },
    };
  }
}

function sortSeries(series: Series[], sort: string | undefined): Series[] {
  const sorted = [...series];
  if (sort === "title") {
    return sorted.sort((a, b) => a.title.localeCompare(b.title));
  }
  if (sort === "chapters") {
    return sorted.sort((a, b) => b.chapterCount - a.chapterCount);
  }
  return sorted.sort((a, b) => b.updatedAt - a.updatedAt);
}

function paged<T>(rows: Series[], page: number, map: (series: Series) => T): PagedResults<T> {
  const slice = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return {
    items: slice.map(map),
    metadata: page * PAGE_SIZE < rows.length ? { page: page + 1 } : { completed: true },
  };
}

export const ExiledRebels = new ExiledRebelsExtension();
