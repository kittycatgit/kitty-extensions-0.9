/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  closureSelector,
  type FormSectionElement,
} from "@paperback/types";

import type { MeowingFilters } from "./models";

export class MeowingSearchForm extends AdvancedSearchForm {
  private readonly allGenres: string[];

  private readonly allTypes: string[];

  private readonly allStatuses: string[];

  private genres: string[];

  private status: string[];

  private type: string[];

  constructor(
    filters: MeowingFilters | undefined,
    options: { genres: string[]; types: string[]; statuses: string[] },
  ) {
    super();
    this.allGenres = options.genres;
    this.allTypes = options.types;
    this.allStatuses = options.statuses;
    this.genres = filters?.genres ?? [];
    this.status = filters?.status ? [filters.status] : [];
    this.type = filters?.type ? [filters.type] : [];
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section({ id: "genres", footer: "Every chosen genre has to be present." }, [
        SelectRow("genres", {
          title: "Genres",
          layout: "list",
          value: this.genres,
          items: this.allGenres.map((genre) => ({ id: genre, title: genre })),
          minItemCount: 0,
          maxItemCount: Math.max(this.allGenres.length, 1),
          onValueChange: closureSelector(this, "genres", async (value: string[]) => {
            this.genres = value;
            this.reloadForm();
          }),
        }),
      ]),
      Section({ id: "filters" }, [
        SelectRow("status", {
          title: "Status",
          layout: "list",
          value: this.status,
          items: this.allStatuses.map((status) => ({ id: status, title: titleCase(status) })),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "status", async (value: string[]) => {
            this.status = value;
            this.reloadForm();
          }),
        }),
        SelectRow("type", {
          title: "Type",
          layout: "list",
          value: this.type,
          items: this.allTypes.map((type) => ({ id: type, title: titleCase(type) })),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "type", async (value: string[]) => {
            this.type = value;
            this.reloadForm();
          }),
        }),
      ]),
    ];
  }

  override getSearchQueryMetadata(): MeowingFilters {
    return {
      ...(this.genres.length ? { genres: this.genres } : {}),
      ...(this.status[0] ? { status: this.status[0] } : {}),
      ...(this.type[0] ? { type: this.type[0] } : {}),
    };
  }
}

function titleCase(value: string): string {
  return value.length ? value[0]!.toUpperCase() + value.slice(1) : value;
}
