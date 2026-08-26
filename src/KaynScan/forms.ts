/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  closureSelector,
  type FormSectionElement,
} from "@paperback/types";

import { SORTS, STATUSES, TYPES, type ApiGenre, type KaynSearchMetadata } from "./models";

/**
 * The site's own filters, offered as it publishes them.
 *
 * Every option here was checked against the live API: it genuinely narrows the
 * results. The values the endpoint quietly ignores are not offered, and the
 * genres are the site's own list rather than one written down here, so a tag
 * added tomorrow appears without the extension being touched.
 */
export class KaynScanSearchForm extends AdvancedSearchForm {
  private readonly genres: ApiGenre[];

  private sort: string[];

  private status: string[];

  private type: string[];

  private genreIds: string[];

  constructor(metadata: KaynSearchMetadata | undefined, genres: ApiGenre[]) {
    super();
    this.genres = genres;
    this.sort = metadata?.sort ? [metadata.sort] : [];
    this.status = metadata?.status ? [metadata.status] : [];
    this.type = metadata?.type ? [metadata.type] : [];
    this.genreIds = (metadata?.genreIds ?? []).map((id) => String(id));
  }

  override getSections(): FormSectionElement<unknown>[] {
    const pretty = (value: string): string => value.charAt(0) + value.slice(1).toLowerCase();

    return [
      Section({ id: "sort", footer: "Applies to browsing and to title search." }, [
        SelectRow("sort", {
          title: "Sort by",
          layout: "list",
          value: this.sort,
          items: SORTS.map((option) => ({ id: option.id, title: option.label })),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "sort", async (value: string[]) => {
            this.sort = value;
            this.reloadForm();
          }),
        }),
      ]),
      Section({ id: "filters" }, [
        SelectRow("status", {
          title: "Status",
          layout: "list",
          value: this.status,
          items: STATUSES.map((value) => ({ id: value, title: pretty(value) })),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "status", async (value: string[]) => {
            this.status = value;
            this.reloadForm();
          }),
        }),
        SelectRow("type", {
          title: "Type",
          layout: "list",
          value: this.type,
          items: TYPES.map((value) => ({ id: value, title: pretty(value) })),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "type", async (value: string[]) => {
            this.type = value;
            this.reloadForm();
          }),
        }),
      ]),
      Section({ id: "genres", footer: "The endpoint narrows on one genre at a time." }, [
        SelectRow("genres", {
          title: "Genre",
          layout: "list",
          value: this.genreIds,
          items: this.genres
            .filter((genre) => genre.id !== undefined && (genre.name ?? "").trim().length > 0)
            .map((genre) => ({ id: String(genre.id), title: (genre.name ?? "").trim() })),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "genres", async (value: string[]) => {
            this.genreIds = value;
            this.reloadForm();
          }),
        }),
      ]),
    ];
  }

  override getSearchQueryMetadata(): KaynSearchMetadata {
    const ids = this.genreIds.map((id) => Number(id)).filter((id) => Number.isFinite(id));

    return {
      ...(this.sort[0] ? { sort: this.sort[0] } : {}),
      ...(this.status[0] ? { status: this.status[0] } : {}),
      ...(this.type[0] ? { type: this.type[0] } : {}),
      ...(ids.length ? { genreIds: ids } : {}),
    };
  }
}
