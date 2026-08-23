/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { ContentRating, SourceIntents, type ExtensionInfo } from "@paperback/types";

export default {
  name: "Manga18Club",
  description: "Extension that pulls content from manga18.club.",
  version: "1.0.3",
  icon: "icon.png",
  language: "en",
  contentRating: ContentRating.ADULT,
  badges: [],
  developers: [
    {
      name: "kittycatgit",
      github: "https://github.com/kittycatgit",
    },
  ],
  capabilities: [
    SourceIntents.CHAPTER_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.CLOUDFLARE_BYPASS_PROVIDING,
  ],
} satisfies ExtensionInfo;
