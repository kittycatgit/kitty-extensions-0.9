/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { ContentRating, type ExtensionInfo } from "@paperback/types";

import { basePbConfig } from "../generic/config";

const pbConfig = {
  ...basePbConfig,
  name: "Tritinia",
  description: "Extension that pulls content from tritinia.org.",
  version: "2.0.0",
  contentRating: ContentRating.ADULT as ContentRating,
  developers: [
    {
      name: "kittycatgit",
      website: "https://github.com/kittycatgit",
      github: "https://github.com/kittycatgit",
    },
  ],
} satisfies ExtensionInfo;

export default pbConfig;
