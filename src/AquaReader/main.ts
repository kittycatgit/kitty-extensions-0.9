/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { MadaraGeneric } from "../generic/main";
import { AquaReaderParser } from "./parsers";
import pbconfig from "./pbconfig";

const DOMAIN = "https://aquareader.org";

class AquaReaderExtension extends MadaraGeneric {
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
      // The aqua child theme renames every class the base selects on.
      parser: new AquaReaderParser(),
    });
  }
}

export const AquaReader = new AquaReaderExtension();
