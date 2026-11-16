/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  ButtonRow,
  Form,
  InputRow,
  LabelRow,
  Section,
  SelectRow,
  ToggleRow,
  type FormSectionElement,
} from "@paperback/types";

import { forgetSession } from "./auth";
import {
  KEEP_KEY,
  LANGUAGES_KEY,
  languageLabel,
  PASS_KEY,
  SERVER_KEY,
  storedKeep,
  storedLanguages,
  storedPassword,
  storedServer,
  storedUsername,
  USER_KEY,
} from "./models";

export interface SettingsActions {
  // Signs in with what is typed and says what the account can see.
  check: () => Promise<{ summary: string; languages: string[] }>;
  setKeep: (keep: boolean) => Promise<void>;
}

export class SuwayomiSettings extends Form {
  private server = storedServer();

  private username = storedUsername();

  private password = storedPassword();

  private picked = storedLanguages();

  private keep = storedKeep();

  private languages: string[];

  private status = "";

  private ok = false;

  private readonly actions: SettingsActions;

  constructor(languages: string[], actions: SettingsActions) {
    super();
    this.languages = languages;
    this.actions = actions;
  }

  override getSections(): FormSectionElement<unknown>[] {
    // A stored language stays listed even when no site offers it right now.
    const offered = [...new Set([...this.languages, ...this.picked])].sort();

    return [
      Section(
        {
          id: "server",
          header: "Your Suwayomi server",
          footer:
            "The address you open Suwayomi at, including the port if it has one - for example https://suwayomi.example.com.",
        },
        [
          InputRow("server", {
            title: "Address",
            value: this.server,
            onValueChange: Application.Selector(this as SuwayomiSettings, "serverChanged"),
          }),
        ],
      ),
      Section(
        {
          id: "account",
          header: "Your account",
          footer:
            "Your own account on that server, with its own library and read marks. Signing in sends your password once; after that this source renews its own session.",
        },
        [
          InputRow("username", {
            title: "Username",
            value: this.username,
            onValueChange: Application.Selector(this as SuwayomiSettings, "usernameChanged"),
          }),
          InputRow("password", {
            title: "Password",
            value: this.password,
            isSecureEntry: true,
            onValueChange: Application.Selector(this as SuwayomiSettings, "passwordChanged"),
          }),
        ],
      ),
      Section({ id: "check", footer: this.status || undefined }, [
        ButtonRow("test", {
          title: "Test connection",
          onSelect: Application.Selector(this as SuwayomiSettings, "testConnection"),
        }),
        LabelRow("state", {
          title: this.ok ? "Connected" : "Not connected",
          ...(this.ok ? { style: "success" as const } : {}),
        }),
      ]),
      Section(
        {
          id: "sites",
          header: "Sites",
          footer:
            "Which languages of the sites installed on the server show up on Home and in search.",
        },
        [
          SelectRow("languages", {
            title: "Languages",
            layout: "flow",
            value: this.picked,
            items: offered.map((lang) => ({ id: lang, title: languageLabel(lang) })),
            minItemCount: 1,
            maxItemCount: Math.max(offered.length, 1),
            onValueChange: Application.Selector(this as SuwayomiSettings, "languagesChanged"),
          }),
        ],
      ),
      Section(
        {
          id: "downloads",
          header: "Downloads",
          footer:
            "Chapters open live from the site unless the server holds a copy. With this on, adding a title to the server library downloads it there and the server keeps fetching its new chapters.",
        },
        [
          ToggleRow("keep", {
            title: "Keep library titles downloaded",
            value: this.keep,
            onValueChange: Application.Selector(this as SuwayomiSettings, "keepChanged"),
          }),
        ],
      ),
      Section({ id: "clear" }, [
        ButtonRow("forget", {
          title: "Forget these details",
          onSelect: Application.Selector(this as SuwayomiSettings, "forget"),
        }),
      ]),
    ];
  }

  // Stored as typed and tidied at use, so the field is not rewritten under
  // someone mid-way through typing an address.
  async serverChanged(value: string): Promise<void> {
    this.server = value;
    Application.setState(value, SERVER_KEY);
  }

  async usernameChanged(value: string): Promise<void> {
    this.username = value;
    Application.setState(value, USER_KEY);
  }

  async passwordChanged(value: string): Promise<void> {
    this.password = value;
    Application.setSecureState(value, PASS_KEY);
  }

  async languagesChanged(value: string[]): Promise<void> {
    this.picked = value;
    Application.setState(value, LANGUAGES_KEY);
  }

  async keepChanged(value: boolean): Promise<void> {
    this.keep = value;
    Application.setState(value, KEEP_KEY);

    try {
      await this.actions.setKeep(value);
      this.status = "";
    } catch (error: unknown) {
      this.status = `The server was not told about downloads: ${error instanceof Error ? error.message : String(error)}`;
    }

    this.reloadForm();
  }

  // A wrong address, a refused sign-in and an account that can see nothing all
  // look the same while browsing - an empty shelf.
  async testConnection(): Promise<void> {
    if (!this.server.trim() || !this.username.trim() || !this.password) {
      this.ok = false;
      this.status = "Enter the address, then your username and password.";
      this.reloadForm();
      return;
    }

    this.status = "Checking…";
    this.reloadForm();

    try {
      const { summary, languages } = await this.actions.check();

      this.ok = true;
      this.status = summary;
      this.languages = languages;
    } catch (error: unknown) {
      this.ok = false;
      this.status = error instanceof Error ? error.message : String(error);
    }

    this.reloadForm();
  }

  async forget(): Promise<void> {
    this.server = "";
    this.username = "";
    this.password = "";
    this.ok = false;
    this.status = "Details cleared.";
    Application.setState(undefined, SERVER_KEY);
    Application.setState(undefined, USER_KEY);
    Application.setSecureState(undefined, PASS_KEY);
    forgetSession();
    this.reloadForm();
  }
}
