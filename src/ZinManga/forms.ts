/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  closureSelector,
  LabelRow,
  Section,
  SelectRow,
  type FormSectionElement,
  type Tag,
} from "@paperback/types";

import type { ZinSearchMetadata } from "./models";

// Options are read from the site's search page at runtime, not listed here.
export class ZinSearchForm extends AdvancedSearchForm {
  private readonly options: Tag[];

  private genres: string[];

  constructor(metadata: ZinSearchMetadata | undefined, options: Tag[]) {
    super();
    this.options = options;
    this.genres = metadata?.genres ?? [];
  }

  override getSections(): FormSectionElement<unknown>[] {
    if (this.options.length === 0) {
      return [
        Section({ id: "genres" }, [
          LabelRow("unavailable", {
            title: "Genres could not be loaded",
            subtitle: "Search by title still works.",
          }),
        ]),
      ];
    }

    return [
      Section(
        {
          id: "genres",
          header: "Genres",
          footer:
            "A title matching any chosen genre is returned, so adding genres widens the search.",
        },
        [
          SelectRow("genres", {
            title: "Genres",
            layout: "flow",
            value: this.genres,
            items: this.options.map((genre) => ({ id: genre.id, title: genre.title })),
            minItemCount: 0,
            maxItemCount: this.options.length,
            onValueChange: closureSelector(this, "genres", async (value: string[]) => {
              this.genres = value;
              this.reloadForm();
            }),
          }),
        ],
      ),
    ];
  }

  override getSearchQueryMetadata(): ZinSearchMetadata {
    // An explicit undefined cannot cross the bridge, so omit empty keys.
    return this.genres.length > 0 ? { genres: this.genres } : {};
  }
}
