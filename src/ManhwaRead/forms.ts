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

import { SORTING_OPTIONS, type ManhwaReadSearchMetadata } from "./models";

/**
 * The site's browse endpoint takes a single `sortby` value, so the form offers
 * that rather than pretending to support genre combinations it cannot honour.
 */
export class ManhwaReadSearchForm extends AdvancedSearchForm {
  private selectedSort: string[];

  constructor(metadata: ManhwaReadSearchMetadata | undefined) {
    super();
    this.selectedSort = metadata?.sort ? [metadata.sort] : [];
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section({ id: "sort", footer: "Applies to both browsing and title search." }, [
        SelectRow("sort", {
          title: "Sort by",
          layout: "list",
          value: this.selectedSort,
          items: SORTING_OPTIONS.map((option) => ({ id: option.id, title: option.label })),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "sort", async (value: string[]) => {
            this.selectedSort = value;
            this.reloadForm();
          }),
        }),
        LabelRow("hint", {
          title: "Genres",
          subtitle: "The site has no genre filter on its browse endpoint.",
        }),
      ]),
    ];
  }

  override getSearchQueryMetadata(): ManhwaReadSearchMetadata {
    return this.selectedSort[0] ? { sort: this.selectedSort[0] } : {};
  }
}
