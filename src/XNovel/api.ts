/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  CHAPTER_PAGE_SIZE,
  GRAPHQL_URL,
  LISTING_PAGE_SIZE,
  SEARCH_PAGE_SIZE,
  type ChapterList,
  type ChapterNode,
  type ChapterRow,
  type ListingWhere,
  type NovelList,
  type NovelRecord,
} from "./models";

// Field lists mirror what the site's own bundles request; unknown fields fail
// validation, so only remove from these, never add.
const NOVEL_FIELDS = `
  N_id N_title N_Path info_slug info_descText info_meta_AlternativeNames info_meta_Author
  info_meta_Genre info_meta_Tag info_meta_Source info_meta_Status rate votes follows reviews
  urlCoverOri date_create date_update
  chaptersNodes_last(amount: 1) { id data { ch_id ch_index ch_title ChPath date_create date_update } }
`;

const LISTING_QUERY = `query get_latest_novels($select: LatestReleases_Novels_Select) {
  get_latest_novels(select: $select) {
    paging { total pages page }
    items { id data { ${NOVEL_FIELDS} } }
  }
}`;

const SEARCH_QUERY = `query get_searchNovel($select: SearchNovel_Select) {
  get_searchNovel(select: $select) {
    paging { total pages page }
    items { id data { ${NOVEL_FIELDS} } }
  }
}`;

const NOVEL_QUERY = `query get_NovelsNode($id: String!) {
  get_NovelsNode(id: $id) { id data { ${NOVEL_FIELDS} } }
}`;

const ALL_CHAPTERS_QUERY = `query get_AllnovelChapterList($N_id: String!) {
  get_AllnovelChapterList(N_id: $N_id) {
    id data { N_id ch_id ch_index ch_title ChPath date_create date_update }
  }
}`;

const CHAPTER_PAGE_QUERY = `query get_NovelsChaptersList($select: NovelsChaptersList_Select) {
  get_NovelsChaptersList(select: $select) {
    paging { total pages page }
    items { id data { N_id ch_id ch_index ch_title ChPath date_create date_update } }
  }
}`;

const CHAPTER_QUERY = `query get_ChaptersNode($id: String!) {
  get_ChaptersNode(id: $id) {
    id
    data {
      ch_id ch_index ch_title
      sourcesNode_list { id data { ch_id content } }
    }
  }
}`;

type GraphQLResponse<T> = {
  data?: Record<string, T>;
  errors?: { message?: string }[];
};

export class XNovelApi {
  private async query<T>(operation: string, query: string, variables: object): Promise<T> {
    const [, buffer] = await Application.scheduleRequest({
      url: GRAPHQL_URL,
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query, variables }),
    });

    const payload = JSON.parse(Application.arrayBufferToUTF8String(buffer)) as GraphQLResponse<T>;

    if (payload.errors?.length) {
      throw new Error(`xnovel ${operation}: ${payload.errors[0]?.message ?? "unknown error"}`);
    }

    const result = payload.data?.[operation];

    if (result === undefined) {
      throw new Error(`xnovel ${operation}: empty response`);
    }

    return result;
  }

  async listing(where: ListingWhere, page: number, genre = ""): Promise<NovelList> {
    return await this.query<NovelList>("get_latest_novels", LISTING_QUERY, {
      select: { where, genre, page, init: LISTING_PAGE_SIZE, size: LISTING_PAGE_SIZE },
    });
  }

  async search(
    word: string,
    page: number,
    sortby: string,
    incGenres: string[],
    excGenres: string[],
  ): Promise<NovelList> {
    return await this.query<NovelList>("get_searchNovel", SEARCH_QUERY, {
      select: { word, page, size: SEARCH_PAGE_SIZE, sortby, incGenres, excGenres },
    });
  }

  async novel(id: string): Promise<NovelRecord> {
    const node = await this.query<{ data?: NovelRecord | null }>("get_NovelsNode", NOVEL_QUERY, {
      id,
    });

    if (!node?.data) {
      throw new Error(`No novel found for ${id}`);
    }

    return node.data;
  }

  async allChapters(novelId: string): Promise<ChapterRow[]> {
    const rows = await this.query<{ data?: ChapterRow | null }[] | null>(
      "get_AllnovelChapterList",
      ALL_CHAPTERS_QUERY,
      { N_id: novelId },
    );

    return (rows ?? []).flatMap((row) => (row?.data ? [row.data] : []));
  }

  // The whole-list query lags a day behind; the newest page is read separately
  // so fresh chapters show up.
  async newestChapters(novelId: string): Promise<ChapterRow[]> {
    const list = await this.query<ChapterList>("get_NovelsChaptersList", CHAPTER_PAGE_QUERY, {
      select: {
        N_id: novelId,
        init: CHAPTER_PAGE_SIZE,
        size: CHAPTER_PAGE_SIZE,
        page: 1,
        sortBy: "desc",
      },
    });

    return (list.items ?? []).flatMap((row) => (row?.data ? [row.data] : []));
  }

  async chapter(chapterId: string): Promise<ChapterNode> {
    const node = await this.query<{ data?: ChapterNode | null }>(
      "get_ChaptersNode",
      CHAPTER_QUERY,
      {
        id: chapterId,
      },
    );

    if (!node?.data) {
      throw new Error(`No chapter found for ${chapterId}`);
    }

    return node.data;
  }
}
