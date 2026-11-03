/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  closureSelector,
  LabelRow,
  Section,
  SelectRow,
  TriStateSelectRow,
  type FormItemElement,
  type FormSectionElement,
} from "@paperback/types";

import { STATUSES, TYPES, type SanaGenre, type SanaMetadata, type TriState } from "./models";

export class SanaScansSearchForm extends AdvancedSearchForm {
  private genres?: SanaGenre[] | Error;
  private state: SanaMetadata;

  constructor(metadata: SanaMetadata | undefined, genres: Promise<SanaGenre[]>) {
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

  private multi(
    key: "types" | "statuses",
    title: string,
    options: { id: string; title: string }[],
  ): FormItemElement<unknown> {
    return SelectRow(key, {
      title,
      layout: "flow",
      value: this.state[key] ?? [],
      items: options,
      minItemCount: 0,
      maxItemCount: options.length,
      onValueChange: closureSelector(this, key, async (value: string[]) => {
        if (value.length > 0) {
          this.state[key] = value;
        } else {
          delete this.state[key];
        }
        this.reloadForm();
      }),
    });
  }

  override getSections(): FormSectionElement<unknown>[] {
    const filters = Section({ id: "filters", header: "Filters" }, [
      this.multi("types", "Type", TYPES),
      this.multi("statuses", "Status", STATUSES),
    ]);

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
          footer: "Results carry any of the included genres and none of the excluded ones.",
        },
        [
          TriStateSelectRow("genres", {
            title: "Genres",
            layout: "flow",
            value: this.state.genres ?? {},
            items: this.genres.map((genre) => ({ id: String(genre.id), title: genre.name })),
            allowExclusion: true,
            allowEmptySelection: true,
            onValueChange: closureSelector(this, "genres", async (value: TriState) => {
              this.state.genres = value;
              this.reloadForm();
            }),
          }),
        ],
      ),
    ];
  }

  override getSearchQueryMetadata(): SanaMetadata {
    const out: SanaMetadata = {};
    if (this.state.types?.length) out.types = this.state.types;
    if (this.state.statuses?.length) out.statuses = this.state.statuses;
    if (this.state.genres && Object.keys(this.state.genres).length) out.genres = this.state.genres;
    return out;
  }
}
