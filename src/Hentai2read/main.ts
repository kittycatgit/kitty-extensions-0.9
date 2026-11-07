/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  ContentRating,
  CookieStorageInterceptor,
  DiscoverSectionType,
  type Chapter,
  type ChapterDetails,
  type Cookie,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type Metadata,
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";

import { Hentai2readSearchForm } from "./forms";
import {
  BEST_MATCH,
  LISTING_SECTIONS,
  SORTING_OPTIONS,
  type H2RBook,
  type H2RBookProps,
  type H2RFilters,
  type H2RHomeProps,
  type H2RListingProps,
  type H2RPage,
  type H2RPaging,
  type H2RRankingProps,
  type H2RReaderProps,
  type H2RTag,
} from "./models";
import { Hentai2readInterceptor } from "./network";
import type pbconfigType from "./pbconfig";
import { FALLBACK_TAGS } from "./tags";

const DOMAIN = "https://hentai2read.com";

const TAGS_STATE_KEY = "hentai2read.tags";
const TAGS_TTL_MS = 24 * 60 * 60 * 1000;

type TagsCache = { tags: H2RTag[]; fetchedAt: number };

class Hentai2readExtension implements ExtensionImpl<typeof pbconfigType> {
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly interceptor = new Hentai2readInterceptor("main", DOMAIN);

  // Details and chapters come off the same page; keep the last one briefly.
  private lastBook?: { mangaId: string; props: H2RBookProps; at: number };

  async initialise(): Promise<void> {
    this.cookieStorage.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  private async getText(url: string, headers?: Record<string, string>): Promise<string> {
    const request: Request = { url, method: "GET", ...(headers ? { headers } : {}) };
    const [, buffer] = await Application.scheduleRequest(request);
    return Application.arrayBufferToUTF8String(buffer);
  }

  // The site is an Inertia app: every page ships its props as JSON in the HTML.
  private async getPage<T>(url: string, component: string): Promise<T> {
    const html = await this.getText(url);
    const match = /<script data-page="app" type="application\/json">([\s\S]*?)<\/script>/.exec(
      html,
    );
    if (!match) {
      throw new Error(`No page data found at ${url}`);
    }

    const page = JSON.parse(match[1]) as H2RPage<T>;
    if (page.component !== component) {
      throw new Error(`Unexpected page "${page.component}" at ${url}`);
    }

    return page.props;
  }

  private async getBookProps(mangaId: string): Promise<H2RBookProps> {
    const cached = this.lastBook;
    if (cached && cached.mangaId === mangaId && Date.now() - cached.at < 60_000) {
      return cached.props;
    }

    const props = await this.getPage<H2RBookProps>(`${DOMAIN}/${mangaId}`, "Book/Show");
    this.lastBook = { mangaId, props, at: Date.now() };
    return props;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const { book, stats, chapters } = await this.getBookProps(mangaId);

    const tagGroups: TagSection[] = [];
    const byKind = (kind: string): Tag[] =>
      (book.tags ?? [])
        .filter((tag) => tag.type === kind && tag.name)
        .map((tag) => ({ id: String(tag.id), title: tag.name }));
    const categories = byKind("category");
    if (categories.length) {
      tagGroups.push({ id: "category", title: "Category", tags: categories });
    }
    const content = byKind("content");
    if (content.length) {
      tagGroups.push({ id: "content", title: "Content", tags: content });
    }
    for (const group of book.groups ?? []) {
      const tags = (group.tags ?? [])
        .filter((tag) => tag.name)
        .map((tag) => ({ id: `${tag.type}-${tag.id}`, title: tag.name }));
      if (tags.length) {
        tagGroups.push({ id: group.type, title: group.label, tags });
      }
    }

    const names = (kind: string): string =>
      (book.groups ?? [])
        .filter((group) => group.type === kind)
        .flatMap((group) => group.tags.map((tag) => tag.name))
        .join(", ");
    const artist = names("artist");
    const author = names("circle");

    const additionalInfo: Record<string, string> = {};
    if (book.type?.label) additionalInfo["Type"] = book.type.label;
    if (book.year) additionalInfo["Released"] = String(book.year);
    if (chapters?.length) additionalInfo["Chapters"] = String(chapters.length);
    if (stats?.views !== undefined) additionalInfo["Views"] = thousands(stats.views);
    if (stats?.ratings) additionalInfo["Ratings"] = thousands(stats.ratings);
    if (stats?.rank) additionalInfo["Rank"] = `#${thousands(stats.rank)}`;
    if (stats?.updated) additionalInfo["Updated"] = stats.updated;
    if (book.badge) additionalInfo["Badge"] = book.badge;

    const status = book.status?.label;
    const rating = stats?.rating;

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: book.title,
        secondaryTitles: book.alt ? [book.alt] : [],
        thumbnailUrl: book.cover ?? coverFallback(book.id),
        synopsis: book.description ? book.description.replace(/<[^>]+>/g, "").trim() : "",
        contentRating: ContentRating.ADULT,
        shareUrl: `${DOMAIN}/${mangaId}`,
        ...(status ? { status } : {}),
        ...(artist ? { artist } : {}),
        ...(author ? { author } : {}),
        ...(rating ? { rating: Math.max(0, Math.min(1, rating / 5)) } : {}),
        ...(tagGroups.length ? { tagGroups } : {}),
        ...(Object.keys(additionalInfo).length ? { additionalInfo } : {}),
      },
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const { chapters = [] } = await this.getBookProps(sourceManga.mangaId);

    const result: Chapter[] = [];
    const seen = new Set<string>();
    for (const [index, entry] of chapters.entries()) {
      const chapterId = String(entry.id);
      if (!entry.id || seen.has(chapterId)) {
        continue;
      }
      seen.add(chapterId);

      const parsed = Number(entry.number);
      const title = entry.title?.trim();
      const published = parseDate(entry.date);
      result.push({
        chapterId,
        sourceManga,
        langCode: "en",
        // The list arrives newest first; fall back to that order when a number is missing.
        chapNum: Number.isFinite(parsed) ? parsed : chapters.length - index,
        ...(title ? { title: entry.isMembers ? `${title} (Members only)` : title } : {}),
        ...(published ? { publishDate: published } : {}),
      });
    }

    return result;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const slug = chapter.sourceManga.mangaId.split("/").pop() ?? chapter.sourceManga.mangaId;
    const props = await this.getPage<H2RReaderProps>(
      `${DOMAIN}/reader/${slug}/${chapter.chapterId}/page-1`,
      "Reader/Show",
    );

    const suffix = props.suffix ?? "";
    const pages = (props.images ?? []).filter((image) => !!image).map((image) => image + suffix);
    if (pages.length === 0) {
      throw new Error(`No pages were returned for chapter ${chapter.chapterId}.`);
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  private async getTags(): Promise<H2RTag[]> {
    const cached = Application.getState(TAGS_STATE_KEY) as TagsCache | undefined;
    if (cached?.tags?.length && Date.now() - cached.fetchedAt < TAGS_TTL_MS) {
      return cached.tags;
    }

    const body = await this.getText(`${DOMAIN}/search/tags`, { accept: "application/json" });
    const tags = (JSON.parse(body) as H2RTag[]).filter((tag) => tag?.id && tag.name);
    if (tags.length === 0) {
      throw new Error("The site returned an empty tag list.");
    }

    Application.setState({ tags, fetchedAt: Date.now() } satisfies TagsCache, TAGS_STATE_KEY);
    return tags;
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<Hentai2readSearchForm> {
    let tags: H2RTag[];
    try {
      tags = await this.getTags();
    } catch {
      tags = FALLBACK_TAGS;
    }

    return new Hentai2readSearchForm(
      query.metadata as H2RFilters | undefined,
      tags.map((tag) => ({ id: String(tag.id), title: tag.name })),
    );
  }

  // The site's artist picker sends artist ids in `with`, so a typed name is
  // resolved through the same lookup the picker uses.
  private async resolveArtist(name: string): Promise<string> {
    const body = await this.getText(`${DOMAIN}/search/artists?q=${encodeURIComponent(name)}`, {
      accept: "application/json",
    });
    const artists = JSON.parse(body) as { id: number; name: string }[];
    const wanted = name.toLowerCase();
    const match = artists.find((artist) => artist.name.toLowerCase() === wanted) ?? artists[0];
    if (!match) {
      throw new Error(`No artist on hentai2read.com matches "${name}".`);
    }

    return String(match.id);
  }

  private async searchUrl(
    title: string,
    filters: H2RFilters | undefined,
    sort: string | undefined,
    page: number,
  ): Promise<string> {
    const params: string[] = [];
    const add = (key: string, value: string | undefined): void => {
      if (value) {
        params.push(`${key}=${encodeURIComponent(value)}`);
      }
    };

    const included: string[] = [];
    const excluded: string[] = [];
    for (const [id, state] of Object.entries(filters?.tags ?? {})) {
      (state === "excluded" ? excluded : included).push(id);
    }
    if (filters?.artist) {
      included.push(await this.resolveArtist(filters.artist));
    }

    add("q", title);
    add("type", filters?.type);
    add("status", filters?.status);
    add("with", included.join(","));
    add("without", excluded.join(","));
    if (filters?.any && included.length) add("match", "any");
    add("sort", sort && sort !== BEST_MATCH ? sort : undefined);
    params.push(`page=${page}`);

    return `${DOMAIN}/search?${params.join("&")}`;
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const paging = metadata as H2RPaging | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    const page = paging?.page ?? 1;
    const url = await this.searchUrl(
      (query.title ?? "").trim(),
      query.metadata as H2RFilters | undefined,
      sortingOption?.id,
      page,
    );
    const props = await this.getPage<H2RListingProps>(url, "Search/Index");
    const books = props.books;

    return {
      items: (books?.data ?? []).map((book) => toSearchResult(book)),
      metadata: books && books.page < books.lastPage ? { page: page + 1 } : { completed: true },
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: "staff_pick", title: "Staff pick of the day", type: DiscoverSectionType.featured },
      ...LISTING_SECTIONS.map((section) => ({
        id: section.id,
        title: section.title,
        type: DiscoverSectionType.simpleCarousel,
      })),
      { id: "tags", title: "Tags", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: Metadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "tags") {
      const tags = await this.getTags();
      return {
        items: tags.map((tag) => ({
          type: "genresCarouselItem" as const,
          name: tag.name,
          searchQuery: {
            title: "",
            metadata: { tags: { [String(tag.id)]: "included" } } satisfies H2RFilters,
          },
        })),
      };
    }

    const paging = metadata as H2RPaging | undefined;
    if (paging?.completed) {
      return { items: [] };
    }

    if (section.id === "staff_pick") {
      const props = await this.getPage<H2RHomeProps>(`${DOMAIN}/`, "Home");
      const book = props.pick?.book;
      if (!book) {
        throw new Error("The home page has no staff pick.");
      }

      const details = [
        book.typeLabel,
        book.pageCount ? `${book.pageCount} pages` : undefined,
        book.artist?.name ? `by ${book.artist.name}` : undefined,
      ].filter(Boolean);
      return {
        items: [
          {
            type: "featuredCarouselItem" as const,
            mangaId: mangaIdOf(book),
            imageUrl: book.cover ?? coverFallback(book.id),
            title: book.title,
            supertitle: "Staff pick of the day",
            summary: book.description ?? details.join(" · "),
            contentRating: ContentRating.ADULT,
          },
        ],
        metadata: { completed: true },
      };
    }

    const listing = LISTING_SECTIONS.find((entry) => entry.id === section.id);
    if (!listing) {
      throw new Error(`Unknown discover section "${section.id}".`);
    }

    const page = paging?.page ?? 1;
    const url = `${DOMAIN}${listing.path}${listing.path.includes("?") ? "&" : "?"}page=${page}`;

    let books: H2RBook[];
    let lastPage: number;
    if (listing.path === "/ranking") {
      const props = await this.getPage<H2RRankingProps>(url, "Ranking/Index");
      books = [...(props.podium ?? []), ...(props.grid ?? [])];
      lastPage = props.pages?.lastPage ?? page;
    } else {
      const component = listing.path.startsWith("/search") ? "Search/Index" : "Browse/Index";
      const props = await this.getPage<H2RListingProps>(url, component);
      books = props.books?.data ?? [];
      lastPage = props.books?.lastPage ?? page;
    }

    return {
      items: books
        .filter((book) => book?.url && book.title)
        .map((book) => {
          const { mangaId, title, imageUrl, subtitle } = toSearchResult(book);
          return {
            type: "simpleCarouselItem" as const,
            mangaId,
            title,
            imageUrl,
            contentRating: ContentRating.ADULT,
            ...(subtitle ? { subtitle } : {}),
          };
        }),
      metadata: page < lastPage ? { page: page + 1 } : { completed: true },
    };
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      this.cookieStorage.setCookie(cookie);
    }
  }
}

// Ids are the site path without the leading slash, e.g. doujinshi/71963-chaldea-night.
function mangaIdOf(book: H2RBook): string {
  return book.url.replace(/^\/+/, "");
}

function coverFallback(id: number): string {
  return `https://hentaicdn.com/hentai/cover/_S${id}.jpg`;
}

function toSearchResult(book: H2RBook): SearchResultItem {
  const subtitle = book.artist?.name || (book.pageCount ? `${book.pageCount} pages` : "");

  return {
    mangaId: mangaIdOf(book),
    title: book.title,
    imageUrl: book.cover || coverFallback(book.id),
    contentRating: ContentRating.ADULT,
    ...(subtitle ? { subtitle } : {}),
  };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// Chapter dates arrive as "Feb 28, 2026".
function parseDate(value: string | null | undefined): Date | undefined {
  const match = /^([A-Za-z]{3})\w* (\d{1,2}), (\d{4})$/.exec(value?.trim() ?? "");
  if (!match) {
    return undefined;
  }

  const month = MONTHS.indexOf(match[1].toLowerCase());
  if (month < 0) {
    return undefined;
  }

  return new Date(Date.UTC(Number(match[3]), month, Number(match[2])));
}

function thousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export const Hentai2read = new Hentai2readExtension();
