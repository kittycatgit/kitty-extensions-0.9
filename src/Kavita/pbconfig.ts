/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { ExtensionInfo } from "@paperback/types";
import { ContentRating, SourceIntents } from "@paperback/types";

export default {
  name: "Kavita",
  description:
    "Reads a Kavita server you host yourself. Set its address and your API key in this source's settings.",
  version: "6.0.0",
  icon: "icon.png",
  language: "en",
  contentRating: ContentRating.EVERYONE,
  capabilities: [
    SourceIntents.CHAPTER_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SETTINGS_FORM_PROVIDING,
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
