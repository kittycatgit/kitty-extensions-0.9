/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  closureSelector,
  LabelRow,
  Section,
  SelectRow,
  type FormItemElement,
  type FormSectionElement,
} from "@paperback/types";

import type { Genre } from "./catalogue";
import { STATUSES, type ExiledMetadata, type SeriesStatus } from "./models";

export class ExiledRebelsSearchForm extends AdvancedSearchForm {
  private genres?: Genre[] | Error;
  private state: ExiledMetadata;

  constructor(metadata: ExiledMetadata | undefined, genres: Promise<Genre[]>) {
    super();
    this.state = { ...metadata };
    delete this.state.page;
    delete this.state.completed;

    genres
      .then((loaded) => (this.genres = loaded))
      .catch((error: unknown) => {
        this.genres = error instanceof Error ? error : new Error(String(error));
      })
      .finally(() => this.reloadForm());
  }

  private statusRow(): FormItemElement<unknown> {
    return SelectRow("status", {
      title: "Status",
      layout: "flow",
      value: this.state.status ? [this.state.status] : [],
      items: STATUSES,
      minItemCount: 0,
      maxItemCount: 1,
      onValueChange: closureSelector(this, "status", async (value: string[]) => {
        if (value[0]) {
          this.state.status = value[0] as SeriesStatus;
        } else {
          delete this.state.status;
        }
        this.reloadForm();
      }),
    });
  }

  override getSections(): FormSectionElement<unknown>[] {
    const filters = Section({ id: "filters", header: "Filters" }, [this.statusRow()]);

    if (!this.genres) {
      return [filters, Section("loading", [LabelRow("loading", { title: "Loading genres" })])];
    }

    if (this.genres instanceof Error) {
      return [
        filters,
        Section("error", [
          LabelRow("error", { title: "Could not load genres", subtitle: this.genres.message }),
        ]),
      ];
    }

    return [
      filters,
      Section(
        {
          id: "genres",
          header: "Genres",
          footer: "Results carry every selected genre. Genres are the translators' own labels.",
        },
        [
          SelectRow("genres", {
            title: "Genres",
            layout: "flow",
            value: this.state.genres ?? [],
            items: this.genres.map((genre) => ({ id: genre.id, title: genre.title })),
            minItemCount: 0,
            maxItemCount: this.genres.length,
            onValueChange: closureSelector(this, "genres", async (value: string[]) => {
              if (value.length > 0) {
                this.state.genres = value;
              } else {
                delete this.state.genres;
              }
              this.reloadForm();
            }),
          }),
        ],
      ),
    ];
  }

  override getSearchQueryMetadata(): ExiledMetadata {
    const out: ExiledMetadata = {};
    if (this.state.status) out.status = this.state.status;
    if (this.state.genres && this.state.genres.length > 0) out.genres = this.state.genres;
    return out;
  }
}
