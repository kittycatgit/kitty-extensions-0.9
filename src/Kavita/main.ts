/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  DiscoverSectionType,
  type Chapter,
  type ChapterDetails,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
  type SourceManga,
} from "@paperback/types";

import {
  FORMAT_ARCHIVE,
  imageKeyFrom,
  MODE_API_KEY,
  FORMAT_EPUB,
  FORMAT_PDF,
  PAGE_SIZE,
  pageUrl,
  requireSettings,
  navSource,
  navTitle,
  STREAM_PATHS,
  streamTitle,
  seriesCoverUrl,
  type KavitaCredentials,
  type KavitaChapter,
  type KavitaDashboardStream,
  type KavitaLibrary,
  type KavitaLogin,
  type KavitaMetadata,
  type KavitaSeries,
  type KavitaSeriesDetail,
  type KavitaSideNavStream,
} from "./models";
import pbconfig from "./pbconfig";
import { KavitaSettings } from "./settings";

/**
 * The sign-in this source holds for the life of the extension.
 *
 * Either method ends the same way: the server hands back a token to use for
 * everything else, and a key to put in artwork addresses. Neither is stored -
 * the token is short-lived, and both are one request away from details that
 * are already saved.
 *
 * The fingerprint is what the settings were when this was made, so a reader
 * who edits them is signed in again rather than left on a stale token.
 */
interface Session {
  fingerprint: string;
  server: string;
  username: string;
  token: string;
  imageKey: string;
}

let session: Session | undefined;

/**
 * What the chapter listing already told us.
 *
 * Kavita's series-detail answer carries every chapter's page count, so asking
 * chapter-info for it again is a second round trip for something already known
 * - and on some chapters that endpoint answers 500, which took the chapter down
 * with it. Reading a series fills these in, and opening a chapter reads them.
 */
const chapterPages = new Map<string, number>();
const seriesFormat = new Map<string, number>();

/** What a sign-in was made from, for noticing when it no longer matches. */
function fingerprint(credentials: KavitaCredentials): string {
  return credentials.mode === MODE_API_KEY
    ? [credentials.server, credentials.mode, credentials.apiKey].join("\n")
    : [credentials.server, credentials.mode, credentials.username, credentials.password].join("\n");
}

/**
 * The discover rows are Kavita's own dashboard, not a set chosen here.
 *
 * A reader arranges their dashboard in Kavita - which rows, in which order,
 * hidden or shown - and this source asks the server for that arrangement and
 * mirrors it. A row's id carries the stream's own id and kind so that opening
 * one later needs no memory of this call.
 */
const STREAM_PREFIX = "stream_";
const NAV_PREFIX = "nav_";

class KavitaExtension implements ExtensionImpl<typeof pbconfig> {
  async initialise(): Promise<void> {
    // Nothing to register. Every address this source hands over already carries
    // the key it needs, so the app fetches artwork with nothing in its way.
  }

  async getSettingsForm(): Promise<KavitaSettings> {
    return new KavitaSettings(async (credentials) => {
      const fresh = await this.authenticate(credentials);
      const libraries = await this.request<KavitaLibrary[]>("/api/Library/libraries", {
        server: fresh.server,
        token: fresh.token,
      });

      session = fresh;

      return { user: fresh.username, libraries: libraries ?? [] };
    });
  }

  /** Signs in by whichever method the reader chose, or says why the server refused. */
  private async authenticate(credentials: KavitaCredentials): Promise<Session> {
    const byKey = credentials.mode === MODE_API_KEY;
    const [response, buffer] = byKey
      ? await Application.scheduleRequest({
          url: `${credentials.server}/api/Plugin/authenticate?apiKey=${encodeURIComponent(credentials.apiKey)}&pluginName=Paperback`,
          method: "POST",
        })
      : await Application.scheduleRequest({
          url: `${credentials.server}/api/Account/login`,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            username: credentials.username,
            password: credentials.password,
          }),
        });

    // Kavita answers a key it does not know by throwing, which reaches us as a
    // 500 whose body still says 401. Reading the body keeps a wrong key from
    // being reported as an unreachable server.
    const text = Application.arrayBufferToUTF8String(buffer);
    const refused =
      response.status === 401 ||
      response.status === 400 ||
      (response.status === 500 && /"status"\s*:\s*401/.test(text));

    if (refused) {
      throw new Error(
        byKey
          ? "Kavita did not accept that API key. If it was issued a while ago it may have expired."
          : "Kavita did not accept that username and password.",
      );
    }

    if (response.status !== 200) {
      throw new Error(
        `Kavita answered ${response.status}. Check the address is right and the server is reachable.`,
      );
    }

    const body = JSON.parse(text) as KavitaLogin;

    if (!body?.token) {
      throw new Error("Kavita accepted the sign-in but returned no token.");
    }

    return {
      fingerprint: fingerprint(credentials),
      server: credentials.server,
      username: (body.username ?? "").trim() || "your account",
      token: body.token,
      // A key the reader gave us is itself a key, so it can address artwork if
      // the server did not name one in its answer.
      imageKey: imageKeyFrom(body, byKey ? credentials.apiKey : ""),
    };
  }

  /** The current sign-in, made if there is not one yet. */
  private async signedIn(): Promise<Session> {
    const credentials = requireSettings();
    const wanted = fingerprint(credentials);

    if (session && session.fingerprint === wanted) {
      return session;
    }

    session = await this.authenticate(credentials);

    return session;
  }

  /**
   * One call to the server.
   *
   * The token is put on the request here rather than by an interceptor. An
   * interceptor that had to sign in would be issuing a request from inside the
   * handling of one, and asking for a token is itself a request - so it would
   * be waiting on the queue it was holding.
   *
   * A token that has aged out is signed in again and the call repeated once.
   * The password behind it does not expire, so this is a thing that can be put
   * right here rather than an error the reader has to go and act on.
   */
  private async request<T>(
    path: string,
    where: { server: string; token: string },
    body?: unknown,
  ): Promise<T> {
    let token = where.token;

    for (let attempt = 0; ; attempt++) {
      const [response, buffer] = await Application.scheduleRequest({
        url: `${where.server}${path}`,
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      if (response.status === 401 && attempt === 0) {
        session = undefined;
        token = (await this.signedIn()).token;
        continue;
      }

      if (response.status === 401) {
        throw new Error(
          "Kavita refused the sign-in. Check your username and password in this source's settings.",
        );
      }

      if (response.status !== 200) {
        throw new Error(`Kavita answered ${response.status} for ${path}.`);
      }

      const text = Application.arrayBufferToUTF8String(buffer).trim();

      return (text.length > 0 ? JSON.parse(text) : null) as T;
    }
  }

  /** A series row as the app shows it in a list. */
  private toResult(series: KavitaSeries, server: string, imageKey: string): SearchResultItem {
    // The recently-updated row carries both an id of its own and the series id,
    // and its own is zero - so the first *usable* number wins rather than the
    // first one present. Taking `id ?? seriesId` sent every one of those rows
    // to series 0.
    const id =
      [series.seriesId, series.id].find((value) => typeof value === "number" && value > 0) ?? 0;
    const read = series.pagesRead ?? 0;
    const pages = series.pages ?? 0;
    const subtitle = pages > 0 && read > 0 && read < pages ? `${read} of ${pages} pages read` : "";

    return {
      mangaId: String(id),
      title: (series.name ?? series.seriesName ?? "").trim() || `Series ${id}`,
      imageUrl: seriesCoverUrl(server, imageKey, id),
      ...(subtitle ? { subtitle } : {}),
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const { server, imageKey, token } = await this.signedIn();
    const series = await this.request<KavitaSeries & { summary?: string }>(
      `/api/Series/${encodeURIComponent(mangaId)}`,
      { server, token },
    );

    const metadata = await this.request<{ summary?: string; genres?: { title?: string }[] }>(
      `/api/Series/metadata?seriesId=${encodeURIComponent(mangaId)}`,
      { server, token },
    ).catch(() => undefined);

    seriesFormat.set(mangaId, series?.format ?? FORMAT_ARCHIVE);

    const secondary = [series?.originalName, series?.localizedName]
      .map((value) => (value ?? "").trim())
      .filter((value) => value.length > 0 && value !== (series?.name ?? "").trim());

    const genres = (metadata?.genres ?? [])
      .map((genre) => (genre.title ?? "").trim())
      .filter((title) => title.length > 0);

    return {
      mangaId,
      mangaInfo: {
        primaryTitle: (series?.name ?? "").trim() || `Series ${mangaId}`,
        secondaryTitles: [...new Set(secondary)],
        thumbnailUrl: seriesCoverUrl(server, imageKey, Number(mangaId)),
        synopsis: (metadata?.summary ?? "").replace(/<[^>]+>/g, "").trim(),
        contentRating: pbconfig.contentRating,
        status: "Unknown",
        shareUrl: `${server}/library/${series?.libraryId ?? 0}/series/${mangaId}`,
        ...(genres.length
          ? {
              tagGroups: [
                {
                  id: "genres",
                  title: "Genres",
                  tags: genres.map((title) => ({
                    id: title.toLowerCase().replace(/\s+/g, "-"),
                    title,
                  })),
                },
              ],
            }
          : {}),
      },
    };
  }

  /**
   * A series' chapters, newest first.
   *
   * Kavita keeps chapters inside volumes and also offers them already in
   * reading order, which is what is used when the server gives it - that
   * ordering is the server's own answer to specials, one-shots and volumes that
   * carry no chapter number.
   */
  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const { server, token } = await this.signedIn();
    const detail = await this.request<KavitaSeriesDetail>(
      `/api/Series/series-detail?seriesId=${encodeURIComponent(sourceManga.mangaId)}`,
      { server, token },
    );

    const flat: KavitaChapter[] =
      detail?.storylineChapters && detail.storylineChapters.length > 0
        ? detail.storylineChapters
        : [
            ...(detail?.volumes ?? []).flatMap((volume) => volume.chapters ?? []),
            ...(detail?.chapters ?? []),
          ];

    const chapters: Chapter[] = [];
    const seen = new Set<number>();

    for (const row of [...flat, ...(detail?.specials ?? [])]) {
      if (!row?.id || seen.has(row.id)) {
        continue;
      }

      seen.add(row.id);
      chapterPages.set(String(row.id), row.pages ?? 0);

      // Kavita marks "this file has no chapter number of its own" with a very
      // large negative number rather than an absent one.
      const raw = row.minNumber ?? Number(row.number ?? 0);
      const number = Number.isFinite(raw) && raw > -1000 ? raw : 0;
      const name = (row.titleName ?? "").trim() || (row.title ?? "").trim();
      const published = row.releaseDate ? new Date(row.releaseDate) : undefined;

      chapters.push({
        chapterId: String(row.id),
        sourceManga,
        langCode: "en",
        chapNum: number,
        sortingIndex: row.sortOrder ?? number,
        ...(name && name !== `Chapter ${number}` ? { title: name } : {}),
        ...(published && !isNaN(published.getTime()) && published.getFullYear() > 1
          ? { publishDate: published }
          : {}),
      });
    }

    return chapters.sort((a, b) => b.chapNum - a.chapNum);
  }

  /**
   * A chapter's pages, as addresses the app fetches for itself.
   *
   * Kavita numbers pages from zero and says how many a chapter has, and each
   * address carries the API key, so there is nothing left for this source to do
   * once the list is handed over.
   */
  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const { server, imageKey, token } = await this.signedIn();
    const mangaId = chapter.sourceManga.mangaId;

    // Both of these are normally already known from opening the series. A
    // chapter reached without that - resumed from the library, say - fills them
    // from the same endpoints the series page uses, rather than from
    // chapter-info, which this source no longer calls at all.
    if (!chapterPages.has(chapter.chapterId)) {
      await this.getChapters({ mangaId } as SourceManga);
    }

    if (!seriesFormat.has(mangaId)) {
      const series = await this.request<KavitaSeries>(
        `/api/Series/${encodeURIComponent(mangaId)}`,
        { server, token },
      );

      seriesFormat.set(mangaId, series?.format ?? FORMAT_ARCHIVE);
    }

    const format = seriesFormat.get(mangaId) ?? FORMAT_ARCHIVE;

    if (format === FORMAT_EPUB || format === FORMAT_PDF) {
      throw new Error(
        `This is ${format === FORMAT_EPUB ? "an EPUB" : "a PDF"}, which this source does not open yet. Read it in Kavita itself for now.`,
      );
    }

    const total = chapterPages.get(chapter.chapterId) ?? 0;

    if (total <= 0) {
      throw new Error("Kavita reports no pages for this chapter.");
    }

    const pages: string[] = [];
    for (let page = 0; page < total; page++) {
      pages.push(pageUrl(server, imageKey, Number(chapter.chapterId), page));
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  async getSearchResults(
    query: SearchQuery<KavitaMetadata>,
    metadata: KavitaMetadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const { server, imageKey, token } = await this.signedIn();
    const term = (query.title ?? "").trim();

    if (!term) {
      return { items: [] };
    }

    const found = await this.request<{ series?: KavitaSeries[] }>(
      `/api/Search/search?queryString=${encodeURIComponent(term)}&includeChapterAndFiles=false`,
      { server, token },
    );

    // The search endpoint answers in one go rather than in pages.
    return {
      items: (found?.series ?? []).map((series) => this.toResult(series, server, imageKey)),
      metadata: { completed: true },
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    const { server, token } = await this.signedIn();
    const [streams, nav] = await Promise.all([
      this.request<KavitaDashboardStream[]>("/api/Stream/dashboard?visibleOnly=true", {
        server,
        token,
      }),
      this.request<KavitaSideNavStream[]>("/api/Stream/sidenav?visibleOnly=true", {
        server,
        token,
      }),
    ]);

    const dashboard = (streams ?? [])
      .filter((stream) => stream.visible !== false)
      .filter((stream) => STREAM_PATHS[stream.streamType ?? 0] !== undefined)
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
      .map((stream) => ({
        id: `${STREAM_PREFIX}${stream.id ?? 0}_${stream.streamType ?? 0}`,
        title: streamTitle(stream),
        type: DiscoverSectionType.simpleCarousel,
      }));

    // The side nav is the rest of the reader's arrangement - their libraries,
    // everything they own, what they mean to read next.
    const shelves = (nav ?? [])
      .filter((stream) => stream.visible !== false)
      .filter((stream) => navSource(stream.streamType ?? 0, stream.libraryId) !== undefined)
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
      .map((stream) => ({
        id: `${NAV_PREFIX}${stream.id ?? 0}_${stream.streamType ?? 0}_${stream.libraryId ?? 0}`,
        title: navTitle(stream),
        type: DiscoverSectionType.simpleCarousel,
      }));

    return [...dashboard, ...shelves];
  }

  /** Where a row's series come from, whichever part of Kavita it mirrors. */
  private sourceFor(sectionId: string): { path: string; body: unknown } | undefined {
    const dashboard = /^stream_\d+_(\d+)$/.exec(sectionId);

    if (dashboard) {
      const path = STREAM_PATHS[Number(dashboard[1])];

      return path === undefined ? undefined : { path, body: {} };
    }

    const shelf = /^nav_\d+_(\d+)_(\d+)$/.exec(sectionId);

    return shelf ? navSource(Number(shelf[1]), Number(shelf[2])) : undefined;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: KavitaMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (metadata?.completed) {
      return { items: [] };
    }

    const source = this.sourceFor(section.id);

    if (!source) {
      throw new Error(`Invalid sectionId provided: ${section.id}`);
    }

    const { server, imageKey, token } = await this.signedIn();
    const page = metadata?.page ?? 1;
    const joiner = source.path.includes("?") ? "&" : "?";
    const rows =
      (await this.request<KavitaSeries[]>(
        `${source.path}${joiner}PageNumber=${page}&PageSize=${PAGE_SIZE}`,
        { server, token },
        source.body,
      )) ?? [];

    const items = rows.map((series) => {
      const result = this.toResult(series, server, imageKey);

      return {
        type: "simpleCarouselItem" as const,
        mangaId: result.mangaId,
        imageUrl: result.imageUrl,
        title: result.title,
        ...(result.subtitle ? { subtitle: result.subtitle } : {}),
      };
    }) as DiscoverSectionItem[];

    return {
      items,
      metadata: rows.length < PAGE_SIZE ? { completed: true } : { page: page + 1 },
    };
  }
}

export const Kavita = new KavitaExtension();
