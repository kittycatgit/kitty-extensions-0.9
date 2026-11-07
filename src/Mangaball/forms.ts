/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  closureSelector,
  Form,
  LabelRow,
  Section,
  SelectRow,
  ToggleRow,
  TriStateSelectRow,
  type FormItemElement,
  type FormSectionElement,
} from "@paperback/types";

import {
  ADULT_MODES,
  DEMOGRAPHICS,
  STATUSES,
  TYPES,
  type MangaballMetadata,
  type Option,
  type TagGroup,
  type TriState,
} from "./models";
import {
  getAdultMode,
  getLanguageSetting,
  LANGUAGE_OPTIONS,
  setAdultMode,
  setLanguageSetting,
} from "./settings";

export class MangaballSearchForm extends AdvancedSearchForm {
  private readonly tagGroups: TagGroup[] | undefined;

  private state: MangaballMetadata;

  constructor(metadata: MangaballMetadata | undefined, tagGroups: TagGroup[] | undefined) {
    super();
    this.tagGroups = tagGroups;
    this.state = { adultMode: getAdultMode(), ...metadata };
  }

  private single(
    id: string,
    title: string,
    options: Option[],
    key: "status" | "type" | "demographic" | "adultMode",
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
    const groups = this.tagGroups;
    const selected = this.state.tags ?? {};

    const tagRows: FormItemElement<unknown>[] = groups
      ? groups.map((group) => {
          const ids = new Set(group.tags.map((tag) => tag.id));
          const value: TriState = {};
          for (const [id, state] of Object.entries(selected)) {
            if (ids.has(id)) value[id] = state;
          }
          return TriStateSelectRow(`tags_${group.id}`, {
            title: group.title,
            layout: "flow",
            value,
            items: group.tags,
            allowExclusion: true,
            allowEmptySelection: true,
            onValueChange: closureSelector(this, `tags_${group.id}`, async (next: TriState) => {
              const merged: TriState = {};
              for (const [id, state] of Object.entries(this.state.tags ?? {})) {
                if (!ids.has(id)) merged[id] = state;
              }
              Object.assign(merged, next);
              this.state.tags = merged;
              this.reloadForm();
            }),
          });
        })
      : [LabelRow("tags_unavailable", { title: "Tags could not be loaded" })];

    return [
      Section(
        {
          id: "tags",
          header: "Tags",
          footer: groups
            ? "Tap once to include, twice to exclude."
            : "The tag list could not be loaded. Every other filter still works.",
        },
        [
          ...tagRows,
          ToggleRow("anyTag", {
            title: "Match any included tag",
            subtitle: "Off: a title needs every included tag.",
            value: this.state.anyTag ?? false,
            onValueChange: closureSelector(this, "anyTag", async (value: boolean) => {
              this.state.anyTag = value;
            }),
          }),
        ],
      ),
      Section({ id: "catalog", header: "Catalog" }, [
        this.single("status", "Status", STATUSES, "status"),
        this.single("type", "Publication type", TYPES, "type"),
        this.single("demographic", "Demographic", DEMOGRAPHICS, "demographic"),
        this.single("adultMode", "Content rating", ADULT_MODES, "adultMode"),
      ]),
    ];
  }

  override getSearchQueryMetadata(): MangaballMetadata {
    // An explicit undefined cannot cross the bridge, so omit empty keys.
    const metadata: MangaballMetadata = {};

    if (this.state.tags && Object.keys(this.state.tags).length > 0) {
      metadata.tags = this.state.tags;
    }
    for (const key of ["status", "type", "demographic", "adultMode"] as const) {
      const value = this.state[key];
      if (value) metadata[key] = value;
    }
    if (this.state.anyTag) metadata.anyTag = true;

    return metadata;
  }
}

export class MangaballSettingsForm extends Form {
  private languageSetting = getLanguageSetting();

  private adultMode = getAdultMode();

  async updateLanguage(value: string[]): Promise<void> {
    if (!value || value.length === 0) {
      this.languageSetting = ["all"];
    } else if (value.includes("all") && !this.languageSetting.includes("all")) {
      // "all" just picked → clear the specific languages
      this.languageSetting = ["all"];
    } else if (value.length > 1 && value.includes("all")) {
      // a specific language picked while "all" was active → drop "all"
      this.languageSetting = value.filter((v) => v !== "all");
    } else {
      this.languageSetting = value;
    }
    setLanguageSetting(this.languageSetting);
    this.reloadForm();
  }

  async updateAdultMode(value: string[]): Promise<void> {
    this.adultMode = value[0] ?? "all";
    setAdultMode(this.adultMode);
    this.reloadForm();
  }

  override getSections(): FormSectionElement<unknown>[] {
    const multiple = this.languageSetting.includes("all") || this.languageSetting.length !== 1;
    return [
      Section(
        {
          id: "mangaballContent",
          header: "Content",
          footer: "Applies to the home page rails and is the default for searches.",
        },
        [
          SelectRow("adultMode", {
            title: "Content rating",
            layout: "list",
            value: [this.adultMode],
            items: ADULT_MODES,
            minItemCount: 1,
            maxItemCount: 1,
            onValueChange: Application.Selector(this as MangaballSettingsForm, "updateAdultMode"),
          }),
        ],
      ),
      Section("mangaballLanguage", [
        LabelRow("languageLabel", {
          title: "Chapter Language",
          subtitle: "Only show chapters in the selected language(s).",
        }),
        SelectRow("languageFilter", {
          title: multiple ? "Languages" : "Language",
          layout: "list",
          value: this.languageSetting,
          items: LANGUAGE_OPTIONS.map((option) => ({
            id: option.id,
            title: option.label,
          })),
          onValueChange: Application.Selector(this as MangaballSettingsForm, "updateLanguage"),
          minItemCount: 1,
          maxItemCount: LANGUAGE_OPTIONS.length,
        }),
      ]),
    ];
  }
}
