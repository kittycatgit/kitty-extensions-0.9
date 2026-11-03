/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  closureSelector,
  LabelRow,
  Section,
  SelectRow,
  type FormItemElement,
  type FormSectionElement,
} from "@paperback/types";

import { STATUSES, type KnoxTMetadata, type Option, type Vocab } from "./models";

export class KnoxTSearchForm extends AdvancedSearchForm {
  private vocab?: Vocab | Error;
  private state: KnoxTMetadata;

  constructor(metadata: KnoxTMetadata | undefined, vocab: Promise<Vocab>) {
    super();
    this.state = { ...metadata };
    delete this.state.page;
    delete this.state.completed;

    vocab
      .then((loaded) => (this.vocab = loaded))
      .catch((error: unknown) => {
        this.vocab = error instanceof Error ? error : new Error(String(error));
      })
      .finally(() => this.reloadForm());
  }

  private multi(
    id: "genres" | "types",
    title: string,
    options: Option[],
  ): FormItemElement<unknown> {
    return SelectRow(id, {
      title,
      layout: "flow",
      value: this.state[id] ?? [],
      items: options,
      minItemCount: 0,
      maxItemCount: options.length,
      onValueChange: closureSelector(this, id, async (value: string[]) => {
        if (value.length > 0) {
          this.state[id] = value;
        } else {
          delete this.state[id];
        }
        this.reloadForm();
      }),
    });
  }

  override getSections(): FormSectionElement<unknown>[] {
    const status = Section(
      {
        id: "filters",
        header: "Filters",
        footer: "A title search ignores every filter; filters apply when the title is empty.",
      },
      [
        SelectRow("status", {
          title: "Status",
          layout: "flow",
          value: this.state.status ? [this.state.status] : [],
          items: STATUSES,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "status", async (value: string[]) => {
            if (value[0]) {
              this.state.status = value[0];
            } else {
              delete this.state.status;
            }
            this.reloadForm();
          }),
        }),
      ],
    );

    if (!this.vocab) {
      return [status, Section("loading", [LabelRow("loading", { title: "Loading genres" })])];
    }

    if (this.vocab instanceof Error) {
      return [
        status,
        Section("error", [
          LabelRow("error", { title: "Could not load genres", subtitle: this.vocab.message }),
        ]),
      ];
    }

    return [
      status,
      Section({ id: "types", header: "Type" }, [this.multi("types", "Type", this.vocab.types)]),
      Section({ id: "genres", header: "Genres", footer: "Every picked genre must match." }, [
        this.multi("genres", "Genres", this.vocab.genres),
      ]),
    ];
  }

  override getSearchQueryMetadata(): KnoxTMetadata {
    const out: KnoxTMetadata = {};
    if (this.state.status) out.status = this.state.status;
    if (this.state.types?.length) out.types = this.state.types;
    if (this.state.genres?.length) out.genres = this.state.genres;
    return out;
  }
}
