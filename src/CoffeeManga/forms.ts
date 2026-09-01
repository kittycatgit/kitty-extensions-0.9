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

import type { CoffeeSearchMetadata } from "./models";

export class CoffeeSearchForm extends AdvancedSearchForm {
  private readonly options: Tag[];

  private genre: string[];

  constructor(metadata: CoffeeSearchMetadata | undefined, options: Tag[]) {
    super();
    this.options = options;
    this.genre = metadata?.genre ? [metadata.genre] : [];
  }

  override getSections(): FormSectionElement<unknown>[] {
    if (this.options.length === 0) {
      return [
        Section({ id: "genre" }, [
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
          id: "genre",
          header: "Genre",
          // The site browses genres one taxonomy page at a time; it has no
          // endpoint that intersects two of them.
          footer: "One genre at a time. Combine it with a title to search inside that genre.",
        },
        [
          SelectRow("genre", {
            title: "Genre",
            layout: "flow",
            value: this.genre,
            items: this.options.map((genre) => ({ id: genre.id, title: genre.title })),
            minItemCount: 0,
            maxItemCount: 1,
            onValueChange: closureSelector(this, "genre", async (value: string[]) => {
              this.genre = value;
              this.reloadForm();
            }),
          }),
        ],
      ),
    ];
  }

  override getSearchQueryMetadata(): CoffeeSearchMetadata {
    // An explicit undefined cannot cross the bridge, so omit empty keys.
    return this.genre[0] ? { genre: this.genre[0] } : {};
  }
}
