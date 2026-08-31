/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { ButtonRow, Form, LabelRow, Section, type FormSectionElement } from "@paperback/types";

export interface ProgressActions {
  markRead: () => Promise<void>;
  markUnread: () => Promise<void>;
}

export class KavitaProgressForm extends Form {
  private readonly title: string;

  private readonly actions: ProgressActions;

  private status = "";

  constructor(title: string, actions: ProgressActions) {
    super();
    this.title = title;
    this.actions = actions;
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section({ id: "series" }, [LabelRow("name", { title: this.title })]),
      Section(
        {
          id: "actions",
          header: "On your Kavita server",
          footer: this.status || "Kavita's On Deck follows what it has been told is read.",
        },
        [
          ButtonRow("read", {
            title: "Mark whole series as read",
            onSelect: Application.Selector(this as KavitaProgressForm, "markRead"),
          }),
          ButtonRow("unread", {
            title: "Mark whole series as unread",
            onSelect: Application.Selector(this as KavitaProgressForm, "markUnread"),
          }),
        ],
      ),
    ];
  }

  async markRead(): Promise<void> {
    await this.run(this.actions.markRead, "Marked as read on Kavita.");
  }

  async markUnread(): Promise<void> {
    await this.run(this.actions.markUnread, "Marked as unread on Kavita.");
  }

  private async run(action: () => Promise<void>, done: string): Promise<void> {
    this.status = "Telling Kavita…";
    this.reloadForm();

    try {
      await action();
      this.status = done;
    } catch (error: unknown) {
      this.status = error instanceof Error ? error.message : String(error);
    }

    this.reloadForm();
  }
}
