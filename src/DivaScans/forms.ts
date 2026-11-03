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
  NSFW_MODES,
  ORIGINS,
  STATUSES,
  TYPES,
  type DivaMetadata,
  type DivaRef,
  type DivaVocab,
} from "./models";

type Key = "type" | "status" | "origin" | "nsfw" | "genre" | "exgenre" | "tag" | "extag";

/**
 * The listing API takes exactly one value per filter (one genre, one excluded
 * genre, one tag, …), so every row is a single select.
 */
export class DivaScansSearchForm extends AdvancedSearchForm {
  private vocab?: DivaVocab | Error;
  private state: DivaMetadata;

  constructor(metadata: DivaMetadata | undefined, vocab: Promise<DivaVocab>) {
    super();
    this.state = { ...metadata };
    delete this.state.page;
    delete this.state.completed;

    vocab
      .then((loaded) => (this.vocab = loaded))
      .catch((error: unknown) => {
        this.vocab = error instanceof Error ? error : new Error(String(error));
      })
      .finally(() => this.reloadForm());
  }

  private single(key: Key, title: string, options: DivaRef[]): FormItemElement<unknown> {
    const current = this.state[key];
    return SelectRow(key, {
      title,
      layout: "flow",
      value: current ? [current] : [],
      items: options.map((option) => ({ id: option.slug, title: option.name })),
      minItemCount: 0,
      maxItemCount: 1,
      onValueChange: closureSelector(this, key, async (value: string[]) => {
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
    const sections: FormSectionElement<unknown>[] = [
      Section(
        {
          id: "catalog",
          header: "Catalog",
          footer:
            "A title search returns the 20 best matches and only honours Type and Adult content.",
        },
        [
          this.single("type", "Type", TYPES),
          this.single("status", "Status", STATUSES),
          this.single("origin", "Origin", ORIGINS),
          this.single("nsfw", "Adult content", NSFW_MODES),
        ],
      ),
    ];

    if (!this.vocab) {
      sections.push(
        Section("loading", [LabelRow("loading", { title: "Loading genres and tags" })]),
      );
    } else if (this.vocab instanceof Error) {
      sections.push(
        Section("error", [
          LabelRow("error", {
            title: "Could not load genres and tags",
            subtitle: this.vocab.message,
          }),
        ]),
      );
    } else {
      sections.push(
        Section(
          { id: "genres", header: "Genres", footer: "The site filters by one genre at a time." },
          [
            this.single("genre", "Genre", this.vocab.genres),
            this.single("exgenre", "Exclude genre", this.vocab.genres),
          ],
        ),
        Section({ id: "tags", header: "Tags" }, [
          this.single("tag", "Tag", this.vocab.tags),
          this.single("extag", "Exclude tag", this.vocab.tags),
        ]),
      );
    }

    return sections;
  }

  override getSearchQueryMetadata(): DivaMetadata {
    const metadata: DivaMetadata = {};
    for (const key of [
      "type",
      "status",
      "origin",
      "nsfw",
      "genre",
      "exgenre",
      "tag",
      "extag",
    ] as const) {
      const value = this.state[key];
      if (value) metadata[key] = value;
    }
    return metadata;
  }
}
