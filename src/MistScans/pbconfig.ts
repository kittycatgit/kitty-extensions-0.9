/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { ContentRating, type ExtensionInfo } from "@paperback/types";

import { basePbConfig } from "../siren/config";

const pbConfig = {
  ...basePbConfig,
  name: "MistScans",
  description: "Extension that pulls content from mistscans.org.",
  version: "3.0.0",
  contentRating: ContentRating.ADULT as ContentRating,
} satisfies ExtensionInfo;

export default pbConfig;
