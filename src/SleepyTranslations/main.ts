/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { Chapter, ChapterDetails, SourceManga } from "@paperback/types";

import { MadaraGeneric } from "../generic/main";
import { asNovel, madaraNovelChapter } from "../shared/madaraNovel";
import pbconfig from "./pbconfig";

const DOMAIN = "https://sleepytranslations.com";

class SleepyTranslationsExtension extends MadaraGeneric {
  constructor() {
    super({
      domain: DOMAIN,
      name: pbconfig.name,
      contentRating: pbconfig.contentRating,
      language: pbconfig.language,
      // Nothing here needs a post id, so skip the lookup request it costs.
      usePostIds: false,
      // The per-series ajax route serves the full list; admin-ajax needs a post id.
      chapterEndpoint: 1,
      directoryPath: "series",
    });
  }

  // This site runs Madara for novels, so chapters are prose, not page images.
  override async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    return madaraNovelChapter(DOMAIN, "series", chapter);
  }

  override async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return asNovel(await super.getMangaDetails(mangaId));
  }
}

export const SleepyTranslations = new SleepyTranslationsExtension();
