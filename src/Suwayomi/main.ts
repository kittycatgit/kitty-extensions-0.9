/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  ContentRating,
  DiscoverSectionType,
  type Chapter,
  type ChapterDetails,
  type ChapterReadActionQueueProcessingResult,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type Form,
  type ManagedCollection,
  type ManagedCollectionChangeset,
  type MangaProgress,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
  type SourceManga,
  type TrackedMangaChapterReadAction,
} from "@paperback/types";

import { gql, signIn } from "./auth";
import {
  absolute,
  CHAPTER_FIELDS,
  coverUrl,
  LATEST,
  LIBRARY,
  LOCAL_SOURCE,
  MANGA_FIELDS,
  PAGE_SIZE,
  POPULAR,
  requireSettings,
  STATUSES,
  storedKeep,
  storedLanguages,
  UPDATES,
  type SuwayomiChapter,
  type SuwayomiManga,
  type SuwayomiMetadata,
  type SuwayomiSearchMetadata,
  type SuwayomiSource,
} from "./models";
import { SuwayomiInterceptor } from "./network";
import pbconfig from "./pbconfig";
import { SuwayomiProgressForm, type TitleState } from "./progress";
import { SuwayomiSearchForm } from "./search";
import { SuwayomiSettings } from "./settings";

type Listing = "POPULAR" | "LATEST" | "SEARCH";

interface Page {
  hasNextPage: boolean;
  mangas: SuwayomiManga[];
}

interface Card {
  mangaId: string;
  title: string;
  imageUrl: string;
  contentRating: ContentRating;
  subtitle?: string;
}

const DAY_SECONDS = 24 * 60 * 60;
const MAX_TAGS = 30;

// Sites pad names with zero-width characters.
const clean = (text: string | null | undefined): string =>
  (text ?? "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
const SOURCE_FIELDS = "id name lang displayName supportsLatest contentWarning";

const mangaNumber = (mangaId: string): number => {
  const id = Number(mangaId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Not a Suwayomi title id: ${mangaId}`);
  }

  return id;
};

const rating = (source: SuwayomiSource | null | undefined): ContentRating =>
  source?.contentWarning === "NSFW" ? ContentRating.ADULT : ContentRating.EVERYONE;

class SuwayomiExtension implements ExtensionImpl<typeof pbconfig> {
  // Held here because the app only keeps a weak reference to interceptors.
  private readonly interceptor = new SuwayomiInterceptor("main");

  async initialise(): Promise<void> {
    this.interceptor.registerInterceptor();
  }

  // --- Sources --------------------------------------------------------------

  private async sources(): Promise<SuwayomiSource[]> {
    const data = await gql<{ sources: { nodes: SuwayomiSource[] } }>(
      `{ sources { nodes { ${SOURCE_FIELDS} } } }`,
    );

    return data.sources.nodes.filter((source) => source.id !== LOCAL_SOURCE);
  }

  private enabled(sources: SuwayomiSource[]): SuwayomiSource[] {
    const languages = storedLanguages();

    return sources
      .filter((source) => source.id !== LOCAL_SOURCE && languages.includes(source.lang))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  private async browse(
    source: SuwayomiSource,
    type: Listing,
    page: number,
    query?: string,
  ): Promise<Page> {
    const data = await gql<{ fetchSourceManga: Page }>(
      "mutation($source:LongString!,$type:FetchSourceMangaType!,$page:Int!,$query:String){ fetchSourceManga(input:{source:$source,type:$type,page:$page,query:$query}) { hasNextPage mangas { id title thumbnailUrl user { inLibrary } } } }",
      { source: source.id, type, page, query: query ?? null },
    );

    return data.fetchSourceManga;
  }

  private toResult(manga: SuwayomiManga, source?: SuwayomiSource): Card {
    const { server } = requireSettings();
    const subtitle = [source?.name, manga.user?.inLibrary ? "In library" : ""]
      .filter(Boolean)
      .join(" · ");

    return {
      mangaId: String(manga.id),
      title: manga.title.trim() || `Title ${manga.id}`,
      imageUrl: coverUrl(server, manga.thumbnailUrl),
      contentRating: rating(source ?? manga.source),
      ...(subtitle ? { subtitle } : {}),
    };
  }

  // --- Home -----------------------------------------------------------------

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    const data = await gql<{
      sources: { nodes: SuwayomiSource[] };
      mangas: { totalCount: number };
    }>(
      `{ sources { nodes { ${SOURCE_FIELDS} } } mangas(condition:{inLibrary:true}) { totalCount } }`,
    );

    const library: DiscoverSection[] =
      data.mangas.totalCount > 0
        ? [
            {
              id: UPDATES,
              title: "Latest in your library",
              type: DiscoverSectionType.chapterUpdates,
            },
            { id: LIBRARY, title: "Server library", type: DiscoverSectionType.prominentCarousel },
          ]
        : [];

    const rows = this.enabled(data.sources.nodes).flatMap((source) => [
      {
        id: `${POPULAR}_${source.id}`,
        title: `Popular on ${source.name}`,
        type: DiscoverSectionType.simpleCarousel,
      },
      ...(source.supportsLatest
        ? [
            {
              id: `${LATEST}_${source.id}`,
              title: `Latest on ${source.name}`,
              type: DiscoverSectionType.simpleCarousel,
            },
          ]
        : []),
    ]);

    return [...library, ...rows];
  }

  private async libraryPage(offset: number): Promise<{ rows: SuwayomiManga[]; more: boolean }> {
    const data = await gql<{
      mangas: { nodes: SuwayomiManga[]; pageInfo: { hasNextPage: boolean } };
    }>(
      `query($first:Int!,$offset:Int!){ mangas(condition:{inLibrary:true}, order:[{by:TITLE,byType:ASC}], first:$first, offset:$offset) { pageInfo { hasNextPage } nodes { ${MANGA_FIELDS} } } }`,
      { first: PAGE_SIZE, offset },
    );

    return { rows: data.mangas.nodes, more: data.mangas.pageInfo.hasNextPage };
  }

  // One row per title, newest release first. Listing chapters instead would
  // fill the rail with every chapter of whichever title was added last.
  private async updates(): Promise<DiscoverSectionItem[]> {
    const { server } = requireSettings();
    const data = await gql<{
      mangas: { nodes: (SuwayomiManga & { latestUploadedChapter?: SuwayomiChapter | null })[] };
    }>(
      "{ mangas(condition:{inLibrary:true}) { nodes { id title thumbnailUrl source { contentWarning } latestUploadedChapter { id name uploadDate } } } }",
    );

    return data.mangas.nodes
      .flatMap((manga) =>
        manga.latestUploadedChapter ? [{ manga, chapter: manga.latestUploadedChapter }] : [],
      )
      .sort((a, b) => Number(b.chapter.uploadDate ?? 0) - Number(a.chapter.uploadDate ?? 0))
      .map(({ manga, chapter }) => {
        const uploaded = Number(chapter.uploadDate ?? 0);

        return {
          type: "chapterUpdatesCarouselItem" as const,
          mangaId: String(manga.id),
          chapterId: String(chapter.id),
          imageUrl: coverUrl(server, manga.thumbnailUrl),
          title: manga.title,
          subtitle: chapter.name,
          contentRating: rating(manga.source),
          ...(uploaded > 0 ? { publishDate: new Date(uploaded) } : {}),
        };
      });
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: SuwayomiMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    if (section.id === UPDATES) {
      return { items: await this.updates(), metadata: { completed: true } };
    }

    if (section.id === LIBRARY) {
      const offset = metadata?.offset ?? 0;
      const { rows, more } = await this.libraryPage(offset);

      return {
        items: rows.map((manga) => {
          const unread = manga.user?.unreadCount ?? 0;

          return {
            ...this.toResult(manga),
            type: "prominentCarouselItem" as const,
            subtitle: unread > 0 ? `${unread} unread` : (manga.source?.name ?? "Up to date"),
          };
        }),
        metadata: more ? { offset: offset + rows.length } : { completed: true },
      };
    }

    const [, kind, sourceId] = /^(popular|latest)_(\d+)$/.exec(section.id) ?? [];
    const source = (await this.sources()).find((candidate) => candidate.id === sourceId);

    if (!kind || !source) {
      throw new Error(`Invalid sectionId provided: ${section.id}`);
    }

    const page = metadata?.page ?? 1;
    const listing = await this.browse(source, kind === LATEST ? "LATEST" : "POPULAR", page);

    return {
      items: listing.mangas.map((manga) => {
        const { subtitle, ...item } = this.toResult(manga);

        return {
          ...item,
          type: "simpleCarouselItem" as const,
          contentRating: rating(source),
          ...(subtitle ? { subtitle } : {}),
        };
      }),
      metadata: listing.hasNextPage ? { page: page + 1 } : { completed: true },
    };
  }

  // --- Search ---------------------------------------------------------------

  async getAdvancedSearchForm(
    query: SearchQuery<SuwayomiSearchMetadata>,
  ): Promise<SuwayomiSearchForm> {
    return new SuwayomiSearchForm(query.metadata, this.enabled(await this.sources()));
  }

  // Every site is asked at once and the answers are dealt out in turn, so one
  // slow or broken site neither hides nor buries the others.
  async getSearchResults(
    query: SearchQuery<SuwayomiSearchMetadata>,
    metadata: SuwayomiMetadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const term = (query.title ?? "").trim();
    const picked = query.metadata?.sources ?? [];
    const sites = this.enabled(await this.sources()).filter(
      (source) =>
        (picked.length === 0 || picked.includes(source.id)) &&
        (!metadata?.open || metadata.open.includes(source.id)),
    );

    if (sites.length === 0) {
      throw new Error(
        "No sites to search. Install one on your Suwayomi server, or check the languages in this source's settings.",
      );
    }

    const page = metadata?.page ?? 1;
    const answers = await Promise.allSettled(
      sites.map((source) => this.browse(source, term ? "SEARCH" : "POPULAR", page, term)),
    );
    const failure = answers.find((answer) => answer.status === "rejected");

    if (failure && answers.every((answer) => answer.status === "rejected")) {
      throw failure.reason instanceof Error ? failure.reason : new Error(String(failure.reason));
    }

    const lists = answers.map((answer, index) =>
      answer.status === "fulfilled"
        ? answer.value.mangas.map((manga) => this.toResult(manga, sites[index]))
        : [],
    );
    const items: SearchResultItem[] = [];

    for (let row = 0; lists.some((list) => row < list.length); row++) {
      for (const list of lists) {
        const item = list[row];

        if (item) {
          items.push(item);
        }
      }
    }

    const open = sites
      .filter((_, index) => {
        const answer = answers[index];

        return answer?.status === "fulfilled" && answer.value.hasNextPage;
      })
      .map((source) => source.id);

    return { items, metadata: open.length > 0 ? { page: page + 1, open } : { completed: true } };
  }

  // --- Titles ---------------------------------------------------------------

  private toManga(manga: SuwayomiManga): SourceManga {
    const { server } = requireSettings();
    const tags = new Map<string, string>();

    // Some sites list hundreds of themes per title; the first ones are the genres.
    for (const genre of (manga.genre ?? []).slice(0, MAX_TAGS)) {
      const id = genre
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

      if (id) {
        tags.set(id, genre.trim());
      }
    }

    const author = clean(manga.author);
    const artist = clean(manga.artist);
    const downloaded = manga.user?.downloadCount ?? 0;

    return {
      mangaId: String(manga.id),
      mangaInfo: {
        primaryTitle: manga.title.trim() || `Title ${manga.id}`,
        secondaryTitles: [],
        thumbnailUrl: coverUrl(server, manga.thumbnailUrl),
        synopsis: (manga.description ?? "").trim(),
        contentRating: rating(manga.source),
        status: STATUSES[manga.status ?? ""] ?? "Unknown",
        shareUrl: manga.realUrl || `${server}/manga/${manga.id}`,
        ...(author ? { author } : {}),
        ...(artist ? { artist } : {}),
        ...(tags.size > 0
          ? {
              tagGroups: [
                {
                  id: "genres",
                  title: "Genres",
                  tags: [...tags].map(([id, title]) => ({ id, title })),
                },
              ],
            }
          : {}),
        additionalInfo: {
          ...(manga.source ? { Site: manga.source.displayName } : {}),
          ...(manga.user?.inLibrary ? { "Server library": "Added" } : {}),
          ...(downloaded > 0 ? { "Downloaded on server": String(downloaded) } : {}),
        },
      },
    };
  }

  // The server's copy answers unless it is over a day old. A site that is down
  // must not take a title the server already holds with it.
  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const id = mangaNumber(mangaId);
    const { manga: kept } = await gql<{ manga: SuwayomiManga }>(
      `query($id:Int!){ manga(id:$id) { ${MANGA_FIELDS} } }`,
      { id },
    );
    const age = Date.now() / 1000 - Number(kept.lastFetchedAt ?? 0);

    if (kept.initialized && age < DAY_SECONDS) {
      return this.toManga(kept);
    }

    try {
      const data = await gql<{ fetchMangaAndChapters: { manga: SuwayomiManga } }>(
        `mutation($id:Int!){ fetchMangaAndChapters(input:{id:$id,fetchManga:true,fetchChapters:false}) { manga { ${MANGA_FIELDS} } } }`,
        { id },
      );

      return this.toManga(data.fetchMangaAndChapters.manga);
    } catch (error: unknown) {
      if (!kept.initialized) {
        throw error;
      }

      return this.toManga(kept);
    }
  }

  // --- Chapters -------------------------------------------------------------

  private async keptChapters(id: number): Promise<{ lang: string; rows: SuwayomiChapter[] }> {
    const data = await gql<{
      manga: { source?: { lang?: string } | null };
      chapters: { nodes: SuwayomiChapter[] };
    }>(
      `query($id:Int!){ manga(id:$id) { source { lang } } chapters(condition:{mangaId:$id}, order:[{by:SOURCE_ORDER,byType:DESC}]) { nodes { ${CHAPTER_FIELDS} } } }`,
      { id },
    );

    return { lang: data.manga.source?.lang ?? "", rows: data.chapters.nodes };
  }

  private async liveChapters(id: number): Promise<{ lang: string; rows: SuwayomiChapter[] }> {
    const data = await gql<{
      fetchMangaAndChapters: {
        manga: { source?: { lang?: string } | null };
        chapters: SuwayomiChapter[];
      };
    }>(
      `mutation($id:Int!){ fetchMangaAndChapters(input:{id:$id,fetchManga:false,fetchChapters:true}) { manga { source { lang } } chapters { ${CHAPTER_FIELDS} } } }`,
      { id },
    );

    return {
      lang: data.fetchMangaAndChapters.manga.source?.lang ?? "",
      rows: data.fetchMangaAndChapters.chapters,
    };
  }

  // What the server already knows, asking the site only for a title it has
  // never listed. Progress and downloads should not cost a site visit.
  private async knownChapters(id: number): Promise<SuwayomiChapter[]> {
    const kept = await this.keptChapters(id);

    return kept.rows.length > 0 ? kept.rows : (await this.liveChapters(id)).rows;
  }

  private toChapter(row: SuwayomiChapter, sourceManga: SourceManga, lang: string): Chapter {
    // The server marks a number it could not read from the name with -1.
    const number = row.chapterNumber >= 0 ? row.chapterNumber : row.sourceOrder;
    const name = row.name.trim().replace(/^(?:chapter|ch\.?)\s*[\d.]+\s*[-:–—]?\s*/i, "");
    const scanlator = (row.scanlator ?? "").trim();
    const uploaded = Number(row.uploadDate ?? 0);

    return {
      chapterId: String(row.id),
      sourceManga,
      langCode: /^[a-z]{2}(-[a-z0-9]+)?$/i.test(lang) ? lang.toLowerCase() : "en",
      chapNum: number,
      sortingIndex: row.sourceOrder,
      ...(name ? { title: name } : {}),
      ...(scanlator ? { version: scanlator } : {}),
      ...(uploaded > 0 ? { publishDate: new Date(uploaded) } : {}),
    };
  }

  // The site is asked every time so new chapters show up. When it cannot be
  // reached the server's own list still opens, which is the point of downloads.
  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const id = mangaNumber(sourceManga.mangaId);
    let listed: { lang: string; rows: SuwayomiChapter[] };

    try {
      listed = await this.liveChapters(id);
    } catch (error: unknown) {
      listed = await this.keptChapters(id);

      if (listed.rows.length === 0) {
        throw error;
      }
    }

    return listed.rows
      .map((row) => this.toChapter(row, sourceManga, listed.lang))
      .sort((a, b) => (b.sortingIndex ?? 0) - (a.sortingIndex ?? 0));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const { server } = requireSettings();
    const chapterId = Number(chapter.chapterId);
    const data = await gql<{ fetchChapterPages: { pages: string[] } }>(
      "mutation($id:Int!){ fetchChapterPages(input:{chapterId:$id}) { pages } }",
      { id: chapterId },
    );
    const pages = data.fetchChapterPages.pages.map((path) => absolute(server, path));

    if (pages.length === 0) {
      throw new Error("Suwayomi found no pages for this chapter.");
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  // --- Server library and downloads -----------------------------------------

  private async setKeep(keep: boolean): Promise<void> {
    // The server skips titles with unread chapters by default, which is every
    // title read here rather than there.
    await gql(
      "mutation($settings:PartialUserSettingsTypeInput!){ setUserSettings(input:{userSettings:$settings}) { clientMutationId } }",
      {
        settings: keep
          ? {
              autoDownloadNewChapters: true,
              excludeEntryWithUnreadChapters: false,
              excludeUnreadChapters: false,
              excludeNotStarted: false,
            }
          : { autoDownloadNewChapters: false },
      },
    );
  }

  private async download(id: number): Promise<number> {
    const ids = (await this.knownChapters(id))
      .filter((row) => !row.user?.isDownloaded)
      .map((row) => row.id);

    if (ids.length > 0) {
      await gql(
        "mutation($ids:[Int!]!){ enqueueChapterDownloads(input:{ids:$ids}) { clientMutationId } startDownloader(input:{}) { clientMutationId } }",
        { ids },
      );
    }

    return ids.length;
  }

  private async setLibrary(ids: number[], inLibrary: boolean): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await gql(
      "mutation($ids:[Int!]!,$inLibrary:Boolean!){ updateMangas(input:{ids:$ids,patch:{inLibrary:$inLibrary}}) { clientMutationId } }",
      { ids, inLibrary },
    );

    if (inLibrary && storedKeep()) {
      await this.setKeep(true);

      for (const id of ids) {
        await this.download(id);
      }
    }
  }

  async getManagedLibraryCollections(): Promise<ManagedCollection[]> {
    return [{ id: LIBRARY, title: "Suwayomi library" }];
  }

  async getSourceMangaInManagedCollection(_collection: ManagedCollection): Promise<SourceManga[]> {
    const titles: SourceManga[] = [];

    for (let more = true; more;) {
      const page = await this.libraryPage(titles.length);

      titles.push(...page.rows.map((manga) => this.toManga(manga)));
      more = page.more && page.rows.length > 0;
    }

    return titles;
  }

  async commitManagedCollectionChanges(changeset: ManagedCollectionChangeset): Promise<void> {
    const ids = (titles: SourceManga[] | undefined): number[] =>
      (titles ?? []).map((manga) => mangaNumber(manga.mangaId));

    await this.setLibrary(ids(changeset.deletions), false);
    await this.setLibrary(ids(changeset.additions), true);
  }

  // --- Progress -------------------------------------------------------------

  async getMangaProgress(sourceManga: SourceManga): Promise<MangaProgress | undefined> {
    try {
      const { lang, rows } = await this.keptChapters(mangaNumber(sourceManga.mangaId));
      // Rows arrive newest first, so the first read one is the furthest.
      const furthest = rows.find((row) => row.user?.isRead);

      return furthest
        ? { sourceManga, lastReadChapter: this.toChapter(furthest, sourceManga, lang) }
        : undefined;
    } catch {
      // Progress is a side question; a server that cannot answer it should not
      // break the rest of the source.
      return undefined;
    }
  }

  private async markRead(ids: number[], isRead: boolean): Promise<void> {
    await gql(
      "mutation($ids:[Int!]!,$isRead:Boolean!){ updateChapters(input:{ids:$ids,patch:{isRead:$isRead}}) { clientMutationId } }",
      { ids, isRead },
    );
  }

  async processChapterReadActionQueue(
    actions: TrackedMangaChapterReadAction[],
  ): Promise<ChapterReadActionQueueProcessingResult> {
    const successfulItems: string[] = [];
    const failedItems: string[] = [];
    const byTitle = new Map<string, TrackedMangaChapterReadAction[]>();

    for (const action of actions) {
      // The tracked title's own id; `chapterMangaId` would belong to whichever
      // source the chapter was actually read from.
      const mangaId = action.sourceManga.mangaId;

      byTitle.set(mangaId, [...(byTitle.get(mangaId) ?? []), action]);
    }

    for (const [mangaId, group] of byTitle) {
      const matched = new Map<string, number>();

      try {
        const rows = await this.knownChapters(mangaNumber(mangaId));

        for (const action of group) {
          // The action's chapter id is only ours if the chapter was read here;
          // for a title read from another source, match on chapter number.
          const row =
            rows.find((candidate) => String(candidate.id) === action.chapterId) ??
            rows.find((candidate) => Math.abs(candidate.chapterNumber - action.chapterNum) < 0.001);

          if (row) {
            matched.set(action.id, row.id);
          }
        }

        if (matched.size > 0) {
          await this.markRead([...new Set(matched.values())], true);
        }
      } catch {
        matched.clear();
      }

      for (const action of group) {
        (matched.has(action.id) ? successfulItems : failedItems).push(action.id);
      }
    }

    return { successfulItems, failedItems };
  }

  async getMangaProgressManagementForm(sourceManga: SourceManga): Promise<Form> {
    const id = mangaNumber(sourceManga.mangaId);
    const state = async (): Promise<TitleState> => {
      const data = await gql<{
        manga: SuwayomiManga & { chapters: { totalCount: number } };
      }>(
        "query($id:Int!){ manga(id:$id) { id title chapters { totalCount } user { inLibrary unreadCount downloadCount } } }",
        { id },
      );

      return {
        inLibrary: data.manga.user?.inLibrary === true,
        chapters: data.manga.chapters.totalCount,
        downloaded: data.manga.user?.downloadCount ?? 0,
        unread: data.manga.user?.unreadCount ?? 0,
      };
    };
    const everyChapter = async (): Promise<number[]> =>
      (await this.knownChapters(id)).map((row) => row.id);

    return new SuwayomiProgressForm(
      (sourceManga.mangaInfo?.primaryTitle ?? "").trim() || `Title ${id}`,
      await state(),
      {
        state,
        setLibrary: async (inLibrary) => {
          await this.setLibrary([id], inLibrary);

          if (!inLibrary) {
            return "Removed from your server library.";
          }

          return storedKeep()
            ? "Added to your server library; the server is downloading it."
            : "Added to your server library.";
        },
        download: async () => {
          const queued = await this.download(id);

          return queued > 0
            ? `The server is downloading ${queued} chapter${queued === 1 ? "" : "s"}.`
            : "Every chapter is already on the server.";
        },
        markRead: async (read) => {
          await this.markRead(await everyChapter(), read);

          return read ? "Marked as read on Suwayomi." : "Marked as unread on Suwayomi.";
        },
      },
    );
  }

  // --- Settings -------------------------------------------------------------

  async getSettingsForm(): Promise<SuwayomiSettings> {
    const languages = (sources: SuwayomiSource[]): string[] => [
      ...new Set(sources.map((source) => source.lang)),
    ];
    // Unset or unreachable just means the list fills in after a connection test.
    const known = await this.sources()
      .then(languages)
      .catch(() => []);

    return new SuwayomiSettings(known, {
      check: async () => {
        const credentials = requireSettings();

        await signIn(credentials);

        const data = await gql<{ mangas: { totalCount: number } }>(
          "{ mangas(condition:{inLibrary:true}) { totalCount } }",
        );
        const sources = await this.sources();
        const names = this.enabled(sources).map((source) => source.name);

        if (storedKeep()) {
          await this.setKeep(true);
        }

        return {
          languages: languages(sources),
          summary: `Signed in as ${credentials.username}. ${
            names.length > 0 ? `Sites: ${names.join(", ")}.` : "No sites in your languages yet."
          } Library: ${data.mangas.totalCount} title${data.mangas.totalCount === 1 ? "" : "s"}.`,
        };
      },
      setKeep: (keep) => this.setKeep(keep),
    });
  }
}

export const Suwayomi = new SuwayomiExtension();
