/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  closureSelector,
  LabelRow,
  Section,
  SelectRow,
  ToggleRow,
  TriStateSelectRow,
  type FormItemElement,
  type FormSectionElement,
} from "@paperback/types";

import { RATINGS, STATUSES, type SearchMetadata, type Term, type TriState } from "./models";

type Option = { id: string; title: string };

export class DivineDaoLibrarySearchForm extends AdvancedSearchForm {
  private genres?: Term[] | Error;
  private state: SearchMetadata;

  constructor(metadata: SearchMetadata | undefined, genres: Promise<Term[]>) {
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

  private single(
    id: string,
    title: string,
    options: Option[],
    key: "status" | "rating",
  ): FormItemElement<unknown> {
    return SelectRow(id, {
      title,
      layout: "flow",
      value: this.state[key] ? [this.state[key]] : [],
      items: options,
      minItemCount: 0,
      maxItemCount: 1,
      onValueChange: closureSelector(this, id, async (value: string[]) => {
        if (value[0]) {
          this.state[key] = value[0];
        } else {
          delete this.state[key];
        }
        this.reloadForm();
      }),
    });
  }

  override getSections(): FormSectionElement<unknown>[] {
    const filters = Section({ id: "filters", header: "Filters" }, [
      this.single("status", "Status", STATUSES, "status"),
      this.single("rating", "Age rating", RATINGS, "rating"),
      ToggleRow("sentence", {
        title: "Match exact phrase",
        value: this.state.sentence ?? false,
        onValueChange: closureSelector(this, "sentence", async (value: boolean) => {
          this.state.sentence = value;
        }),
      }),
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
          footer: "Included genres match any of them; excluded genres are removed.",
        },
        [
          TriStateSelectRow("genres", {
            title: "Genres (any of)",
            layout: "flow",
            value: this.state.genres ?? {},
            items: this.genres.map((genre) => ({ id: genre.id, title: genre.name })),
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

  override getSearchQueryMetadata(): SearchMetadata {
    const out: SearchMetadata = {};
    if (this.state.status) out.status = this.state.status;
    if (this.state.rating) out.rating = this.state.rating;
    if (this.state.sentence) out.sentence = true;
    if (this.state.genres && Object.keys(this.state.genres).length) out.genres = this.state.genres;
    return out;
  }
}
