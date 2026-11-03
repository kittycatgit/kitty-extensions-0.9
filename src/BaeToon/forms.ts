/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  closureSelector,
  LabelRow,
  Section,
  SelectRow,
  type FormSectionElement,
} from "@paperback/types";

import { genreId, type BaeGenre, type BaeSearchMetadata } from "./models";

export class BaeToonSearchForm extends AdvancedSearchForm {
  private genres?: BaeGenre[] | Error;
  private state: BaeSearchMetadata;

  constructor(metadata: BaeSearchMetadata | undefined, genres: Promise<BaeGenre[]>) {
    super();
    this.state = { ...metadata };
    delete this.state.page;
    delete this.state.completed;

    genres
      .then((loaded) => (this.genres = loaded))
      .catch((error: unknown) => {
        this.genres = error instanceof Error ? error : new Error(String(error));
      })
      .finally(() => this.reloadForm());
  }

  override getSections(): FormSectionElement<unknown>[] {
    if (!this.genres) {
      return [Section("loading", [LabelRow("loading", { title: "Loading genres" })])];
    }

    if (this.genres instanceof Error) {
      return [
        Section("error", [
          LabelRow("error", { title: "Could not load genres", subtitle: this.genres.message }),
        ]),
      ];
    }

    return [
      Section(
        { id: "genres", header: "Genre", footer: "The site filters by one genre at a time." },
        [
          SelectRow("genre", {
            title: "Genre",
            layout: "flow",
            value: this.state.genre ? [this.state.genre] : [],
            items: this.genres.map((genre) => ({ id: genreId(genre.name), title: genre.name })),
            minItemCount: 0,
            maxItemCount: 1,
            onValueChange: closureSelector(this, "genre", async (value: string[]) => {
              if (value[0]) {
                this.state.genre = value[0];
              } else {
                delete this.state.genre;
              }
              this.reloadForm();
            }),
          }),
        ],
      ),
    ];
  }

  override getSearchQueryMetadata(): BaeSearchMetadata {
    return this.state.genre ? { genre: this.state.genre } : {};
  }
}
