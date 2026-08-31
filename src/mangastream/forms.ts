/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  ButtonRow,
  Form,
  LabelRow,
  Section,
  SelectRow,
  ToggleRow,
  closureSelector,
  type FormSectionElement,
  type TagSection,
} from "@paperback/types";

import type { MangaStreamFilters } from "./models";

function toBoolean(value: unknown): boolean {
  return (value ?? false) === "true";
}

export function getUsePostIds(): boolean {
  return toBoolean(Application.getState("postIds"));
}

export function setUsePostIds(value: boolean): void {
  Application.setState(value.toString(), "postIds");
}

export function clearTags(): void {
  Application.setState(undefined, "tags");
}

export class MangaStreamSettings extends Form {
  name: string;
  constructor(name: string) {
    super();
    this.name = name;
  }

  override getSections() {
    return [
      Section(`${this.name} Settings`.replaceAll(" ", ""), [
        ToggleRow("postIds", {
          title: "Use Post IDs",
          value: getUsePostIds(),
          onValueChange: Application.Selector(this as MangaStreamSettings, "usePostIdsChange"),
        }),
        LabelRow("label", {
          title: "",
          subtitle:
            "Enabling will make the source slower, but more reliable!\nCHANGING THIS OPTION WILL ERASE YOUR READING PROGRESS FOR THIS SOURCE!",
        }),
      ]),
      Section("second", [
        ButtonRow("clearTags", {
          title: "Clear Cached Search Tags",
          onSelect: Application.Selector(this as MangaStreamSettings, "tagsChange"),
        }),
        ButtonRow("resetState", {
          title: "Reset All State",
          onSelect: Application.Selector(this as MangaStreamSettings, "resetState"),
        }),
        LabelRow("resetStateLabel", {
          title: "",
          subtitle:
            "Clicking this will reset all state for this extension. Do not click unless you know what you are doing.",
        }),
      ]),
    ];
  }

  async usePostIdsChange(value: boolean): Promise<void> {
    setUsePostIds(value);
  }

  async tagsChange(): Promise<void> {
    clearTags();
  }

  async resetState(): Promise<void> {
    Application.resetAllState();
  }
}

export class MangaStreamSearchForm extends AdvancedSearchForm {
  private readonly sections: TagSection[];

  private genres: string[];

  private status: string[];

  private type: string[];

  private order: string[];

  constructor(filters: MangaStreamFilters | undefined, sections: TagSection[]) {
    super();
    this.sections = sections;
    this.genres = filters?.genres ?? [];
    this.status = filters?.status ? [filters.status] : [];
    this.type = filters?.type ? [filters.type] : [];
    this.order = filters?.order ? [filters.order] : [];
  }

  private itemsFor(title: string): { id: string; title: string }[] {
    const section = this.sections.find((candidate) => candidate.title === title);

    return (section?.tags ?? [])
      .map((tag) => ({ id: valueOf(tag.id), title: tag.title }))
      .filter((tag) => tag.id.length > 0 && tag.title.length > 0);
  }

  override getSections(): FormSectionElement<unknown>[] {
    const genres = this.itemsFor("genres");

    return [
      Section({ id: "genres", footer: "Genres narrow the listing together." }, [
        SelectRow("genres", {
          title: "Genres",
          layout: "list",
          value: this.genres,
          items: genres,
          minItemCount: 0,
          // Must be at least 1, even when the page listed no genres at all.
          maxItemCount: Math.max(genres.length, 1),
          onValueChange: closureSelector(this, "genres", async (value: string[]) => {
            this.genres = value;
            this.reloadForm();
          }),
        }),
      ]),
      Section({ id: "filters" }, [
        SelectRow("status", {
          title: "Status",
          layout: "list",
          value: this.status,
          items: this.itemsFor("status"),
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
          items: this.itemsFor("type"),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "type", async (value: string[]) => {
            this.type = value;
            this.reloadForm();
          }),
        }),
        SelectRow("order", {
          title: "Order by",
          layout: "list",
          value: this.order,
          items: this.itemsFor("order"),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: closureSelector(this, "order", async (value: string[]) => {
            this.order = value;
            this.reloadForm();
          }),
        }),
      ]),
    ];
  }

  override getSearchQueryMetadata(): MangaStreamFilters {
    const genres = this.genres.filter((genre) => genre.length > 0);

    return {
      ...(genres.length ? { genres } : {}),
      ...(this.status[0] ? { status: this.status[0] } : {}),
      ...(this.type[0] ? { type: this.type[0] } : {}),
      ...(this.order[0] ? { order: this.order[0] } : {}),
    };
  }
}

// The parser prefixes tag ids with their dropdown ("genres_4"); the listing wants "4".
export function valueOf(id: string): string {
  const separator = id.indexOf("_");
  return separator === -1 ? id : id.slice(separator + 1);
}
