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
  KINDS,
  LANGUAGES,
  RATINGS,
  STATUSES,
  type TriState,
  type WebnexMetadata,
} from "./models";
import type { Taxonomy } from "./parsers";

type Option = { id: string; title: string };

export class WebnexSearchForm extends AdvancedSearchForm {
  private readonly taxonomy: Taxonomy | undefined;

  private state: WebnexMetadata;

  constructor(
    metadata: WebnexMetadata | undefined,
    taxonomy: Taxonomy | undefined,
    rating: string,
  ) {
    super();
    this.taxonomy = taxonomy;
    this.state = { rating, ...metadata };
  }

  private multi(
    id: string,
    title: string,
    options: Option[],
    key: "kinds" | "statuses" | "demographics" | "languages",
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

  private tri(
    id: string,
    title: string,
    options: Option[],
    key: "genres" | "tags",
  ): FormItemElement<unknown> {
    return TriStateSelectRow(id, {
      title,
      layout: "flow",
      value: this.state[key] ?? {},
      items: options,
      allowExclusion: true,
      allowEmptySelection: true,
      onValueChange: closureSelector(this, id, async (value: TriState) => {
        this.state[key] = value;
        this.reloadForm();
      }),
    });
  }

  private input(
    id: string,
    title: string,
    key: "from" | "to" | "chapters" | "author" | "artist",
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
    const taxonomy = this.taxonomy;

    return [
      Section({ id: "catalog", header: "Catalog" }, [
        this.multi("kinds", "Type", KINDS, "kinds"),
        this.multi("statuses", "Status", STATUSES, "statuses"),
        this.multi("demographics", "Demographic", DEMOGRAPHICS, "demographics"),
        this.multi("languages", "Original language", LANGUAGES, "languages"),
      ]),
      Section(
        {
          id: "rating",
          header: "Content rating",
          footer: "Results include everything up to the chosen rating.",
        },
        [
          SelectRow("rating", {
            title: "Up to",
            layout: "flow",
            value: this.state.rating ? [this.state.rating] : [],
            items: RATINGS,
            minItemCount: 1,
            maxItemCount: 1,
            onValueChange: closureSelector(this, "rating", async (value: string[]) => {
              this.state.rating = value[0];
              this.reloadForm();
            }),
          }),
        ],
      ),
      Section(
        {
          id: "taxonomy",
          header: "Genres and tags",
          footer: taxonomy
            ? "Tap once to include, twice to exclude."
            : "The genre list could not be loaded. Every other filter still works.",
        },
        taxonomy
          ? [
              this.tri("genres", "Genres", taxonomy.genres, "genres"),
              this.tri("tags", "Tags", taxonomy.tags, "tags"),
              ToggleRow("matchAny", {
                title: "Match any",
                subtitle: "Off: a series needs every included genre and tag.",
                value: this.state.matchAny ?? false,
                onValueChange: closureSelector(this, "matchAny", async (value: boolean) => {
                  this.state.matchAny = value;
                }),
              }),
            ]
          : [LabelRow("unavailable", { title: "Genres could not be loaded" })],
      ),
      Section({ id: "details", header: "Details" }, [
        this.input("from", "Year from", "from"),
        this.input("to", "Year to", "to"),
        this.input("chapters", "Minimum chapters", "chapters"),
        this.input("author", "Author", "author"),
        this.input("artist", "Artist", "artist"),
      ]),
    ];
  }

  override getSearchQueryMetadata(): WebnexMetadata {
    // An explicit undefined cannot cross the bridge, so omit empty keys.
    const metadata: WebnexMetadata = {};

    for (const key of ["kinds", "statuses", "demographics", "languages"] as const) {
      const value = this.state[key];

      if (value && value.length > 0) {
        metadata[key] = value;
      }
    }

    for (const key of ["genres", "tags"] as const) {
      const value = this.state[key];

      if (value && Object.keys(value).length > 0) {
        metadata[key] = value;
      }
    }

    for (const key of ["rating", "from", "to", "chapters", "author", "artist"] as const) {
      const value = this.state[key];

      if (value) {
        metadata[key] = value;
      }
    }

    if (this.state.matchAny) {
      metadata.matchAny = true;
    }

    return metadata;
  }
}
