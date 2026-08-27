/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  closureSelector,
  type FormSectionElement,
} from "@paperback/types";

import { SORTS, STATUSES, TYPES, type GenreChoice, type KaynSearchMetadata } from "./models";

/**
 * A row hands back one string per choice, so a genre standing for several of the
 * site's ids carries them joined by a character an id is allowed to hold.
 */
const ID_JOIN = "+";

/**
 * The site's own filters, offered as it publishes them.
 *
 * Every option here was checked against the live API: it genuinely narrows the
 * results. The values the endpoint quietly ignores are not offered, and the
 * genres are the site's own list rather than one written down here, so a tag
 * added tomorrow appears without the extension being touched.
 */
export class KaynScanSearchForm extends AdvancedSearchForm {
  private readonly genres: GenreChoice[];

  private sort: string[];

  private status: string[];

  private type: string[];

  private genreIds: string[];

  constructor(metadata: KaynSearchMetadata | undefined, genres: GenreChoice[]) {
    super();
    this.genres = genres;
    this.sort = metadata?.sort ? [metadata.sort] : [];
    this.status = metadata?.status ? [metadata.status] : [];
    this.type = metadata?.type ? [metadata.type] : [];
    this.genreIds = KaynScanSearchForm.selected(genres, metadata?.genreIds ?? []);
  }

  /**
   * Which entry in the list a set of ids belongs to.
   *
   * A genre is remembered by the ids it stands for, and a row can only mark an
   * entry it recognises by its own name for it. Matching on any id in common
   * rather than on the joined string means a genre still shows as chosen after
   * the site tags something new, and that a filter set by an older version of
   * this extension - which knew a genre by a single id - is understood rather
   * than quietly dropped.
   */
  private static selected(genres: GenreChoice[], ids: (string | number)[]): string[] {
    const wanted = ids.flatMap((id) => String(id).split(ID_JOIN)).filter((id) => id.length > 0);

    if (!wanted.length) {
      return [];
    }

    const match = genres.find((genre) => genre.ids.some((id) => wanted.includes(id)));

    return match ? [match.ids.join(ID_JOIN)] : [];
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
      Section({ id: "genres", footer: "Genres the site has actually tagged something with." }, [
        SelectRow("genres", {
          title: "Genre",
          layout: "list",
          value: this.genreIds,
          items: this.genres.map((genre) => ({
            id: genre.ids.join(ID_JOIN),
            title: genre.title,
          })),
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
    const ids = this.genreIds
      .flatMap((value) => value.split(ID_JOIN))
      .filter((id) => id.trim().length > 0);

    return {
      ...(this.sort[0] ? { sort: this.sort[0] } : {}),
      ...(this.status[0] ? { status: this.status[0] } : {}),
      ...(this.type[0] ? { type: this.type[0] } : {}),
      ...(ids.length ? { genreIds: ids } : {}),
    };
  }
}
