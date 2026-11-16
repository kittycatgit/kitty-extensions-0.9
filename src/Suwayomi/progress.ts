/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { ButtonRow, Form, LabelRow, Section, type FormSectionElement } from "@paperback/types";

export interface TitleState {
  inLibrary: boolean;
  chapters: number;
  downloaded: number;
  unread: number;
}

export interface ProgressActions {
  state: () => Promise<TitleState>;
  setLibrary: (inLibrary: boolean) => Promise<string>;
  download: () => Promise<string>;
  markRead: (read: boolean) => Promise<string>;
}

export class SuwayomiProgressForm extends Form {
  private readonly title: string;

  private readonly actions: ProgressActions;

  private state: TitleState;

  private status = "";

  constructor(title: string, state: TitleState, actions: ProgressActions) {
    super();
    this.title = title;
    this.state = state;
    this.actions = actions;
  }

  override getSections(): FormSectionElement<unknown>[] {
    const { inLibrary, chapters, downloaded, unread } = this.state;

    return [
      Section({ id: "title" }, [
        LabelRow("name", { title: this.title }),
        LabelRow("library", {
          title: "Server library",
          value: inLibrary ? "Added" : "Not added",
        }),
        LabelRow("downloaded", {
          title: "Downloaded on server",
          value: `${downloaded} of ${chapters}`,
        }),
        LabelRow("unread", { title: "Unread", value: String(unread) }),
      ]),
      Section(
        {
          id: "server",
          header: "On your Suwayomi server",
          footer:
            this.status ||
            "A library title is checked for new chapters by the server. Downloaded chapters open from the server's own copy, even when the site is down.",
        },
        [
          ButtonRow("library", {
            title: inLibrary ? "Remove from server library" : "Add to server library",
            onSelect: Application.Selector(this as SuwayomiProgressForm, "toggleLibrary"),
          }),
          ButtonRow("download", {
            title: "Download all chapters",
            onSelect: Application.Selector(this as SuwayomiProgressForm, "download"),
          }),
        ],
      ),
      Section({ id: "read", header: "Reading progress" }, [
        ButtonRow("read", {
          title: "Mark every chapter as read",
          onSelect: Application.Selector(this as SuwayomiProgressForm, "markRead"),
        }),
        ButtonRow("unread", {
          title: "Mark every chapter as unread",
          onSelect: Application.Selector(this as SuwayomiProgressForm, "markUnread"),
        }),
      ]),
    ];
  }

  async toggleLibrary(): Promise<void> {
    await this.run(() => this.actions.setLibrary(!this.state.inLibrary));
  }

  async download(): Promise<void> {
    await this.run(() => this.actions.download());
  }

  async markRead(): Promise<void> {
    await this.run(() => this.actions.markRead(true));
  }

  async markUnread(): Promise<void> {
    await this.run(() => this.actions.markRead(false));
  }

  private async run(action: () => Promise<string>): Promise<void> {
    this.status = "Telling Suwayomi…";
    this.reloadForm();

    try {
      this.status = await action();
      this.state = await this.actions.state();
    } catch (error: unknown) {
      this.status = error instanceof Error ? error.message : String(error);
    }

    this.reloadForm();
  }
}
