/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { AdvancedSearchForm, Section, SelectRow, type FormSectionElement } from "@paperback/types";

import type { SuwayomiSearchMetadata, SuwayomiSource } from "./models";

export class SuwayomiSearchForm extends AdvancedSearchForm {
  private readonly sources: SuwayomiSource[];

  private picked: string[];

  constructor(metadata: SuwayomiSearchMetadata | undefined, sources: SuwayomiSource[]) {
    super();
    this.sources = sources;
    this.picked = (metadata?.sources ?? []).filter((id) =>
      sources.some((source) => source.id === id),
    );
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section(
        {
          id: "sites",
          header: "Sites",
          footer: "Leave empty to search every site installed on the server.",
        },
        [
          SelectRow("sources", {
            title: "Search in",
            layout: "flow",
            value: this.picked,
            items: this.sources.map((source) => ({ id: source.id, title: source.displayName })),
            minItemCount: 0,
            maxItemCount: Math.max(this.sources.length, 1),
            onValueChange: Application.Selector(this as SuwayomiSearchForm, "sourcesChanged"),
          }),
        ],
      ),
    ];
  }

  async sourcesChanged(value: string[]): Promise<void> {
    this.picked = value;
  }

  override getSearchQueryMetadata(): SuwayomiSearchMetadata {
    return this.picked.length > 0 ? { sources: this.picked } : {};
  }
}
