/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { MadaraGeneric } from "../generic/main";
import { Manga3asqParser } from "./parsers";
import pbconfig from "./pbconfig";

// 3asq.org redirects here; iOS will not follow a redirect onto plain http, so
// the live host is used directly.
const DOMAIN = "https://3asq.online";

class Manga3asqExtension extends MadaraGeneric {
  constructor() {
    super({
      domain: DOMAIN,
      name: pbconfig.name,
      contentRating: pbconfig.contentRating,
      language: pbconfig.language,
      usePostIds: false,
      // admin-ajax answers 400 here; the per-series ajax route serves the list.
      chapterEndpoint: 1,
      // Saves the lookup request the base otherwise makes to learn this.
      directoryPath: "manga",
      parser: new Manga3asqParser(),
    });
  }
}

export const manga3asq = new Manga3asqExtension();
