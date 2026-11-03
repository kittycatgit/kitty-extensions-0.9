/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  closureSelector,
  InputRow,
  Section,
  SelectRow,
  type FormItemElement,
  type FormSectionElement,
} from "@paperback/types";

import {
  GENRES,
  LANGUAGES,
  LENGTHS,
  MATCHES,
  RATINGS,
  STATUSES,
  TIME_RANGES,
  type FanFictionMetadata,
  type Option,
} from "./models";

type SelectKey = Exclude<keyof FanFictionMetadata, "fandom" | "page" | "completed">;

export class FanFictionSearchForm extends AdvancedSearchForm {
  private state: FanFictionMetadata;

  constructor(metadata: FanFictionMetadata | undefined) {
    super();
    this.state = { ...metadata };
    delete this.state.page;
    delete this.state.completed;
  }

  private select(id: SelectKey, title: string, options: Option[]): FormItemElement<unknown> {
    const current = this.state[id];
    return SelectRow(id, {
      title,
      layout: "flow",
      value: current ? [current] : [],
      items: options,
      minItemCount: 0,
      maxItemCount: 1,
      onValueChange: closureSelector(this, id, async (value: string[]) => {
        if (value[0]) {
          this.state[id] = value[0];
        } else {
          delete this.state[id];
        }
        this.reloadForm();
      }),
    });
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section(
        {
          id: "fandom",
          header: "Fandom",
          footer:
            "Browse one fandom by its site path, e.g. anime/Naruto or book/Harry-Potter. Leave it empty to search every story by keyword.",
        },
        [
          InputRow("fandom", {
            title: "Fandom path",
            value: this.state.fandom ?? "",
            onValueChange: closureSelector(this, "fandom", async (value: string) => {
              const path = value.trim().replace(/^\/+|\/+$/g, "");
              if (path) {
                this.state.fandom = path;
              } else {
                delete this.state.fandom;
              }
            }),
          }),
        ],
      ),
      Section({ id: "filters", header: "Filters" }, [
        this.select("rating", "Rating", RATINGS),
        this.select("language", "Language", LANGUAGES),
        this.select("status", "Status", STATUSES),
        this.select("length", "Length", LENGTHS),
        this.select("genre1", "Genre", GENRES),
        this.select("genre2", "Second genre", GENRES),
      ]),
      Section(
        {
          id: "listing",
          header: "Fandom browsing only",
          footer: "Keyword search ignores these two.",
        },
        [
          this.select("excludeGenre", "Exclude genre", GENRES),
          this.select("time", "Time range", TIME_RANGES),
        ],
      ),
      Section(
        { id: "keyword", header: "Keyword search only", footer: "Default: match anywhere." },
        [this.select("match", "Match", MATCHES)],
      ),
    ];
  }

  override getSearchQueryMetadata(): FanFictionMetadata {
    // An explicit undefined cannot cross the bridge, so omit empty keys.
    const metadata: FanFictionMetadata = {};
    for (const [key, value] of Object.entries(this.state)) {
      if (value) {
        (metadata as Record<string, unknown>)[key] = value;
      }
    }
    return metadata;
  }
}
