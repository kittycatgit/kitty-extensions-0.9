/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { ContentRating, type ExtensionInfo } from "@paperback/types";

import { basePbConfig } from "../generic/config";

// Copied rather than mutated: the base config object is shared with every other
// Madara source in the repo.
const pbConfig = {
  ...basePbConfig,
  name: "manga3asq",
  description: "Extension that pulls content from 3asq.online.",
  version: "1.0.0",
  language: "ar",
  contentRating: ContentRating.MATURE as ContentRating,
  developers: [
    {
      name: "kittycatgit",
      website: "https://github.com/kittycatgit",
      github: "https://github.com/kittycatgit",
    },
  ],
} satisfies ExtensionInfo;

export default pbConfig;
