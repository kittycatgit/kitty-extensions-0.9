/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  ButtonRow,
  closureSelector,
  Form,
  LabelRow,
  Section,
  ToggleRow,
  TriStateSelectRow,
  type FormSectionElement,
  type Tag,
} from "@paperback/types";

import type { MadaraSearchMetadata } from "./models";

export class MadaraSearchForm extends AdvancedSearchForm {
  private genres?: Tag[] | Error;
  private selectedGenres: Record<string, "included" | "excluded">;

  constructor(metadata: MadaraSearchMetadata | undefined, genres: Promise<Tag[]>) {
    super();
    this.selectedGenres = metadata?.genres ?? {};

    genres
      .then((genres) => (this.genres = genres))
      .catch((error) => (this.genres = error instanceof Error ? error : new Error(String(error))))
      .finally(() => this.reloadForm());
  }

  override getSections(): FormSectionElement<unknown>[] {
    if (!this.genres) {
      return [Section("loading", [LabelRow("loading", { title: "Loading Filters" })])];
    }

    if (this.genres instanceof Error) {
      return [
        Section("error", [
          LabelRow("error", {
            title: "Error loading search filters",
            subtitle: this.genres.message,
          }),
        ]),
      ];
    }

    return [
      Section({ id: "genres" }, [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.selectedGenres,
          items: this.genres.map((tag) => ({ id: tag.id, title: tag.title })),
          allowExclusion: false,
          allowEmptySelection: true,
          onValueChange: closureSelector(this, "genres", async (value) => {
            this.selectedGenres = value;
            this.reloadForm();
          }),
        }),
      ]),
    ];
  }

  override getSearchQueryMetadata(): MadaraSearchMetadata {
    return { genres: this.selectedGenres };
  }

  override async formDidSubmit(): Promise<void> {
    if (!this.genres) {
      throw new Error("Search filters are loading");
    }

    if (this.genres instanceof Error) {
      throw this.genres;
    }
  }
}

// Util
function toBoolean(value: unknown): boolean | undefined {
  if (value === true || value === "true" || value === 1) return true;
  if (value === false || value === "false" || value === 0) return false;
  return undefined;
}

// Use postIds
export function getUsePostIds(sourcePreference?: boolean): boolean {
  // If the dev disabled postIds, don't let the user enable it
  if (sourcePreference === false) {
    return false;
  }

  return toBoolean(Application.getState("postIds")) ?? true;
}

export function setUsePostIds(value: boolean): void {
  Application.setState(value.toString(), "postIds");
}

// HQ Thumbnails
export function getUseHQThumbnails(): boolean {
  return toBoolean(Application.getState("hq_thumbnails")) ?? false;
}

export function setUseHQThumbnails(value: boolean): void {
  Application.setState(value.toString(), "hq_thumbnails");
}

// Parsed Directory Path
export function getParsedPath(domain: string): string {
  return Application.getState(`dirpath_${domain}`) as string;
}

export class MadaraSettings extends Form {
  name: string;
  domain: string;
  constructor(name: string, domain: string) {
    super();
    this.name = name;
    this.domain = domain;
  }

  override getSections() {
    return [
      Section(`${this.name} Settings`.replaceAll(" ", ""), [
        ToggleRow("postIds", {
          title: "Use Post IDs",
          value: getUsePostIds(),
          onValueChange: Application.Selector(this as MadaraSettings, "usePostIdsChange"),
          subtitle:
            "Enabling will make the source slower, but more reliable!\nCHANGING THIS OPTION WILL ERASE YOUR READING PROGRESS FOR THIS SOURCE!",
        }),

        ToggleRow("hqThumbnails", {
          title: "Enable HQ Thumbnails",
          value: getUseHQThumbnails(),
          onValueChange: Application.Selector(this as MadaraSettings, "useHQThumbnailsChange"),
          subtitle: "Enabling will make the sources use more bandwith",
        }),
      ]),
      Section("second", [
        ButtonRow("resetPath", {
          title: "Reset Stored Directory Path",
          onSelect: Application.Selector(this as MadaraSettings, "resetDirectoryPath"),
        }),
        LabelRow("resetStateLabel", {
          title: "",
          subtitle: `\nCurrent parsed path: "${getParsedPath(this.domain) ?? "overridden"}"\nClicking reset will reset the directory path.\nCan fix the homepage "request page not found" error!`,
        }),
      ]),
    ];
  }

  async usePostIdsChange(value: boolean): Promise<void> {
    setUsePostIds(value);
  }

  async useHQThumbnailsChange(value: boolean): Promise<void> {
    setUseHQThumbnails(value);
  }

  async resetDirectoryPath(): Promise<void> {
    Application.setState(`dirpath_${this.domain}`, this.domain);
  }
}
