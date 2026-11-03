/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  closureSelector,
  LabelRow,
  Section,
  SelectRow,
  type FormSectionElement,
} from "@paperback/types";

import { STATUSES, TYPES, type LagoonGenre, type LagoonSearchMetadata } from "./models";

export class LagoonScansSearchForm extends AdvancedSearchForm {
  private readonly genreOptions: LagoonGenre[];

  private genres: string[];

  private status: string[];

  private type: string[];

  constructor(metadata: LagoonSearchMetadata | undefined, genres: LagoonGenre[]) {
    super();
    this.genreOptions = genres;
    this.genres = metadata?.genres ?? [];
    this.status = metadata?.status ? [metadata.status] : [];
    this.type = metadata?.type ? [metadata.type] : [];
  }

  override getSections(): FormSectionElement<unknown>[] {
    const genreSection =
      this.genreOptions.length === 0
        ? Section({ id: "genres" }, [
            LabelRow("unavailable", {
              title: "Genres could not be loaded",
              subtitle: "Search by title, status and type still works.",
            }),
          ])
        : Section(
            { id: "genres", header: "Genres", footer: "A title must carry every chosen genre." },
            [
              SelectRow("genres", {
                title: "Genres",
                layout: "flow",
                value: this.genres,
                items: this.genreOptions.map((genre) => ({ id: genre.id, title: genre.name })),
                minItemCount: 0,
                maxItemCount: this.genreOptions.length,
                onValueChange: closureSelector(this, "genres", async (value: string[]) => {
                  this.genres = value;
                  this.reloadForm();
                }),
              }),
            ],
          );

    return [
      genreSection,
      Section({ id: "status", header: "Status" }, [
        SelectRow("status", {
          title: "Status",
          layout: "flow",
          value: this.status,
          items: STATUSES,
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
          items: TYPES,
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

  override getSearchQueryMetadata(): LagoonSearchMetadata {
    return {
      ...(this.genres.length > 0 ? { genres: this.genres } : {}),
      ...(this.status[0] ? { status: this.status[0] } : {}),
      ...(this.type[0] ? { type: this.type[0] } : {}),
    };
  }
}
