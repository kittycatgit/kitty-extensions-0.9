/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { ExtensionInfo } from "@paperback/types";
import { ContentRating, SourceIntents } from "@paperback/types";

export default {
  name: "Comick",
  description: "Comick tracker: library lists, reading progress and ratings for comick.dev.",
  version: "4.0.0",
  icon: "icon.png",
  language: "en",
  contentRating: ContentRating.ADULT,
  capabilities: [
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.PROGRESS_PROVIDING,
    SourceIntents.SETTINGS_FORM_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.MANAGED_COLLECTION_PROVIDING,
    SourceIntents.CLOUDFLARE_BYPASS_PROVIDING,
  ],
  badges: [],
  developers: [
    {
      name: "kittycatgit",
      website: "https://github.com/kittycatgit",
      github: "https://github.com/kittycatgit",
    },
  ],
} satisfies ExtensionInfo;
