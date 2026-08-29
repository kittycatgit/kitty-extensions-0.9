/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import { ButtonRow, Form, LabelRow, Section, type FormSectionElement } from "@paperback/types";

/** What the server can be told about a whole series at once. */
export interface ProgressActions {
  markRead: () => Promise<void>;
  markUnread: () => Promise<void>;
}

/**
 * Where a reader sets a whole series read or unread on their own server.
 *
 * Paperback keeps its own record of what has been read and sends chapters over
 * as they are finished. This form is the coarser instrument beside that: it
 * tells Kavita about the series as a whole, which is what fixes a shelf that
 * has drifted out of step rather than waiting for it to catch up chapter by
 * chapter.
 */
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

  /** Runs one of them and says what happened, rather than failing silently. */
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
