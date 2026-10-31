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

import { SECTIONS, STATUSES, TYPES, type CoffeeSearchMetadata } from "./models";

type Option = { id: string; title: string };

export class CoffeeSearchForm extends AdvancedSearchForm {
  private readonly genres: Tag[];

  private genre: string[];
  private type: string[];
  private status: string[];
  private section: string[];

  constructor(metadata: CoffeeSearchMetadata | undefined, genres: Tag[]) {
    super();
    this.genres = genres;
    this.genre = metadata?.genre ? [metadata.genre] : [];
    this.type = metadata?.type ? [metadata.type] : [];
    this.status = metadata?.status ? [metadata.status] : [];
    this.section = metadata?.section ? [metadata.section] : [];
  }

  private single(
    id: "genre" | "type" | "status" | "section",
    title: string,
    items: Option[],
    value: string[],
  ) {
    return SelectRow(id, {
      title,
      layout: "flow",
      value,
      items,
      minItemCount: 0,
      maxItemCount: 1,
      onValueChange: closureSelector(this, id, async (next: string[]) => {
        this[id] = next;
        this.reloadForm();
      }),
    });
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section(
        {
          id: "catalog",
          header: "Catalog",
          // /search only takes a title; the library takes every filter but no
          // title, so a title combined with filters is matched inside the
          // filtered listing page by page.
          footer:
            "With any filter set, the title narrows the filtered listing instead of searching.",
        },
        [
          this.single("type", "Type", TYPES, this.type),
          this.single("status", "Status", STATUSES, this.status),
          this.single("section", "Section", SECTIONS, this.section),
        ],
      ),
      Section({ id: "genre", header: "Genre" }, [
        this.genres.length
          ? this.single(
              "genre",
              "Genre",
              this.genres.map((genre) => ({ id: genre.id, title: genre.title })),
              this.genre,
            )
          : LabelRow("unavailable", {
              title: "Genres could not be loaded",
              subtitle: "The other filters still work.",
            }),
      ]),
    ];
  }

  override getSearchQueryMetadata(): CoffeeSearchMetadata {
    // An explicit undefined cannot cross the bridge, so omit empty keys.
    return {
      ...(this.genre[0] ? { genre: this.genre[0] } : {}),
      ...(this.type[0] ? { type: this.type[0] } : {}),
      ...(this.status[0] ? { status: this.status[0] } : {}),
      ...(this.section[0] ? { section: this.section[0] } : {}),
    };
  }
}
