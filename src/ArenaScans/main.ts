/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { MadaraGeneric } from "../generic/main";
import { ArenaScansParser } from "./parsers";
import pbconfig from "./pbconfig";

const DOMAIN = "https://arenascans.org";

class ArenaScansExtension extends MadaraGeneric {
  constructor() {
    super({
      domain: DOMAIN,
      name: pbconfig.name,
      contentRating: pbconfig.contentRating,
      language: pbconfig.language,
      // Nothing here needs a post id, so skip the lookup request it costs.
      usePostIds: false,
      // The per-series ajax route serves the full list; admin-ajax needs a post id.
      chapterEndpoint: 1,
      directoryPath: "manga",
      // The child theme replaces the listing and series markup wholesale.
      parser: new ArenaScansParser(),
    });
  }
}

export const ArenaScans = new ArenaScansExtension();
