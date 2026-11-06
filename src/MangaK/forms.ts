/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  closureSelector,
  InputRow,
  LabelRow,
  Section,
  SelectRow,
  ToggleRow,
  TriStateSelectRow,
  type FormItemElement,
  type FormSectionElement,
} from "@paperback/types";

import {
  DEMOGRAPHICS,
  FORMATS,
  RATINGS,
  STATUSES,
  TYPES,
  type MangaKMetadata,
  type Option,
  type TriState,
} from "./models";

export class MangaKSearchForm extends AdvancedSearchForm {
  private readonly genres: Option[] | undefined;

  private state: MangaKMetadata;

  constructor(metadata: MangaKMetadata | undefined, genres: Option[] | undefined) {
    super();
    this.genres = genres;
    this.state = { ...metadata };
  }

  private single(
    id: string,
    title: string,
    options: Option[],
    key: "status" | "type" | "rating",
  ): FormItemElement<unknown> {
    const current = this.state[key];
    return SelectRow(id, {
      title,
      layout: "flow",
      value: current ? [current] : [],
      items: options,
      minItemCount: 0,
      maxItemCount: 1,
      onValueChange: closureSelector(this, id, async (value: string[]) => {
        this.state[key] = value[0];
        this.reloadForm();
      }),
    });
  }

  private multi(
    id: string,
    title: string,
    options: Option[],
    key: "demographics" | "formats",
  ): FormItemElement<unknown> {
    return SelectRow(id, {
      title,
      layout: "flow",
      value: this.state[key] ?? [],
      items: options,
      minItemCount: 0,
      maxItemCount: options.length,
      onValueChange: closureSelector(this, id, async (value: string[]) => {
        this.state[key] = value;
        this.reloadForm();
      }),
    });
  }

  private input(
    id: string,
    title: string,
    key: "minChapters" | "maxChapters" | "tag" | "author",
  ): FormItemElement<unknown> {
    return InputRow(id, {
      title,
      value: this.state[key] ?? "",
      onValueChange: closureSelector(this, id, async (value: string) => {
        this.state[key] = value.trim();
      }),
    });
  }

  private toggle(
    id: string,
    title: string,
    subtitle: string,
    key: "raw" | "uncensored" | "mtl",
  ): FormItemElement<unknown> {
    return ToggleRow(id, {
      title,
      subtitle,
      value: this.state[key] ?? false,
      onValueChange: closureSelector(this, id, async (value: boolean) => {
        this.state[key] = value;
      }),
    });
  }

  override getSections(): FormSectionElement<unknown>[] {
    const genres = this.genres;

    return [
      Section(
        {
          id: "genres",
          header: "Genres",
          footer: genres
            ? "Tap once to include, twice to exclude."
            : "The genre list could not be loaded. Every other filter still works.",
        },
        [
          genres
            ? TriStateSelectRow("genres", {
                title: "Genres",
                layout: "flow",
                value: this.state.genres ?? {},
                items: genres,
                allowExclusion: true,
                allowEmptySelection: true,
                onValueChange: closureSelector(this, "genres", async (value: TriState) => {
                  this.state.genres = value;
                  this.reloadForm();
                }),
              })
            : LabelRow("unavailable", { title: "Genres could not be loaded" }),
        ],
      ),
      Section({ id: "catalog", header: "Catalog" }, [
        this.single("status", "Status", STATUSES, "status"),
        this.single("type", "Type", TYPES, "type"),
        this.multi("demographics", "Demographic", DEMOGRAPHICS, "demographics"),
        this.single("rating", "Content rating", RATINGS, "rating"),
        this.multi("formats", "Format", FORMATS, "formats"),
      ]),
      Section(
        {
          id: "details",
          header: "Details",
          footer: "Tag and author take the site's slug, e.g. handsome-male-lead.",
        },
        [
          this.input("minChapters", "Minimum chapters", "minChapters"),
          this.input("maxChapters", "Maximum chapters", "maxChapters"),
          this.input("tag", "Tag", "tag"),
          this.input("author", "Author", "author"),
        ],
      ),
      Section({ id: "flags", header: "Only show" }, [
        this.toggle("raw", "Raw", "Untranslated uploads only.", "raw"),
        this.toggle("uncensored", "Uncensored", "Uncensored uploads only.", "uncensored"),
        this.toggle("mtl", "Machine translated", "Machine-translated uploads only.", "mtl"),
      ]),
    ];
  }

  override getSearchQueryMetadata(): MangaKMetadata {
    // An explicit undefined cannot cross the bridge, so omit empty keys.
    const metadata: MangaKMetadata = {};

    if (this.state.genres && Object.keys(this.state.genres).length > 0) {
      metadata.genres = this.state.genres;
    }

    for (const key of ["demographics", "formats"] as const) {
      const value = this.state[key];
      if (value && value.length > 0) {
        metadata[key] = value;
      }
    }

    for (const key of [
      "status",
      "type",
      "rating",
      "minChapters",
      "maxChapters",
      "tag",
      "author",
    ] as const) {
      const value = this.state[key];
      if (value) {
        metadata[key] = value;
      }
    }

    for (const key of ["raw", "uncensored", "mtl"] as const) {
      if (this.state[key]) {
        metadata[key] = true;
      }
    }

    return metadata;
  }
}
