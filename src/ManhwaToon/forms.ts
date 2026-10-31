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

import { ADULT, type ManhwaToonMetadata, type Option } from "./models";
import type { Filters } from "./parsers";

export class ManhwaToonSearchForm extends AdvancedSearchForm {
  private readonly filters: Filters | undefined;

  private state: ManhwaToonMetadata;

  constructor(metadata: ManhwaToonMetadata | undefined, filters: Filters | undefined) {
    super();
    this.filters = filters;
    this.state = { ...metadata };
  }

  private select(
    id: string,
    title: string,
    options: Option[],
    key: "types" | "statuses" | "genres",
    max = options.length,
  ): FormItemElement<unknown> {
    return SelectRow(id, {
      title,
      layout: "flow",
      value: this.state[key] ?? [],
      items: options,
      minItemCount: 0,
      maxItemCount: max,
      onValueChange: closureSelector(this, id, async (value: string[]) => {
        this.state[key] = value;
        this.reloadForm();
      }),
    });
  }

  private input(
    id: string,
    title: string,
    key: "author" | "artist" | "release",
  ): FormItemElement<unknown> {
    return InputRow(id, {
      title,
      value: this.state[key] ?? "",
      onValueChange: closureSelector(this, id, async (value: string) => {
        this.state[key] = value.trim();
      }),
    });
  }

  override getSections(): FormSectionElement<unknown>[] {
    const filters = this.filters;

    return [
      Section(
        { id: "catalog", header: "Catalog" },
        filters
          ? [
              this.select("types", "Type", filters.types, "types", 1),
              this.select("statuses", "Status", filters.statuses, "statuses"),
            ]
          : [LabelRow("unavailable", { title: "Filters could not be loaded" })],
      ),
      Section({ id: "adult", header: "Content" }, [
        SelectRow("adult", {
          title: "Adult content",
          layout: "flow",
          value: [this.state.adult ?? ADULT[0]!.id],
          items: ADULT,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "adult", async (value: string[]) => {
            this.state.adult = value[0];
            this.reloadForm();
          }),
        }),
      ]),
      Section(
        {
          id: "genres",
          header: "Genres",
          footer: filters
            ? "A series must carry every selected genre."
            : "The genre list could not be loaded.",
        },
        filters
          ? [this.select("genres", "Genres", filters.genres, "genres")]
          : [LabelRow("genres-unavailable", { title: "Genres could not be loaded" })],
      ),
      Section({ id: "details", header: "Details" }, [
        this.input("author", "Author", "author"),
        this.input("artist", "Artist", "artist"),
        this.input("release", "Release year", "release"),
      ]),
    ];
  }

  override getSearchQueryMetadata(): ManhwaToonMetadata {
    // An explicit undefined cannot cross the bridge, so omit empty keys.
    const metadata: ManhwaToonMetadata = {};

    for (const key of ["types", "statuses", "genres"] as const) {
      const value = this.state[key];

      if (value && value.length > 0) {
        metadata[key] = value;
      }
    }

    for (const key of ["author", "artist", "release"] as const) {
      const value = this.state[key];

      if (value) {
        metadata[key] = value;
      }
    }

    if (this.state.adult && this.state.adult !== ADULT[0]!.id) {
      metadata.adult = this.state.adult;
    }

    return metadata;
  }
}
