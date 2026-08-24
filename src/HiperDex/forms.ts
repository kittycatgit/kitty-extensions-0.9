/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  closureSelector,
  InputRow,
  Section,
  SelectRow,
  type FormSectionElement,
} from "@paperback/types";
import type { Tag } from "@paperback/types";

import {
  CONTENT_RATING_OPTIONS,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  type HiperDexSearchMetadata,
} from "./models";

/** Mirrors the filters the site's own catalogue page sends to the API. */
export class HiperDexSearchForm extends AdvancedSearchForm {
  private genres: string[];
  private type: string[];
  private status: string[];
  private contentRating: string[];
  private year: string;
  private readonly genreOptions: Tag[];

  constructor(metadata: HiperDexSearchMetadata | undefined, genreOptions: Tag[]) {
    super();
    this.genreOptions = genreOptions;
    this.genres = metadata?.genres ?? [];
    this.type = metadata?.type ? [metadata.type] : [];
    this.status = metadata?.status ? [metadata.status] : [];
    this.contentRating = metadata?.contentRating ? [metadata.contentRating] : [];
    this.year = typeof metadata?.year === "number" ? String(metadata.year) : "";
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section(
        {
          id: "genres",
          header: "Genres",
          // Verified against the API: asking for two genres returns more rows
          // than asking for one, so the filter widens rather than narrows.
          footer: "Titles match any selected genre, so adding genres widens the results.",
        },
        [
          SelectRow("genres", {
            title: "Genres",
            layout: "flow",
            value: this.genres,
            items: this.genreOptions.map((genre) => ({ id: genre.id, title: genre.title })),
            minItemCount: 0,
            maxItemCount: this.genreOptions.length,
            onValueChange: closureSelector(this, "genres", async (value: string[]) => {
              this.genres = value;
              this.reloadForm();
            }),
          }),
        ],
      ),
      Section({ id: "attributes", header: "Attributes" }, [
        SelectRow("type", {
          title: "Type",
          layout: "list",
          value: this.type,
          items: TYPE_OPTIONS.map((option) => ({ id: option.id, title: option.title })),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "type", async (value: string[]) => {
            this.type = value;
            this.reloadForm();
          }),
        }),
        SelectRow("status", {
          title: "Status",
          layout: "list",
          value: this.status,
          items: STATUS_OPTIONS.map((option) => ({ id: option.id, title: option.title })),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "status", async (value: string[]) => {
            this.status = value;
            this.reloadForm();
          }),
        }),
        SelectRow("contentRating", {
          title: "Content rating",
          layout: "list",
          value: this.contentRating,
          items: CONTENT_RATING_OPTIONS.map((option) => ({ id: option.id, title: option.title })),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "contentRating", async (value: string[]) => {
            this.contentRating = value;
            this.reloadForm();
          }),
        }),
      ]),
      Section({ id: "year", header: "Year", footer: "Leave empty to search every year." }, [
        InputRow("year", {
          title: "Release year",
          value: this.year,
          onValueChange: closureSelector(this, "year", async (value: string) => {
            this.year = value;
          }),
        }),
      ]),
    ];
  }

  override getSearchQueryMetadata(): HiperDexSearchMetadata {
    const year = Number.parseInt(this.year.trim(), 10);

    // Only defined keys are carried: an explicit undefined member cannot be
    // serialised across the bridge, and the API rejects a null filter outright.
    return {
      ...(this.genres.length > 0 ? { genres: this.genres } : {}),
      ...(this.type[0] ? { type: this.type[0] } : {}),
      ...(this.status[0] ? { status: this.status[0] } : {}),
      ...(this.contentRating[0] ? { contentRating: this.contentRating[0] } : {}),
      ...(Number.isFinite(year) && year > 0 ? { year } : {}),
    };
  }
}
