/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  closureSelector,
  type FormSectionElement,
} from "@paperback/types";

import { STATUSES, TYPES, type KeroFilters } from "./models";

export class KeroSearchForm extends AdvancedSearchForm {
  private readonly genreOptions: { name: string; slug: string }[];

  private genreSlugs: string[];

  private type: string[];

  private status: string[];

  constructor(filters: KeroFilters | undefined, genres: { name: string; slug: string }[]) {
    super();
    this.genreOptions = genres;
    this.genreSlugs = filters?.genre ?? [];
    this.type = filters?.type ? [filters.type] : [];
    this.status = filters?.status ? [filters.status] : [];
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section({ id: "genres", footer: "Every chosen genre has to be present." }, [
        SelectRow("genre", {
          title: "Genres",
          layout: "list",
          value: this.genreSlugs,
          items: this.genreOptions.map((genre) => ({
            id: genre.slug,
            title: genre.name.trim(),
          })),
          minItemCount: 0,
          maxItemCount: Math.max(this.genreOptions.length, 1),
          onValueChange: closureSelector(this, "genre", async (value: string[]) => {
            this.genreSlugs = value;
            this.reloadForm();
          }),
        }),
      ]),
      Section({ id: "filters" }, [
        SelectRow("type", {
          title: "Type",
          layout: "list",
          value: this.type,
          items: TYPES.map((type) => ({ id: type, title: titleCase(type) })),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "type", async (value: string[]) => {
            this.type = value;
            this.reloadForm();
          }),
        }),
        SelectRow("status", {
          title: "Status",
          layout: "list",
          value: this.status,
          items: STATUSES.map((status) => ({ id: status, title: titleCase(status) })),
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

  override getSearchQueryMetadata(): KeroFilters {
    return {
      ...(this.genreSlugs.length ? { genre: this.genreSlugs } : {}),
      ...(this.type[0] ? { type: this.type[0] } : {}),
      ...(this.status[0] ? { status: this.status[0] } : {}),
    };
  }
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
