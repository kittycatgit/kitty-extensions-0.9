/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  closureSelector,
  type FormSectionElement,
} from "@paperback/types";

import type { Genre, VComicsFilters } from "./models";

const TYPES = ["MANHWA", "MANHUA", "MANGA", "NOVEL", "COMIC"];
const STATUSES = ["ONGOING", "COMPLETED", "HIATUS", "DROPPED"];

export class VComicsSearchForm extends AdvancedSearchForm {
  private readonly genreOptions: Genre[];

  private genreIds: string[];

  private seriesType: string[];

  private seriesStatus: string[];

  constructor(filters: VComicsFilters | undefined, genres: Genre[]) {
    super();
    this.genreOptions = genres;
    this.genreIds = filters?.genreIds ?? [];
    this.seriesType = filters?.seriesType ? [filters.seriesType] : [];
    this.seriesStatus = filters?.seriesStatus ? [filters.seriesStatus] : [];
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section({ id: "genres", footer: "A title matching any chosen genre is listed." }, [
        SelectRow("genreIds", {
          title: "Genres",
          layout: "list",
          value: this.genreIds,
          items: this.genreOptions.map((genre) => ({
            id: genre.id.toString(),
            title: genre.name.trim(),
          })),
          minItemCount: 0,
          maxItemCount: Math.max(this.genreOptions.length, 1),
          onValueChange: closureSelector(this, "genreIds", async (value: string[]) => {
            this.genreIds = value;
            this.reloadForm();
          }),
        }),
      ]),
      Section({ id: "filters" }, [
        SelectRow("seriesType", {
          title: "Type",
          layout: "list",
          value: this.seriesType,
          items: TYPES.map((type) => ({ id: type, title: titleCase(type) })),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "seriesType", async (value: string[]) => {
            this.seriesType = value;
            this.reloadForm();
          }),
        }),
        SelectRow("seriesStatus", {
          title: "Status",
          layout: "list",
          value: this.seriesStatus,
          items: STATUSES.map((status) => ({ id: status, title: titleCase(status) })),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "seriesStatus", async (value: string[]) => {
            this.seriesStatus = value;
            this.reloadForm();
          }),
        }),
      ]),
    ];
  }

  override getSearchQueryMetadata(): VComicsFilters {
    return {
      ...(this.genreIds.length ? { genreIds: this.genreIds } : {}),
      ...(this.seriesType[0] ? { seriesType: this.seriesType[0] } : {}),
      ...(this.seriesStatus[0] ? { seriesStatus: this.seriesStatus[0] } : {}),
    };
  }
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
