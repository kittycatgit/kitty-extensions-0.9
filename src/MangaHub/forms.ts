/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  closureSelector,
  LabelRow,
  Section,
  SelectRow,
  ToggleRow,
  type FormSectionElement,
  type Tag,
} from "@paperback/types";

import type { MangaHubSearchMetadata } from "./models";

export class MangaHubSearchForm extends AdvancedSearchForm {
  private genres: string[];
  private hideNSFW: boolean;
  private hideYaoi: boolean;
  private hideLicensed: boolean;
  private readonly genreOptions: Tag[];

  constructor(metadata: MangaHubSearchMetadata | undefined, genreOptions: Tag[]) {
    super();
    this.genreOptions = genreOptions;
    this.genres = metadata?.genres ?? [];
    this.hideNSFW = metadata?.hideNSFW ?? false;
    this.hideYaoi = metadata?.hideYaoi ?? false;
    this.hideLicensed = metadata?.hideLicensed ?? false;
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section(
        {
          id: "genres",
          header: "Genres",
          // The API ORs genres together, so each one added returns more rows.
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
      Section({ id: "hide", header: "Exclude" }, [
        ToggleRow("hideNSFW", {
          title: "Hide NSFW",
          value: this.hideNSFW,
          onValueChange: closureSelector(this, "hideNSFW", async (value: boolean) => {
            this.hideNSFW = value;
          }),
        }),
        ToggleRow("hideYaoi", {
          title: "Hide Yaoi",
          value: this.hideYaoi,
          onValueChange: closureSelector(this, "hideYaoi", async (value: boolean) => {
            this.hideYaoi = value;
          }),
        }),
        ToggleRow("hideLicensed", {
          title: "Hide licensed",
          subtitle: "Licensed titles often have no readable chapters.",
          value: this.hideLicensed,
          onValueChange: closureSelector(this, "hideLicensed", async (value: boolean) => {
            this.hideLicensed = value;
          }),
        }),
      ]),
      Section({ id: "notes" }, [
        LabelRow("status", {
          title: "Status",
          // The schema takes a Status argument but the resolver ignores it -
          // every value returns the same mixed rows.
          subtitle: "The site's API ignores status filtering, so it is not offered.",
        }),
      ]),
    ];
  }

  override getSearchQueryMetadata(): MangaHubSearchMetadata {
    // An explicit undefined member cannot be serialised across the bridge, so
    // only set keys are included.
    return {
      ...(this.genres.length > 0 ? { genres: this.genres } : {}),
      ...(this.hideNSFW ? { hideNSFW: true } : {}),
      ...(this.hideYaoi ? { hideYaoi: true } : {}),
      ...(this.hideLicensed ? { hideLicensed: true } : {}),
    };
  }
}
