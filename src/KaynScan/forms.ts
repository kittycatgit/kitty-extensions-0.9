/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  closureSelector,
  type FormSectionElement,
} from "@paperback/types";

import { STATUSES, TYPES, type KaynGenre, type KaynSearchMetadata } from "./models";

// Only filters the API actually honours; it ignores the rest without saying so.
export class KaynSearchForm extends AdvancedSearchForm {
  private readonly genres: KaynGenre[];

  private genre: string[] = [];

  private type: string[] = [];

  private status: string[] = [];

  constructor(genres: KaynGenre[]) {
    super();
    this.genres = genres;
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section({ id: "genre", header: "Genre" }, [
        SelectRow("genre", {
          title: "Genre",
          value: this.genre,
          minItemCount: 0,
          maxItemCount: 1,
          layout: "flow",
          items: this.genres
            .filter((entry) => (entry.slug ?? "").length > 0)
            .map((entry) => ({
              id: entry.slug as string,
              title: (entry.name ?? entry.slug) as string,
            })),
          onValueChange: closureSelector(this, "genreChanged", async (value: string[]) => {
            this.genre = value;
          }),
        }),
      ]),
      Section({ id: "type", header: "Type" }, [
        SelectRow("type", {
          title: "Type",
          value: this.type,
          minItemCount: 0,
          maxItemCount: 1,
          layout: "flow",
          items: TYPES.map((entry) => ({ id: entry, title: entry })),
          onValueChange: closureSelector(this, "typeChanged", async (value: string[]) => {
            this.type = value;
          }),
        }),
      ]),
      Section({ id: "status", header: "Status" }, [
        SelectRow("status", {
          title: "Status",
          value: this.status,
          minItemCount: 0,
          maxItemCount: 1,
          layout: "flow",
          items: STATUSES.map((entry) => ({ id: entry, title: entry })),
          onValueChange: closureSelector(this, "statusChanged", async (value: string[]) => {
            this.status = value;
          }),
        }),
      ]),
    ];
  }

  override getSearchQueryMetadata(): KaynSearchMetadata {
    return {
      ...(this.genre[0] ? { genre: this.genre[0] } : {}),
      ...(this.type[0] ? { type: this.type[0] } : {}),
      ...(this.status[0] ? { status: this.status[0] } : {}),
    };
  }
}
