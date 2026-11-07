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

import { NSFW_MODES, ORIGINS, STATUSES, type ElftoonMetadata, type Option } from "./models";

type SelectKey = "genre" | "exgenre" | "status" | "origin" | "nsfw";
type InputKey = "tag" | "minChapters";

export class ElftoonSearchForm extends AdvancedSearchForm {
  private readonly genres: Option[] | undefined;

  private state: ElftoonMetadata;

  constructor(metadata: ElftoonMetadata | undefined, genres: Option[] | undefined) {
    super();
    this.genres = genres;
    this.state = { ...metadata };
  }

  // The catalogue takes exactly one value per filter, so every picker is single-select.
  private single(id: SelectKey, title: string, options: Option[]): FormItemElement<unknown> {
    const current = this.state[id];
    return SelectRow(id, {
      title,
      layout: "flow",
      value: current ? [current] : [],
      items: options,
      minItemCount: 0,
      maxItemCount: 1,
      onValueChange: closureSelector(this, id, async (value: string[]) => {
        this.state[id] = value[0];
        this.reloadForm();
      }),
    });
  }

  private input(id: InputKey, title: string): FormItemElement<unknown> {
    return InputRow(id, {
      title,
      value: this.state[id] ?? "",
      onValueChange: closureSelector(this, id, async (value: string) => {
        this.state[id] = value.trim();
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
            ? "With a title typed, genre, status, tag and chapter filters apply to the 20 best matches."
            : "The genre list could not be loaded. Every other filter still works.",
        },
        genres
          ? [this.single("genre", "Genre", genres), this.single("exgenre", "Exclude genre", genres)]
          : [LabelRow("unavailable", { title: "Genres could not be loaded" })],
      ),
      Section({ id: "catalog", header: "Catalog" }, [
        this.single("status", "Status", STATUSES),
        this.single("origin", "Origin", ORIGINS),
        this.single("nsfw", "Mature content", NSFW_MODES),
      ]),
      Section(
        {
          id: "details",
          header: "Details",
          footer:
            "Tag takes a name or slug, e.g. academy. Origin only applies when no title is typed.",
        },
        [this.input("tag", "Tag"), this.input("minChapters", "Minimum chapters")],
      ),
    ];
  }

  override getSearchQueryMetadata(): ElftoonMetadata {
    // An explicit undefined cannot cross the bridge, so omit empty keys.
    const metadata: ElftoonMetadata = {};

    for (const key of [
      "genre",
      "exgenre",
      "status",
      "origin",
      "nsfw",
      "tag",
      "minChapters",
    ] as const) {
      const value = this.state[key];
      if (value) {
        metadata[key] = value;
      }
    }

    return metadata;
  }
}
