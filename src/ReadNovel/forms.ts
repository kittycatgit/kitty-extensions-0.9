/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  closureSelector,
  type FormSectionElement,
} from "@paperback/types";

import { STATUSES, type ReadNovelFilters } from "./models";

export class ReadNovelSearchForm extends AdvancedSearchForm {
  private readonly genreOptions: string[];

  private genre: string[];

  private status: string[];

  constructor(filters: ReadNovelFilters | undefined, genres: string[]) {
    super();
    this.genreOptions = genres;
    this.genre = filters?.genre ? [filters.genre] : [];
    this.status = filters?.status ? [filters.status] : [];
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section({ id: "genres", footer: "One genre at a time, as the API allows." }, [
        SelectRow("genre", {
          title: "Genres",
          layout: "list",
          value: this.genre,
          items: this.genreOptions.map((genre) => ({ id: genre, title: genre })),
          minItemCount: 0,
          // The API filters on one genre at a time.
          maxItemCount: 1,
          onValueChange: closureSelector(this, "genre", async (value: string[]) => {
            this.genre = value;
            this.reloadForm();
          }),
        }),
      ]),
      Section({ id: "filters" }, [
        SelectRow("status", {
          title: "Status",
          layout: "list",
          value: this.status,
          items: STATUSES,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "status", async (value: string[]) => {
            this.status = value;
            this.reloadForm();
          }),
        }),
      ]),
    ];
  }

  override getSearchQueryMetadata(): ReadNovelFilters {
    return {
      ...(this.genre[0] ? { genre: this.genre[0] } : {}),
      ...(this.status[0] ? { status: this.status[0] } : {}),
    };
  }
}
