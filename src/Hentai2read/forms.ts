/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  closureSelector,
  InputRow,
  Section,
  SelectRow,
  ToggleRow,
  TriStateSelectRow,
  type FormItemElement,
  type FormSectionElement,
} from "@paperback/types";

import { STATUSES, TYPES, type H2RFilters, type Option, type TriState } from "./models";

export class Hentai2readSearchForm extends AdvancedSearchForm {
  private readonly tags: Option[];

  private state: H2RFilters;

  constructor(metadata: H2RFilters | undefined, tags: Option[]) {
    super();
    this.tags = tags;
    this.state = { ...metadata };
  }

  private single(
    id: string,
    title: string,
    options: Option[],
    key: "type" | "status",
  ): FormItemElement<unknown> {
    const current = this.state[key];
    return SelectRow(id, {
      title,
      layout: "flow",
      value: current ? [current] : [],
      items: options,
      minItemCount: 0,
      maxItemCount: 1,
      onValueChange: closureSelector(this, id, async (value: string[]) => {
        this.state[key] = value[0];
        this.reloadForm();
      }),
    });
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section(
        {
          id: "tags",
          header: "Tags",
          footer: "Tap once to include, twice to exclude.",
        },
        [
          TriStateSelectRow("tags", {
            title: "Tags",
            layout: "flow",
            value: this.state.tags ?? {},
            items: this.tags,
            allowExclusion: true,
            allowEmptySelection: true,
            onValueChange: closureSelector(this, "tags", async (value: TriState) => {
              this.state.tags = value;
              this.reloadForm();
            }),
          }),
          ToggleRow("any", {
            title: "Match any tag",
            subtitle: "Off: a series needs every included tag",
            value: this.state.any ?? false,
            onValueChange: closureSelector(this, "any", async (value: boolean) => {
              this.state.any = value;
            }),
          }),
        ],
      ),
      Section({ id: "catalog", header: "Catalog" }, [
        this.single("type", "Type", TYPES, "type"),
        this.single("status", "Status", STATUSES, "status"),
      ]),
      Section(
        {
          id: "artist",
          header: "Artist",
          footer: "Matched against the site's artist list, e.g. Fukudahda.",
        },
        [
          InputRow("artist", {
            title: "Artist",
            value: this.state.artist ?? "",
            onValueChange: closureSelector(this, "artist", async (value: string) => {
              this.state.artist = value.trim();
            }),
          }),
        ],
      ),
    ];
  }

  override getSearchQueryMetadata(): H2RFilters {
    // An explicit undefined cannot cross the bridge, so omit empty keys.
    const metadata: H2RFilters = {};

    if (this.state.tags && Object.keys(this.state.tags).length > 0) {
      metadata.tags = this.state.tags;
    }
    if (this.state.type) metadata.type = this.state.type;
    if (this.state.status) metadata.status = this.state.status;
    if (this.state.any) metadata.any = true;
    if (this.state.artist) metadata.artist = this.state.artist;

    return metadata;
  }
}
