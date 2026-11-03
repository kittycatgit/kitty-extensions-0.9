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

import { STATUSES, TYPES, type WebtoonClubRef, type WebtoonClubSearchMetadata } from "./models";

type Option = { id: string; title: string };

export class WebtoonClubSearchForm extends AdvancedSearchForm {
  private genres?: WebtoonClubRef[] | Error;
  private state: WebtoonClubSearchMetadata;

  constructor(metadata: WebtoonClubSearchMetadata | undefined, genres: Promise<WebtoonClubRef[]>) {
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
    key: "status" | "type" | "genre",
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
    const filters = Section(
      {
        id: "filters",
        header: "Filters",
        footer:
          "Type and status also narrow a title search. Genre browsing takes one genre and no title.",
      },
      [
        this.single("type", "Type", TYPES, "type"),
        this.single("status", "Status", STATUSES, "status"),
      ],
    );

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
      Section({ id: "genres", header: "Genre" }, [
        this.single(
          "genre",
          "Genre",
          this.genres.map((genre) => ({ id: genre.slug, title: genre.name })),
          "genre",
        ),
      ]),
    ];
  }

  override getSearchQueryMetadata(): WebtoonClubSearchMetadata {
    const out: WebtoonClubSearchMetadata = {};
    if (this.state.status) out.status = this.state.status;
    if (this.state.type) out.type = this.state.type;
    if (this.state.genre) out.genre = this.state.genre;
    return out;
  }
}
