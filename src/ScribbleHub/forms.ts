/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  closureSelector,
  LabelRow,
  Section,
  SelectRow,
  TriStateSelectRow,
  type FormItemElement,
  type FormSectionElement,
} from "@paperback/types";

import {
  GENRE_MODES,
  STATUSES,
  type Option,
  type SearchMetadata,
  type TriState,
  type Vocab,
} from "./models";

export class ScribbleHubSearchForm extends AdvancedSearchForm {
  private vocab?: Vocab | Error;
  private state: SearchMetadata;

  constructor(metadata: SearchMetadata | undefined, vocab: Promise<Vocab>) {
    super();
    this.state = { ...metadata };
    delete this.state.page;

    vocab
      .then((loaded) => (this.vocab = loaded))
      .catch((error: unknown) => {
        this.vocab = error instanceof Error ? error : new Error(String(error));
      })
      .finally(() => this.reloadForm());
  }

  private single(
    id: "status" | "genreMode",
    title: string,
    options: Option[],
  ): FormItemElement<unknown> {
    return SelectRow(id, {
      title,
      layout: "flow",
      value: this.state[id] ? [this.state[id]] : [],
      items: options,
      minItemCount: 0,
      maxItemCount: 1,
      onValueChange: closureSelector(this, id, async (value: string[]) => {
        const picked = value[0];
        if (id === "genreMode") {
          this.state.genreMode = picked === "and" || picked === "or" ? picked : undefined;
        } else if (picked) {
          this.state.status = picked;
        } else {
          delete this.state.status;
        }
        this.reloadForm();
      }),
    });
  }

  private tri(
    id: "genres" | "tags" | "warnings",
    title: string,
    options: Option[],
  ): FormItemElement<unknown> {
    return TriStateSelectRow(id, {
      title,
      layout: "flow",
      value: this.state[id] ?? {},
      items: options,
      allowExclusion: true,
      allowEmptySelection: true,
      onValueChange: closureSelector(this, id, async (value: TriState) => {
        if (Object.keys(value).length > 0) {
          this.state[id] = value;
        } else {
          delete this.state[id];
        }
        this.reloadForm();
      }),
    });
  }

  override getSections(): FormSectionElement<unknown>[] {
    const general = Section(
      {
        id: "general",
        header: "Filters",
        footer:
          "Filters combine with the typed title. Tap a genre once to require it, twice to exclude it.",
      },
      [
        this.single("status", "Status", STATUSES),
        this.single("genreMode", "Included genres", GENRE_MODES),
      ],
    );

    if (!this.vocab) {
      return [
        general,
        Section("loading", [LabelRow("loading", { title: "Loading genres and tags" })]),
      ];
    }

    if (this.vocab instanceof Error) {
      return [
        general,
        Section("error", [
          LabelRow("error", {
            title: "Could not load the series finder",
            subtitle: this.vocab.message,
          }),
        ]),
      ];
    }

    const sections = [
      general,
      Section({ id: "genres", header: "Genres" }, [
        this.tri("genres", "Genres", this.vocab.genres),
      ]),
    ];
    if (this.vocab.warnings.length > 0) {
      sections.push(
        Section({ id: "warnings", header: "Content warnings" }, [
          this.tri("warnings", "Content warnings", this.vocab.warnings),
        ]),
      );
    }
    if (this.vocab.tags.length > 0) {
      sections.push(
        Section({ id: "tags", header: "Tags", footer: "Every included tag must match." }, [
          this.tri("tags", "Tags", this.vocab.tags),
        ]),
      );
    }
    return sections;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const out: SearchMetadata = {};
    if (this.state.status) out.status = this.state.status;
    if (this.state.genreMode) out.genreMode = this.state.genreMode;
    if (this.state.genres && Object.keys(this.state.genres).length) out.genres = this.state.genres;
    if (this.state.tags && Object.keys(this.state.tags).length) out.tags = this.state.tags;
    if (this.state.warnings && Object.keys(this.state.warnings).length)
      out.warnings = this.state.warnings;
    return out;
  }
}
