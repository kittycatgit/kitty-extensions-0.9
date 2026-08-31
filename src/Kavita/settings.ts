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

import {
  API_KEY,
  MODE_API_KEY,
  MODE_KEY,
  MODE_PASSWORD,
  keepSession,
  normaliseServer,
  SHELVES_KEY,
  storedShelves,
  PASS_KEY,
  SERVER_KEY,
  storedApiKey,
  storedAuthMode,
  storedPassword,
  storedServer,
  storedUsername,
  USER_KEY,
  type KavitaCredentials,
  type KavitaLibrary,
} from "./models";

export interface SignInResult {
  user: string;
  libraries: KavitaLibrary[];
}

// The method is stored, never inferred: the two are not tried in turn, so a
// half-filled account cannot quietly sign in by key instead.
export class KavitaSettings extends Form {
  private server: string;

  private mode: string;

  private username: string;

  private password: string;

  private apiKey: string;

  private shelves: boolean;

  private status = "";

  private ok = false;

  private readonly check: (credentials: KavitaCredentials) => Promise<SignInResult>;

  constructor(check: (credentials: KavitaCredentials) => Promise<SignInResult>) {
    super();
    this.check = check;
    this.server = storedServer();
    this.mode = storedAuthMode();
    this.username = storedUsername();
    this.password = storedPassword();
    this.apiKey = storedApiKey();
    this.shelves = storedShelves();
  }

  override getSections(): FormSectionElement<unknown>[] {
    const byKey = this.mode === MODE_API_KEY;

    return [
      Section(
        {
          id: "server",
          header: "Your Kavita server",
          footer:
            "The address you open Kavita at, including the port if it has one - for example http://192.168.1.10:5001.",
        },
        [
          InputRow("server", {
            title: "Address",
            value: this.server,
            onValueChange: Application.Selector(this as KavitaSettings, "serverChanged"),
          }),
        ],
      ),
      Section(
        {
          id: "method",
          header: "How to sign in",
          footer: byKey
            ? "Kavita issues keys with an expiry, so this will need replacing when it lapses. Use the key named for OPDS - an image-only key cannot list your libraries. A key can be rotated on the server, which is worth preferring if you ever share app logs."
            : "Your Kavita account. It does not expire, and there is nothing to copy across by hand. Signing in this way sends your password once; after that this source renews its own session instead.",
        },
        [
          SelectRow("method", {
            title: "Method",
            value: [this.mode],
            minItemCount: 1,
            maxItemCount: 1,
            layout: "list",
            items: [
              { id: MODE_PASSWORD, title: "Username and password" },
              { id: MODE_API_KEY, title: "API key" },
            ],
            onValueChange: Application.Selector(this as KavitaSettings, "modeChanged"),
          }),
        ],
      ),
      byKey
        ? Section({ id: "key" }, [
            InputRow("apiKey", {
              title: "API key",
              value: this.apiKey,
              isSecureEntry: true,
              onValueChange: Application.Selector(this as KavitaSettings, "apiKeyChanged"),
            }),
          ])
        : Section({ id: "account" }, [
            InputRow("username", {
              title: "Username",
              value: this.username,
              onValueChange: Application.Selector(this as KavitaSettings, "usernameChanged"),
            }),
            InputRow("password", {
              title: "Password",
              value: this.password,
              isSecureEntry: true,
              onValueChange: Application.Selector(this as KavitaSettings, "passwordChanged"),
            }),
          ]),
      Section(
        {
          id: "home",
          header: "Home screen",
          footer:
            "Kavita's own home page shows three rows; the rest of its side nav is links you click. Showing them here means every one is fetched each time Home opens, which on a large library is what makes it slow to scroll.",
        },
        [
          ToggleRow("shelves", {
            title: "Also show side nav rows",
            subtitle: "All Series, Want To Read and one row per library",
            value: this.shelves,
            onValueChange: Application.Selector(this as KavitaSettings, "shelvesChanged"),
          }),
        ],
      ),
      Section({ id: "check", footer: this.status || undefined }, [
        ButtonRow("test", {
          title: "Test connection",
          onSelect: Application.Selector(this as KavitaSettings, "testConnection"),
        }),
        LabelRow("state", {
          title: this.ok ? "Connected" : "Not connected",
          ...(this.ok ? { style: "success" as const } : {}),
        }),
      ]),
      Section({ id: "clear" }, [
        ButtonRow("forget", {
          title: "Forget these details",
          onSelect: Application.Selector(this as KavitaSettings, "forget"),
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

  async modeChanged(value: string[]): Promise<void> {
    this.mode = value[0] === MODE_API_KEY ? MODE_API_KEY : MODE_PASSWORD;
    this.ok = false;
    this.status = "";
    keepSession(undefined);
    Application.setState(this.mode, MODE_KEY);
    this.reloadForm();
  }

  async shelvesChanged(value: boolean): Promise<void> {
    this.shelves = value;
    Application.setState(value, SHELVES_KEY);
  }

  async usernameChanged(value: string): Promise<void> {
    this.username = value;
    Application.setState(value, USER_KEY);
  }

  async passwordChanged(value: string): Promise<void> {
    this.password = value;
    Application.setSecureState(value, PASS_KEY);
  }

  async apiKeyChanged(value: string): Promise<void> {
    this.apiKey = value;
    Application.setSecureState(value, API_KEY);
  }

  private credentials(): KavitaCredentials | undefined {
    const server = normaliseServer(this.server);

    if (!server) {
      return undefined;
    }

    if (this.mode === MODE_API_KEY) {
      return this.apiKey.trim()
        ? { server, mode: MODE_API_KEY, apiKey: this.apiKey.trim() }
        : undefined;
    }

    return this.username.trim() && this.password
      ? { server, mode: MODE_PASSWORD, username: this.username.trim(), password: this.password }
      : undefined;
  }

  // A wrong address, a refused sign-in and an account that can see nothing all
  // look the same while browsing - an empty shelf.
  async testConnection(): Promise<void> {
    const credentials = this.credentials();

    if (!credentials) {
      this.ok = false;
      this.status =
        this.mode === MODE_API_KEY
          ? "Enter the address and your API key first."
          : "Enter the address, then your username and password.";
      this.reloadForm();
      return;
    }

    this.status = "Checking…";
    this.reloadForm();

    try {
      const { user, libraries } = await this.check(credentials);
      const names = libraries.map((library) => library.name).filter(Boolean);

      this.ok = true;
      this.status =
        names.length > 0
          ? `Signed in as ${user}. Libraries: ${names.join(", ")}.`
          : `Signed in as ${user}, but this account can see no libraries.`;
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
    this.apiKey = "";
    this.ok = false;
    this.status = "Details cleared.";
    Application.setState(undefined, SERVER_KEY);
    Application.setState(undefined, USER_KEY);
    Application.setSecureState(undefined, PASS_KEY);
    Application.setSecureState(undefined, API_KEY);
    keepSession(undefined);
    this.reloadForm();
  }
}
