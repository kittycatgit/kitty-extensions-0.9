/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  closureSelector,
  Section,
  SelectRow,
  type FormSectionElement,
} from "@paperback/types";

import { CATEGORIES, type DankeSearchMetadata } from "./models";

export class DankeSearchForm extends AdvancedSearchForm {
  private selectedCategory: string[];

  constructor(metadata: DankeSearchMetadata | undefined) {
    super();
    this.selectedCategory = metadata?.category ? [metadata.category] : [];
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section({ id: "category", footer: "Leave empty to search every section." }, [
        SelectRow("category", {
          title: "Section",
          layout: "list",
          value: this.selectedCategory,
          items: CATEGORIES.map((category) => ({ id: category.id, title: category.title })),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "category", async (value: string[]) => {
            this.selectedCategory = value;
            this.reloadForm();
          }),
        }),
      ]),
    ];
  }

  override getSearchQueryMetadata(): DankeSearchMetadata {
    return this.selectedCategory[0] ? { category: this.selectedCategory[0] } : {};
  }
}
