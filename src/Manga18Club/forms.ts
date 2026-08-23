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

import { GENRES, type Manga18SearchMetadata } from "./models";

/**
 * The site browses genres by path (`/manga-list/<genre>`), so only one genre
 * can be applied at a time. The row is capped at a single selection rather
 * than offering include/exclude the site cannot honour.
 */
export class Manga18SearchForm extends AdvancedSearchForm {
  private selectedGenre: string[];

  constructor(metadata: Manga18SearchMetadata | undefined) {
    super();
    this.selectedGenre = metadata?.genre ? [metadata.genre] : [];
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section({ id: "genre", footer: "Only one genre can be applied at a time." }, [
        SelectRow("genre", {
          title: "Genre",
          layout: "flow",
          value: this.selectedGenre,
          items: GENRES.map((genre) => ({ id: genre.id, title: genre.title })),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "genre", async (value: string[]) => {
            this.selectedGenre = value;
            this.reloadForm();
          }),
        }),
        LabelRow("hint", {
          title: "Title search",
          subtitle: "Searching by title ignores the genre filter.",
        }),
      ]),
    ];
  }

  override getSearchQueryMetadata(): Manga18SearchMetadata {
    return this.selectedGenre[0] ? { genre: this.selectedGenre[0] } : {};
  }
}
