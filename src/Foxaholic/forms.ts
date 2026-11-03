/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  closureSelector,
  InputRow,
  LabelRow,
  Section,
  SelectRow,
  type FormItemElement,
  type FormSectionElement,
} from "@paperback/types";

import {
  ADULT_OPTIONS,
  GENRE_MATCH,
  STATUSES,
  type FoxaholicMetadata,
  type Option,
} from "./models";

type TextKey = "author" | "artist" | "release";

export class FoxaholicSearchForm extends AdvancedSearchForm {
  private genres?: Option[] | Error;
  private state: FoxaholicMetadata;

  constructor(metadata: FoxaholicMetadata | undefined, genres: Promise<Option[]>) {
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

  private single(id: "adult" | "op", title: string, options: Option[]): FormItemElement<unknown> {
    const current = this.state[id];
    return SelectRow(id, {
      title,
      layout: "flow",
      value: current ? [current] : [],
      items: options,
      minItemCount: 0,
      maxItemCount: 1,
      onValueChange: closureSelector(this, id, async (value: string[]) => {
        if (value[0]) {
          this.state[id] = value[0];
        } else {
          delete this.state[id];
        }
        this.reloadForm();
      }),
    });
  }

  private text(id: TextKey, title: string): FormItemElement<unknown> {
    return InputRow(id, {
      title,
      value: this.state[id] ?? "",
      onValueChange: closureSelector(this, id, async (value: string) => {
        const trimmed = value.trim();
        if (trimmed) {
          this.state[id] = trimmed;
        } else {
          delete this.state[id];
        }
      }),
    });
  }

  override getSections(): FormSectionElement<unknown>[] {
    const filters = Section({ id: "filters", header: "Filters" }, [
      SelectRow("statuses", {
        title: "Status",
        layout: "flow",
        value: this.state.statuses ?? [],
        items: STATUSES,
        minItemCount: 0,
        maxItemCount: STATUSES.length,
        onValueChange: closureSelector(this, "statuses", async (value: string[]) => {
          this.state.statuses = value;
          this.reloadForm();
        }),
      }),
      this.single("adult", "Adult content", ADULT_OPTIONS),
    ]);

    const people = Section(
      {
        id: "people",
        header: "People",
        footer: "Matched against the site's author and team names.",
      },
      [this.text("author", "Author"), this.text("artist", "Team"), this.text("release", "Year")],
    );

    if (!this.genres) {
      return [
        filters,
        people,
        Section("loading", [LabelRow("loading", { title: "Loading genres" })]),
      ];
    }

    if (this.genres instanceof Error) {
      return [
        filters,
        people,
        Section("error", [
          LabelRow("error", { title: "Could not load genres", subtitle: this.genres.message }),
        ]),
      ];
    }

    return [
      filters,
      people,
      Section({ id: "genres", header: "Genres" }, [
        SelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.state.genres ?? [],
          items: this.genres,
          minItemCount: 0,
          maxItemCount: this.genres.length,
          onValueChange: closureSelector(this, "genres", async (value: string[]) => {
            this.state.genres = value;
            this.reloadForm();
          }),
        }),
        this.single("op", "Genre match", GENRE_MATCH),
      ]),
    ];
  }

  override getSearchQueryMetadata(): FoxaholicMetadata {
    const out: FoxaholicMetadata = {};
    if (this.state.genres?.length) out.genres = this.state.genres;
    if (this.state.op) out.op = this.state.op;
    if (this.state.statuses?.length) out.statuses = this.state.statuses;
    if (this.state.adult) out.adult = this.state.adult;
    if (this.state.author) out.author = this.state.author;
    if (this.state.artist) out.artist = this.state.artist;
    if (this.state.release) out.release = this.state.release;
    return out;
  }
}
