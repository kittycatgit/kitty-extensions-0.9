/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  closureSelector,
  type FormSectionElement,
} from "@paperback/types";

import { encodeId } from "../shared/ids";
import { STATUSES, TYPES, type RenaFilters } from "./models";

export class RenaSearchForm extends AdvancedSearchForm {
  private readonly genreOptions: string[];

  private genre: string[];

  private type: string[];

  private status: string[];

  constructor(filters: RenaFilters | undefined, genres: string[]) {
    super();
    this.genreOptions = genres;
    this.genre = filters?.genre ? [filters.genre] : [];
    this.type = filters?.type ? [filters.type] : [];
    this.status = filters?.status ? [filters.status] : [];
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section({ id: "genres", footer: "One genre at a time, as the API allows." }, [
        SelectRow("genre", {
          title: "Genres",
          layout: "list",
          value: this.genre,
          items: this.genreOptions.map((genre) => ({ id: encodeId(genre), title: genre })),
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
        SelectRow("type", {
          title: "Type",
          layout: "list",
          value: this.type,
          items: TYPES.map((type) => ({ id: type, title: type })),
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
          items: STATUSES.map((status) => ({ id: status, title: status })),
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

  override getSearchQueryMetadata(): RenaFilters {
    return {
      ...(this.genre[0] ? { genre: this.genre[0] } : {}),
      ...(this.type[0] ? { type: this.type[0] } : {}),
      ...(this.status[0] ? { status: this.status[0] } : {}),
    };
  }
}
