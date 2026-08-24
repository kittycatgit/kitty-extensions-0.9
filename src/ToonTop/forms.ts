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

import type { ToonTopRef, ToonTopSearchMetadata } from "./models";

/**
 * The site browses a genre by path (`/genres/<slug>`), so only one can apply at
 * a time. Genres are loaded from the site rather than hard coded.
 */
export class ToonTopSearchForm extends AdvancedSearchForm {
  private genres?: ToonTopRef[] | Error;
  private selectedGenre: string[];

  constructor(metadata: ToonTopSearchMetadata | undefined, genres: Promise<ToonTopRef[]>) {
    super();
    this.selectedGenre = metadata?.genre ? [metadata.genre] : [];

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

    const genres = this.genres;
    return [
      Section({ id: "genre", footer: "Searching by title ignores the genre filter." }, [
        SelectRow("genre", {
          title: "Genre",
          layout: "flow",
          value: this.selectedGenre,
          items: genres.map((genre) => ({ id: genre.slug, title: genre.name })),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "genre", async (value: string[]) => {
            this.selectedGenre = value;
            this.reloadForm();
          }),
        }),
      ]),
    ];
  }

  override getSearchQueryMetadata(): ToonTopSearchMetadata {
    return this.selectedGenre[0] ? { genre: this.selectedGenre[0] } : {};
  }
}
