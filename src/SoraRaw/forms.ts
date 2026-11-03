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

import {
  CONTENTS,
  MODES,
  STATUSES,
  type SoraGenre,
  type SoraSearchMetadata,
  type TriState,
} from "./models";

type Option = { id: string; title: string };

export class SoraRawSearchForm extends AdvancedSearchForm {
  private genres?: SoraGenre[] | Error;
  private state: SoraSearchMetadata;

  constructor(metadata: SoraSearchMetadata | undefined, genres: Promise<SoraGenre[]>) {
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
    key: "status" | "content" | "mode",
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
          (this.state as Record<string, unknown>)[key] = value[0];
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
      this.single("content", "Content", CONTENTS, "content"),
      this.single("mode", "Reading direction", MODES, "mode"),
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
          footer:
            "Results must carry every included genre and none of the excluded ones. Genres with very few titles are left out.",
        },
        [
          TriStateSelectRow("genres", {
            title: "Genres",
            layout: "flow",
            value: this.state.genres ?? {},
            items: this.genres.map((genre) => ({ id: genre.slug, title: genre.name })),
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

  override getSearchQueryMetadata(): SoraSearchMetadata {
    const out: SoraSearchMetadata = {};
    if (this.state.status) out.status = this.state.status;
    if (this.state.content) out.content = this.state.content;
    if (this.state.mode) out.mode = this.state.mode;
    if (this.state.genres && Object.keys(this.state.genres).length) out.genres = this.state.genres;
    return out;
  }
}
