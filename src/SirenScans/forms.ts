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

import { STATUSES, TYPES, type SirenSearchMetadata } from "./models";

export class SirenScansSearchForm extends AdvancedSearchForm {
  private readonly genres: Tag[];

  private tags: string[];

  private type: string[];

  private status: string[];

  constructor(metadata: SirenSearchMetadata | undefined, genres: Tag[]) {
    super();
    this.genres = genres;
    this.tags = metadata?.tags ?? [];
    this.type = metadata?.type ? [metadata.type] : [];
    this.status = metadata?.status ? [metadata.status] : [];
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section({ id: "kind", header: "Series" }, [
        SelectRow("type", {
          title: "Type",
          layout: "flow",
          value: this.type,
          items: TYPES,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "type", async (value: string[]) => {
            this.type = value;
          }),
        }),
        SelectRow("status", {
          title: "Status",
          layout: "flow",
          value: this.status,
          items: STATUSES,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "status", async (value: string[]) => {
            this.status = value;
          }),
        }),
      ]),
      Section(
        {
          id: "genres",
          header: "Genres",
          footer: "The site's tag list is typed in by hand, so a few entries are misspelt.",
        },
        this.genres.length === 0
          ? [LabelRow("unavailable", { title: "Genres could not be loaded" })]
          : [
              SelectRow("tags", {
                title: "Genres",
                layout: "flow",
                value: this.tags,
                items: this.genres.map((genre) => ({ id: genre.id, title: genre.title })),
                minItemCount: 0,
                maxItemCount: this.genres.length,
                onValueChange: closureSelector(this, "tags", async (value: string[]) => {
                  this.tags = value;
                  this.reloadForm();
                }),
              }),
            ],
      ),
    ];
  }

  override getSearchQueryMetadata(): SirenSearchMetadata {
    // An explicit undefined cannot cross the bridge, so omit empty keys.
    return {
      ...(this.tags.length > 0 ? { tags: this.tags } : {}),
      ...(this.type[0] ? { type: this.type[0] } : {}),
      ...(this.status[0] ? { status: this.status[0] } : {}),
    };
  }
}
