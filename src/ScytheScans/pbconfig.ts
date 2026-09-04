/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { ContentRating } from "@paperback/types";

import { basePbConfig } from "../mangastream/config";

let pbConfig = basePbConfig;

pbConfig.name = "ScytheScans";
pbConfig.description = "Extension that pulls content from scythescans.com.";
pbConfig.version = "11.0.0";
pbConfig.contentRating = ContentRating.MATURE;
pbConfig.developers = [
  {
    name: "kittycatgit",
    website: "https://github.com/kittycatgit",
    github: "https://github.com/kittycatgit",
  },
];

export default pbConfig;
