/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ContentRating } from "@paperback/types";

import { basePbConfig } from "../generic/config";

let pbConfig = basePbConfig;

pbConfig.name = "ManhwaToon";
pbConfig.description = "Extension that pulls content from manhwatoon.me.";
pbConfig.version = "3.0.0";
pbConfig.contentRating = ContentRating.ADULT;
pbConfig.developers = [
  {
    name: "kittycatgit",
    website: "https://github.com/kittycatgit",
    github: "https://github.com/kittycatgit",
  },
];

export default pbConfig;
