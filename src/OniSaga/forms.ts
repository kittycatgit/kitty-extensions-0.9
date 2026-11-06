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

import {
  DEMOGRAPHICS,
  FORMS,
  ORIGINS,
  STATUSES,
  THEMES,
  type OniSagaMetadata,
  type Option,
} from "./models";

type ListKey = "genres" | "themes" | "statuses" | "origins" | "demographics" | "forms";

export class OniSagaSearchForm extends AdvancedSearchForm {
  private readonly genres: Option[] | undefined;

  private state: OniSagaMetadata;

  constructor(metadata: OniSagaMetadata | undefined, genres: Option[] | undefined) {
    super();
    this.genres = genres;
    this.state = { ...metadata };
  }

  private multi(
    id: string,
    title: string,
    options: Option[],
    key: ListKey,
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

  override getSections(): FormSectionElement<unknown>[] {
    const genres = this.genres;

    return [
      Section(
        {
          id: "genres",
          header: "Genres",
          footer: genres
            ? "A series must carry every chosen genre."
            : "The genre list could not be loaded. Every other filter still works.",
        },
        [
          genres
            ? this.multi("genres", "Genres", genres, "genres")
            : LabelRow("unavailable", { title: "Genres could not be loaded" }),
        ],
      ),
      Section({ id: "catalog", header: "Catalog" }, [
        this.multi("themes", "Themes", THEMES, "themes"),
        this.multi("statuses", "Status", STATUSES, "statuses"),
        this.multi("origins", "Origin", ORIGINS, "origins"),
        this.multi("demographics", "Demographic", DEMOGRAPHICS, "demographics"),
        this.multi("forms", "Format", FORMS, "forms"),
      ]),
    ];
  }

  override getSearchQueryMetadata(): OniSagaMetadata {
    // An explicit undefined cannot cross the bridge, so omit empty keys.
    const metadata: OniSagaMetadata = {};

    for (const key of [
      "genres",
      "themes",
      "statuses",
      "origins",
      "demographics",
      "forms",
    ] as const) {
      const value = this.state[key];
      if (value && value.length > 0) {
        metadata[key] = value;
      }
    }

    return metadata;
  }
}
