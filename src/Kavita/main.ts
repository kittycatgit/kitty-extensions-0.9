/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  DiscoverSectionType,
  type ChapterReadActionQueueProcessingResult,
  type Form,
  type MangaProgress,
  type TrackedMangaChapterReadAction,
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
  keepSession,
  MODE_API_KEY,
  FORMAT_EPUB,
  FORMAT_PDF,
  PAGE_SIZE,
  pageUrl,
  requireSettings,
  navSource,
  navTitle,
  STREAM_PATHS,
  storedSession,
  storedShelves,
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
import { KavitaProgressForm } from "./progress";
import { KavitaSettings } from "./settings";

interface Session {
  fingerprint: string;
  server: string;
  username: string;
  token: string;
  refresh: string;
  imageKey: string;
}

let session: Session | undefined;

// Changes whenever the credentials do, so edited settings force a fresh sign-in
// rather than leaving a stale token in place.
function fingerprint(credentials: KavitaCredentials): string {
  return credentials.mode === MODE_API_KEY
    ? [credentials.server, credentials.mode, credentials.apiKey].join("\n")
    : [credentials.server, credentials.mode, credentials.username, credentials.password].join("\n");
}

// All of this comes out of series-detail. Do not reach for chapter-info to get
// it: that endpoint answers 500 on some chapters.
interface ChapterFacts {
  pages: number;
  seriesId: number;
  volumeId: number;
}

const chapterFacts = new Map<string, ChapterFacts>();
const seriesFacts = new Map<string, { format: number; libraryId: number }>();

const STREAM_PREFIX = "stream_";
const NAV_PREFIX = "nav_";

class KavitaExtension implements ExtensionImpl<typeof pbconfig> {
  async initialise(): Promise<void> {
    // No interceptor needed: every URL handed to the app already carries the
    // API key it needs.
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

    // Kavita throws on an API key it does not know, so a bad key arrives as a
    // 500 whose body still says 401.
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

    const session: Session = {
      fingerprint: fingerprint(credentials),
      server: credentials.server,
      username: (body.username ?? "").trim() || "your account",
      token: body.token,
      refresh: (body.refreshToken ?? "").trim(),
      // The reader's own API key stands in when the login reply names none.
      imageKey: imageKeyFrom(body, byKey ? credentials.apiKey : ""),
    };

    keepSession(session.refresh ? session : undefined);

    return session;
  }

  // Preferred over signing in again: the app logs every request body, and those
  // logs get shared when readers ask for help - so keep the password out of them.
  private async resume(credentials: KavitaCredentials): Promise<Session | undefined> {
    const kept = storedSession();

    if (!kept || kept.fingerprint !== fingerprint(credentials)) {
      return undefined;
    }

    const [response, buffer] = await Application.scheduleRequest({
      url: `${credentials.server}/api/Account/refresh-token`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: kept.token, refreshToken: kept.refresh }),
    });

    if (response.status !== 200) {
      // Refresh token aged out or was revoked; the caller signs in again.
      keepSession(undefined);
      return undefined;
    }

    try {
      const body = JSON.parse(Application.arrayBufferToUTF8String(buffer)) as KavitaLogin;

      if (!body?.token) {
        keepSession(undefined);
        return undefined;
      }

      const session: Session = {
        ...kept,
        token: body.token,
        refresh: (body.refreshToken ?? "").trim() || kept.refresh,
      };

      keepSession(session);

      return session;
    } catch {
      keepSession(undefined);
      return undefined;
    }
  }

  private async signedIn(): Promise<Session> {
    const credentials = requireSettings();
    const wanted = fingerprint(credentials);

    if (session && session.fingerprint === wanted) {
      return session;
    }

    session = (await this.resume(credentials)) ?? (await this.authenticate(credentials));

    return session;
  }

  // The token goes on here rather than in an interceptor - an interceptor that
  // had to sign in would be waiting on the request queue it is holding.
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

  private toResult(series: KavitaSeries, server: string, imageKey: string): SearchResultItem {
    // Recently-updated rows carry both ids and their own `id` is 0, so take the
    // first usable number - `id ?? seriesId` sends all of them to series 0.
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

    seriesFacts.set(mangaId, {
      format: series?.format ?? FORMAT_ARCHIVE,
      libraryId: series?.libraryId ?? 0,
    });

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

  // Returns the server's rows, not Chapters: progress needs the pagesRead a
  // Chapter has no room for.
  private async rawChapters(mangaId: string): Promise<KavitaChapter[]> {
    const { server, token } = await this.signedIn();
    const detail = await this.request<KavitaSeriesDetail>(
      `/api/Series/series-detail?seriesId=${encodeURIComponent(mangaId)}`,
      { server, token },
    );

    // storylineChapters is the server's own reading order, which already places
    // specials, one-shots and volumes with no chapter number.
    const flat: KavitaChapter[] =
      detail?.storylineChapters && detail.storylineChapters.length > 0
        ? detail.storylineChapters
        : [
            ...(detail?.volumes ?? []).flatMap((volume) => volume.chapters ?? []),
            ...(detail?.chapters ?? []),
          ];

    const rows: KavitaChapter[] = [];
    const seen = new Set<number>();

    for (const row of [...flat, ...(detail?.specials ?? [])]) {
      if (!row?.id || seen.has(row.id)) {
        continue;
      }

      seen.add(row.id);
      chapterFacts.set(String(row.id), {
        pages: row.pages ?? 0,
        seriesId: Number(mangaId),
        volumeId: row.volumeId ?? 0,
      });
      rows.push(row);
    }

    return rows;
  }

  private toChapter(row: KavitaChapter, sourceManga: SourceManga): Chapter {
    // Kavita marks "no chapter number of its own" with a large negative number
    // rather than leaving the field out.
    const raw = row.minNumber ?? Number(row.number ?? 0);
    const number = Number.isFinite(raw) && raw > -1000 ? raw : 0;
    const name = (row.titleName ?? "").trim() || (row.title ?? "").trim();
    const published = row.releaseDate ? new Date(row.releaseDate) : undefined;

    return {
      chapterId: String(row.id),
      sourceManga,
      langCode: "en",
      chapNum: number,
      sortingIndex: row.sortOrder ?? number,
      ...(name && name !== `Chapter ${number}` ? { title: name } : {}),
      ...(published && !isNaN(published.getTime()) && published.getFullYear() > 1
        ? { publishDate: published }
        : {}),
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const rows = await this.rawChapters(sourceManga.mangaId);

    return rows
      .map((row) => this.toChapter(row, sourceManga))
      .sort((a, b) => b.chapNum - a.chapNum);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const { server, imageKey, token } = await this.signedIn();

    const mangaId = chapter.sourceManga.mangaId;

    // Both are usually cached from opening the series, but a chapter resumed
    // from the library skips that.
    if (!chapterFacts.has(chapter.chapterId)) {
      await this.rawChapters(mangaId);
    }

    if (!seriesFacts.has(mangaId)) {
      const series = await this.request<KavitaSeries>(
        `/api/Series/${encodeURIComponent(mangaId)}`,
        { server, token },
      );

      seriesFacts.set(mangaId, {
        format: series?.format ?? FORMAT_ARCHIVE,
        libraryId: series?.libraryId ?? 0,
      });
    }

    const format = seriesFacts.get(mangaId)?.format ?? FORMAT_ARCHIVE;

    if (format === FORMAT_EPUB || format === FORMAT_PDF) {
      throw new Error(
        `This is ${format === FORMAT_EPUB ? "an EPUB" : "a PDF"}, which this source does not open yet. Read it in Kavita itself for now.`,
      );
    }

    const total = chapterFacts.get(chapter.chapterId)?.pages ?? 0;

    if (total <= 0) {
      throw new Error("Kavita reports no pages for this chapter.");
    }

    const pages: string[] = [];
    for (let page = 0; page < total; page++) {
      pages.push(pageUrl(server, imageKey, Number(chapter.chapterId), page));
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  async getMangaProgress(sourceManga: SourceManga): Promise<MangaProgress | undefined> {
    try {
      const rows = await this.rawChapters(sourceManga.mangaId);
      const read = rows.filter((row) => (row.pagesRead ?? 0) > 0);

      if (read.length === 0) {
        return undefined;
      }

      const furthest = read.reduce((best, row) =>
        (row.sortOrder ?? row.minNumber ?? 0) > (best.sortOrder ?? best.minNumber ?? 0)
          ? row
          : best,
      );

      return { sourceManga, lastReadChapter: this.toChapter(furthest, sourceManga) };
    } catch {
      // Progress is a side question; a server that cannot answer it should not
      // break the rest of the source.
      return undefined;
    }
  }

  // Kavita builds On Deck from what it has been told is read, so chapters
  // finished in the app have to be sent back or that shelf never moves.
  async processChapterReadActionQueue(
    actions: TrackedMangaChapterReadAction[],
  ): Promise<ChapterReadActionQueueProcessingResult> {
    const successfulItems: string[] = [];
    const failedItems: string[] = [];
    const bySeries = new Map<string, KavitaChapter[]>();

    for (const action of actions) {
      // The tracked title's own id; `chapterMangaId` would belong to whichever
      // source the chapter was actually read from.
      const seriesId = action.sourceManga.mangaId;

      try {
        if (!bySeries.has(seriesId)) {
          bySeries.set(seriesId, await this.rawChapters(seriesId));
        }

        const rows = bySeries.get(seriesId) ?? [];

        // The action's chapter id is only ours if the chapter was read here;
        // for a title added as a second source, fall back to chapter number.
        const match =
          rows.find((row) => String(row.id) === action.chapterId) ??
          rows.find((row) => {
            const number = row.minNumber ?? Number(row.number ?? Number.NaN);

            return Number.isFinite(number) && Math.abs(number - action.chapterNum) < 0.001;
          });

        if (!match?.id) {
          failedItems.push(action.id);
          continue;
        }

        const { server, token } = await this.signedIn();

        await this.request(
          "/api/Reader/mark-chapter-read",
          { server, token },
          { seriesId: Number(seriesId), chapterId: match.id },
        );

        successfulItems.push(action.id);
      } catch {
        failedItems.push(action.id);
      }
    }

    return { successfulItems, failedItems };
  }

  async getMangaProgressManagementForm(sourceManga: SourceManga): Promise<Form> {
    const seriesId = Number(sourceManga.mangaId);
    const title = (sourceManga.mangaInfo?.primaryTitle ?? "").trim() || `Series ${seriesId}`;
    const tell = async (path: string): Promise<void> => {
      const { server, token } = await this.signedIn();

      await this.request(path, { server, token }, { seriesId });
    };

    return new KavitaProgressForm(title, {
      markRead: () => tell("/api/Reader/mark-read"),
      markUnread: () => tell("/api/Reader/mark-unread"),
    });
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

    // The search endpoint answers in one go; it has no paging.
    return {
      items: (found?.series ?? []).map((series) => this.toResult(series, server, imageKey)),
      metadata: { completed: true },
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    const { server, token } = await this.signedIn();
    const showShelves = storedShelves();
    const [streams, nav] = await Promise.all([
      this.request<KavitaDashboardStream[]>("/api/Stream/dashboard?visibleOnly=true", {
        server,
        token,
      }),
      showShelves
        ? this.request<KavitaSideNavStream[]>("/api/Stream/sidenav?visibleOnly=true", {
            server,
            token,
          })
        : Promise.resolve([]),
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

    // Each side-nav shelf costs a page of series the moment Home opens, so they
    // are off unless asked for.
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
