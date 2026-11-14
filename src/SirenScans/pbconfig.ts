/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { ContentRating, type ExtensionInfo } from "@paperback/types";

import { basePbConfig } from "../siren/config";

const pbConfig = {
  ...basePbConfig,
  name: "SirenScans",
  description: "Extension that pulls content from sirenscans.com.",
  version: "6.0.0",
  contentRating: ContentRating.MATURE as ContentRating,
} satisfies ExtensionInfo;

export default pbConfig;
