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

import { STATUSES, TYPES, type SilentQuillMetadata } from "./models";

export class SilentQuillSearchForm extends AdvancedSearchForm {
  private readonly options: Tag[];

  private genres: string[];

  private status: string[];

  private type: string[];

  constructor(metadata: SilentQuillMetadata | undefined, options: Tag[]) {
    super();
    this.options = options;
    this.genres = metadata?.genres ?? [];
    this.status = metadata?.status ? [metadata.status] : [];
    this.type = metadata?.type ? [metadata.type] : [];
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section(
        {
          id: "genres",
          header: "Genres",
          // The site drops every filter as soon as a title is typed, so the two
          // cannot be sent together.
          footer:
            this.options.length > 0
              ? "Combine genres with a title and the title is matched against the filtered list."
              : "Genres could not be loaded. Search by title still works.",
        },
        this.options.length === 0
          ? [LabelRow("unavailable", { title: "Genres could not be loaded" })]
          : [
              SelectRow("genres", {
                title: "Genres",
                layout: "flow",
                value: this.genres,
                items: this.options.map((genre) => ({ id: genre.id, title: genre.title })),
                minItemCount: 0,
                maxItemCount: this.options.length,
                onValueChange: closureSelector(this, "genres", async (value: string[]) => {
                  this.genres = value;
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
      Section({ id: "type", header: "Type" }, [
        SelectRow("type", {
          title: "Type",
          layout: "flow",
          value: this.type,
          items: TYPES.map((entry) => ({ id: entry.id, title: entry.title })),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "type", async (value: string[]) => {
            this.type = value;
            this.reloadForm();
          }),
        }),
      ]),
    ];
  }

  override getSearchQueryMetadata(): SilentQuillMetadata {
    // An explicit undefined cannot cross the bridge, so omit empty keys.
    return {
      ...(this.genres.length > 0 ? { genres: this.genres } : {}),
      ...(this.status[0] ? { status: this.status[0] } : {}),
      ...(this.type[0] ? { type: this.type[0] } : {}),
    };
  }
}
