/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  closureSelector,
  type FormSectionElement,
} from "@paperback/types";

import { KINDS, STATUSES, type ApiGenre, type NuviaFilters } from "./models";

export class NuviaSearchForm extends AdvancedSearchForm {
  private readonly genreOptions: ApiGenre[];

  private genre: string[];

  private kind: string[];

  private status: string[];

  constructor(filters: NuviaFilters | undefined, genres: ApiGenre[]) {
    super();
    this.genreOptions = genres;
    this.genre = filters?.genre ? [filters.genre] : [];
    this.kind = filters?.kind ? [filters.kind] : [];
    this.status = filters?.status ? [filters.status] : [];
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section({ id: "genres", footer: "One genre at a time, as the API allows." }, [
        SelectRow("genre", {
          title: "Genres",
          layout: "list",
          value: this.genre,
          items: this.genreOptions.map((genre) => ({ id: genre.slug, title: genre.name })),
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
        SelectRow("kind", {
          title: "Library",
          layout: "list",
          value: this.kind,
          items: KINDS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "kind", async (value: string[]) => {
            this.kind = value;
            this.reloadForm();
          }),
        }),
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

  override getSearchQueryMetadata(): NuviaFilters {
    return {
      ...(this.genre[0] ? { genre: this.genre[0] } : {}),
      ...(this.kind[0] === "novel" || this.kind[0] === "comic" ? { kind: this.kind[0] } : {}),
      ...(this.status[0] ? { status: this.status[0] } : {}),
    };
  }
}
