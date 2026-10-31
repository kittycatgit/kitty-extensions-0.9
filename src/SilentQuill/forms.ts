/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  closureSelector,
  LabelRow,
  Section,
  SelectRow,
  type FormSectionElement,
  type Tag,
} from "@paperback/types";

import { STATUSES, type SilentQuillMetadata } from "./models";

export class SilentQuillSearchForm extends AdvancedSearchForm {
  private readonly options: Tag[];

  private genre: string[];

  private status: string[];

  constructor(metadata: SilentQuillMetadata | undefined, options: Tag[]) {
    super();
    this.options = options;
    this.genre = metadata?.genre ? [metadata.genre] : [];
    this.status = metadata?.status ? [metadata.status] : [];
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section(
        {
          id: "genre",
          header: "Genre",
          // The search endpoint takes a single genre alongside the title.
          footer: "One genre at a time; it combines with the title and status.",
        },
        this.options.length === 0
          ? [LabelRow("unavailable", { title: "Genres could not be loaded" })]
          : [
              SelectRow("genre", {
                title: "Genre",
                layout: "flow",
                value: this.genre,
                items: this.options.map((genre) => ({ id: genre.id, title: genre.title })),
                minItemCount: 0,
                maxItemCount: 1,
                onValueChange: closureSelector(this, "genre", async (value: string[]) => {
                  this.genre = value;
                  this.reloadForm();
                }),
              }),
            ],
      ),
      Section({ id: "status", header: "Status" }, [
        SelectRow("status", {
          title: "Status",
          layout: "flow",
          value: this.status,
          items: STATUSES.map((entry) => ({ id: entry.id, title: entry.title })),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "status", async (value: string[]) => {
            this.status = value;
            this.reloadForm();
          }),
        }),
      ]),
    ];
  }

  override getSearchQueryMetadata(): SilentQuillMetadata {
    // An explicit undefined cannot cross the bridge, so omit empty keys.
    return {
      ...(this.genre[0] ? { genre: this.genre[0] } : {}),
      ...(this.status[0] ? { status: this.status[0] } : {}),
    };
  }
}
