/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { ContentRating, type ExtensionInfo } from "@paperback/types";

import { basePbConfig } from "../lwcomics/config";

const pbConfig = {
  ...basePbConfig,
  name: "RitharScans",
  description: "Extension that pulls content from ritharscans.com.",
  contentRating: ContentRating.MATURE as ContentRating,
} satisfies ExtensionInfo;

export default pbConfig;
