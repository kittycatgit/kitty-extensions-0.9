/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import type { DiscoverSection } from "@paperback/types";

import { MadaraGeneric } from "../generic/main";
import pbconfig from "./pbconfig";

const DOMAIN = "https://s2read.com";

class S2ReadExtension extends MadaraGeneric {
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
    });
  }

  // ?m_orderby=trending serves no series on this site, so the row is left out
  // rather than shown empty.
  override async getDiscoverSections(): Promise<DiscoverSection[]> {
    const sections = await super.getDiscoverSections();
    return sections.filter((section) => section.id !== "currently_trending");
  }
}

export const S2Read = new S2ReadExtension();
