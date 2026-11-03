/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  closureSelector,
  Section,
  TriStateSelectRow,
  type FormSectionElement,
} from "@paperback/types";

import { GENRES, genreId, type TriState, type XNovelMetadata } from "./models";

export class XNovelSearchForm extends AdvancedSearchForm {
  private state: XNovelMetadata;

  constructor(metadata: XNovelMetadata | undefined) {
    super();
    this.state = { ...metadata };
    delete this.state.page;
    delete this.state.completed;
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section(
        {
          id: "genres",
          header: "Genres",
          footer:
            "Results carry every included genre and none of the excluded ones. The site has no status or language filter; use the Ongoing and Completed rows for those.",
        },
        [
          TriStateSelectRow("genres", {
            title: "Genres",
            layout: "flow",
            value: this.state.genres ?? {},
            items: GENRES.map((genre) => ({ id: genreId(genre.slug), title: genre.title })),
            allowExclusion: true,
            allowEmptySelection: true,
            onValueChange: closureSelector(this, "genres", async (value: TriState) => {
              this.state.genres = value;
              this.reloadForm();
            }),
          }),
        ],
      ),
    ];
  }

  override getSearchQueryMetadata(): XNovelMetadata {
    const out: XNovelMetadata = {};
    if (this.state.genres && Object.keys(this.state.genres).length) out.genres = this.state.genres;
    return out;
  }
}
