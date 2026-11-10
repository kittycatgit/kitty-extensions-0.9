/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  closureSelector,
  type FormSectionElement,
} from "@paperback/types";

import { SORTS, STATUSES, TYPES, type LwFilters } from "./models";

export class LwSearchForm extends AdvancedSearchForm {
  private readonly genreOptions: { id: string; title: string }[];

  private genre: string[];

  private type: string[];

  private status: string[];

  private sort: string[];

  constructor(filters: LwFilters | undefined, genres: { id: string; title: string }[]) {
    super();
    this.genreOptions = genres;
    this.genre = filters?.genre ? [filters.genre] : [];
    this.type = filters?.type ? [filters.type] : [];
    this.status = filters?.status ? [filters.status] : [];
    this.sort = filters?.sort ? [filters.sort] : [];
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section({ id: "genres", footer: "The listing takes one genre at a time." }, [
        SelectRow("genre", {
          title: "Genres",
          layout: "list",
          value: this.genre,
          items: this.genreOptions,
          minItemCount: 0,
          // The component holds a single genre, not a set.
          maxItemCount: 1,
          onValueChange: closureSelector(this, "genre", async (value: string[]) => {
            this.genre = value;
            this.reloadForm();
          }),
        }),
      ]),
      Section({ id: "filters" }, [
        SelectRow("type", {
          title: "Type",
          layout: "list",
          value: this.type,
          items: TYPES,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "type", async (value: string[]) => {
            this.type = value;
            this.reloadForm();
          }),
        }),
        SelectRow("sort", {
          title: "Order by",
          layout: "list",
          value: this.sort,
          items: SORTS.map((sort) => ({ id: sort.id, title: sort.title })),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "sort", async (value: string[]) => {
            this.sort = value;
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

  override getSearchQueryMetadata(): LwFilters {
    return {
      ...(this.genre[0] ? { genre: this.genre[0] } : {}),
      ...(this.type[0] ? { type: this.type[0] } : {}),
      ...(this.status[0] ? { status: this.status[0] } : {}),
      ...(this.sort[0] ? { sort: this.sort[0] } : {}),
    };
  }
}
