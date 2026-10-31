/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  DiscoverSectionType,
  type Chapter,
  type ChapterDetails,
  type Cookie,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
  type Tag,
} from "@paperback/types";

import { CoffeeSearchForm } from "./forms";
import {
  CHAPTER_BATCH,
  chapterUrl,
  chaptersJsonUrl,
  DOMAIN,
  libraryUrl,
  ROWS,
  searchUrl,
  seriesUrl,
  SORTS,
  type Card,
  type ChapterPage,
  type CoffeeSearchMetadata,
  type HomeProps,
  type ListingProps,
  type ReaderProps,
  type Row,
  type SeriesProps,
} from "./models";
import { CoffeeMangaInterceptor } from "./network";
import { cardsToResults, cardToItem, inertia, parseChapterRows, parseSeries } from "./parsers";
import pbconfig from "./pbconfig";
import { appScriptUrl, deriveKey, manifestPages, manifestUrl, readerConfig } from "./reader";

const GENRES_TTL_MS = 24 * 60 * 60 * 1000;

let genreCache: { at: number; genres: Tag[] } | undefined;

// The app bundle is ~350 KB and only changes on deploy; keep one key per URL.
let keyCache: { url: string; key: Uint8Array } | undefined;

class CoffeeMangaExtension implements ExtensionImpl<typeof pbconfig> {
  private readonly interceptor = new CoffeeMangaInterceptor("main");

  async initialise(): Promise<void> {
    this.interceptor.registerInterceptor();
  }

  async cloudflareBypassCompleted(_request: Request, _cookies: Cookie[]): Promise<void> {
    // The app's own cookie store keeps the bypass cookies; nothing to hold here.
  }

  private async text(url: string, headers: Record<string, string> = {}): Promise<string> {
    const [, buffer] = await Application.scheduleRequest({ url, method: "GET", headers });

    return Application.arrayBufferToUTF8String(buffer);
  }

  private async page<P>(url: string): Promise<P> {
    return inertia<P>(await this.text(url)).props;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseSeries(await this.page<SeriesProps>(seriesUrl(mangaId)), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const slug = sourceManga.mangaId;
    const first = await this.chapterPage(slug, 1);
    const rows = [...first.items];

    for (let page = 2; page <= first.last; page += CHAPTER_BATCH) {
      const batch = [];

      for (let n = page; n < page + CHAPTER_BATCH && n <= first.last; n++) {
        batch.push(this.chapterPage(slug, n));
      }

      for (const result of await Promise.all(batch)) {
        rows.push(...result.items);
      }
    }

    const seen = new Set<string>();
    const chapters = parseChapterRows(
      rows.filter((row) => !seen.has(row.slug) && seen.add(row.slug)),
      sourceManga,
    );

    if (chapters.length === 0) {
      throw new Error(`No chapters were listed for ${slug}.`);
    }

    chapters.sort((a, b) => b.chapNum - a.chapNum);

    return chapters.map((chapter, index) => ({
      ...chapter,
      sortingIndex: chapters.length - index,
    }));
  }

  private async chapterPage(slug: string, page: number): Promise<ChapterPage> {
    const body = JSON.parse(
      await this.text(chaptersJsonUrl(slug, page), { accept: "application/json" }),
    ) as Partial<ChapterPage>;

    if (!Array.isArray(body.items) || typeof body.last !== "number") {
      throw new Error(`The chapter list for ${slug} has an unexpected shape.`);
    }

    return { items: body.items, page: body.page ?? page, last: body.last, total: body.total };
  }

  // The reader page lists only its first image; the rest come from a manifest
  // route whose name and parameters sit encrypted in the page props.
  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = chapterUrl(chapter.sourceManga.mangaId, chapter.chapterId);
    const html = await this.text(url);
    const props = inertia<ReaderProps>(html).props;
    const chapterId = props.chapter?.id;
    const token = props.reader?.x;
    const slug = props.series?.slug ?? chapter.sourceManga.mangaId;

    if (typeof chapterId !== "number" || !token) {
      throw new Error(`The reader page for ${chapter.chapterId} carried no reader token.`);
    }

    const config = readerConfig(token, chapterId, await this.readerKey(appScriptUrl(html)));
    const [response, buffer] = await Application.scheduleRequest({
      url: manifestUrl(config, chapterId, slug),
      method: "GET",
      headers: {
        accept: "application/json",
        referer: url,
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
        "sec-fetch-dest": "empty",
      },
    });

    if (response.status === 428) {
      throw new Error("The site is asking for a browser verification before serving pages.");
    }

    if (response.status !== 200) {
      throw new Error(`The page manifest answered ${response.status} for ${chapter.chapterId}.`);
    }

    const pages = manifestPages(Application.arrayBufferToUTF8String(buffer), config, chapterId);

    if (pages.length === 0) {
      throw new Error(`No pages were listed for ${chapter.chapterId}.`);
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  private async readerKey(scriptUrl: string): Promise<Uint8Array> {
    if (keyCache?.url === scriptUrl) {
      return keyCache.key;
    }

    const key = deriveKey(await this.text(scriptUrl));
    keyCache = { url: scriptUrl, key };

    return key;
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTS.map((sort) => ({ id: sort.id, label: sort.label }));
  }

  async getSearchResults(
    query: SearchQuery<CoffeeSearchMetadata>,
    metadata: CoffeeSearchMetadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const page = metadata?.page ?? 1;
    const title = (query.title ?? "").trim();
    const filters = {
      genre: query.metadata?.genre ?? metadata?.genre ?? "",
      type: query.metadata?.type ?? metadata?.type ?? "",
      status: query.metadata?.status ?? metadata?.status ?? "",
      section: query.metadata?.section ?? metadata?.section ?? "",
    };
    const filtered = Object.values(filters).some(Boolean);

    // /search knows only the title; the library knows every filter but no
    // title. With both, the filtered listing is matched page by page.
    const listing = filtered
      ? await this.page<ListingProps>(
          libraryUrl(page, {
            orden: sortingOption?.id ?? "reciente",
            genero: filters.genre,
            tipo: filters.type,
            estado: filters.status,
            seccion: filters.section,
          }),
        )
      : title
        ? await this.page<ListingProps>(searchUrl(title, page))
        : await this.page<ListingProps>(libraryUrl(page, { orden: sortingOption?.id ?? "vistas" }));

    const found = cardsToResults(listing.series);
    const items =
      filtered && title
        ? found.filter((item) => item.title.toLowerCase().includes(title.toLowerCase()))
        : found;

    const last = listing.pagination?.last ?? page;
    const carried = {
      ...(filters.genre ? { genre: filters.genre } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.section ? { section: filters.section } : {}),
    };

    return {
      items,
      metadata:
        found.length === 0 || page >= last ? { completed: true } : { ...carried, page: page + 1 },
    };
  }

  private async genres(): Promise<Tag[]> {
    if (genreCache && Date.now() - genreCache.at < GENRES_TTL_MS) {
      return genreCache.genres;
    }

    const listing = await this.page<ListingProps>(libraryUrl(1, {}));
    const genres: Tag[] = (listing.filters?.genres ?? [])
      .filter((genre) => genre.slug && genre.name)
      .map((genre) => ({ id: genre.slug, title: genre.name.trim() }));

    if (genres.length === 0) {
      throw new Error("The library page listed no genres.");
    }

    genreCache = { at: Date.now(), genres };

    return genres;
  }

  async getAdvancedSearchForm(query: SearchQuery<CoffeeSearchMetadata>): Promise<CoffeeSearchForm> {
    return new CoffeeSearchForm(query.metadata, await this.genres());
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return ROWS.map((row) => ({
      id: row.id,
      title: row.title,
      type: DiscoverSectionType[row.type],
    }));
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: CoffeeSearchMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const row = ROWS.find((entry) => entry.id === section.id);

    if (!row) {
      throw new Error(`Invalid sectionId provided: ${section.id}`);
    }

    if (row.source.kind === "library") {
      const page = metadata?.page ?? 1;
      const listing = await this.page<ListingProps>(libraryUrl(page, { orden: row.source.order }));
      const items = this.items(row, listing.series ?? []);
      const last = listing.pagination?.last ?? page;

      return {
        items,
        metadata: items.length === 0 || page >= last ? { completed: true } : { page: page + 1 },
      };
    }

    const home = await this.page<HomeProps>(`${DOMAIN}/`);

    if (row.source.kind === "genres") {
      const items: DiscoverSectionItem[] = (home.genres ?? [])
        .filter((genre) => genre.slug && genre.name)
        .map((genre) => ({
          type: "genresCarouselItem" as const,
          name: genre.name.trim(),
          searchQuery: { title: "", filters: [], metadata: { genre: genre.slug } },
        }));

      return { items, metadata: { completed: true } };
    }

    const cards =
      row.source.kind === "heroes"
        ? (home.heroes ?? [])
        : (home.sections?.find((entry) => entry.code === (row.source as { code: string }).code)
            ?.items ?? []);

    if (cards.length === 0) {
      throw new Error(`The home page carried no "${row.title}" rail.`);
    }

    return { items: this.items(row, cards), metadata: { completed: true } };
  }

  private items(row: Row, cards: Card[]): DiscoverSectionItem[] {
    const seen = new Set<string>();
    const items: DiscoverSectionItem[] = [];

    for (const card of cards) {
      if (card.slug && card.title && !seen.has(card.slug) && row.type !== "genres") {
        seen.add(card.slug);
        items.push(cardToItem(card, row.type));
      }
    }

    return items;
  }
}

export const CoffeeManga = new CoffeeMangaExtension();
