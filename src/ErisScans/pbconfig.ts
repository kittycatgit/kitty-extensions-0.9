/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { ContentRating, type ExtensionInfo } from "@paperback/types";

import { basePbConfig } from "../meowing/config";

const pbConfig = {
  ...basePbConfig,
  name: "ErisScans",
  description: "Extension that pulls content from erisscans.com.",
  contentRating: ContentRating.ADULT as ContentRating,
} satisfies ExtensionInfo;

export default pbConfig;
