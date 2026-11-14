/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  closureSelector,
  Section,
  SelectRow,
  type FormSectionElement,
} from "@paperback/types";

import type { MikanFilters, MikanSearchMetadata } from "./models";

export class MangaMikanSearchForm extends AdvancedSearchForm {
  private readonly filters: MikanFilters;

  private genre: string[];

  private status: string[];

  constructor(metadata: MikanSearchMetadata | undefined, filters: MikanFilters) {
    super();
    this.filters = filters;
    this.genre = metadata?.genre ? [metadata.genre] : [];
    this.status = metadata?.status ? [metadata.status] : [];
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section({ id: "status", header: "Status" }, [
        SelectRow("status", {
          title: "Status",
          layout: "flow",
          value: this.status,
          items: this.filters.statuses,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "status", async (value: string[]) => {
            this.status = value;
          }),
        }),
      ]),
      Section(
        { id: "genre", header: "Genre", footer: "The site filters by one genre at a time." },
        [
          SelectRow("genre", {
            title: "Genre",
            layout: "flow",
            value: this.genre,
            items: this.filters.genres,
            minItemCount: 0,
            maxItemCount: 1,
            onValueChange: closureSelector(this, "genre", async (value: string[]) => {
              this.genre = value;
            }),
          }),
        ],
      ),
    ];
  }

  override getSearchQueryMetadata(): MikanSearchMetadata {
    // An explicit undefined cannot cross the bridge, so omit empty keys.
    return {
      ...(this.genre[0] ? { genre: this.genre[0] } : {}),
      ...(this.status[0] ? { status: this.status[0] } : {}),
    };
  }
}
