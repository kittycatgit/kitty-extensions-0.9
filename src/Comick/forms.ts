/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 kittycatgit */

import {
  AdvancedSearchForm,
  ButtonRow,
  closureSelector,
  Form,
  InputRow,
  LabelRow,
  OAuthButtonRow,
  Section,
  SelectRow,
  StepperRow,
  TriStateSelectRow,
  type FormItemElement,
  type FormSectionElement,
} from "@paperback/types";

import {
  clearSession,
  currentSession,
  fetchUsername,
  library,
  revokeSession,
  saveSession,
  storedUsername,
  type LibraryResult,
} from "./auth";
import {
  ACCESS_LIFETIME_MS,
  AUTHORIZE_URL,
  CLIENT_ID,
  COLLECTIONS,
  COUNTRIES,
  DEFAULT_RATING,
  DEMOGRAPHICS,
  PUBLICATION,
  RATING_KEY,
  RATINGS,
  REDIRECT_URI,
  SCOPES,
  TOKEN_URL,
  USER_KEY,
  type ComickMetadata,
  type TriState,
} from "./models";
import type { LibraryRow } from "./parsers";

type Option = { id: string; title: string };

export function storedRating(): string {
  const stored = Application.getState(RATING_KEY);
  const ceiling =
    typeof stored === "string" && RATINGS.some((rating) => rating.id === stored)
      ? stored
      : DEFAULT_RATING;

  // The app's own adult filter wins over the source setting.
  return Application.filterAdultTitles && ceiling === "erotica" ? "suggestive" : ceiling;
}

export class ComickSettingsForm extends Form {
  private status = "";

  override getSections(): FormSectionElement<unknown>[] {
    const session = currentSession();
    const user = storedUsername();

    return [
      Section(
        {
          id: "account",
          header: "Comick account",
          footer:
            this.status ||
            (session
              ? "Your library lists appear as collections, and chapters read in Paperback are sent back as progress."
              : "Sign in to see your Comick lists in the Library and to sync reading progress and ratings."),
        },
        session
          ? [
              LabelRow("user", {
                title: "Signed in as",
                value: user ?? "Comick user",
              }),
              ButtonRow("logout", {
                title: "Log out",
                onSelect: Application.Selector(this as ComickSettingsForm, "logOut"),
              }),
            ]
          : [
              OAuthButtonRow("login", {
                title: "Log in with Comick",
                subtitle: "Opens comick.dev to approve Paperback.",
                onSuccess: Application.Selector(this as ComickSettingsForm, "loginSucceeded"),
                authorizeEndpoint: AUTHORIZE_URL,
                responseType: {
                  type: "pkce",
                  tokenEndpoint: TOKEN_URL,
                  pkceCodeLength: 64,
                  pkceCodeMethod: "S256",
                  formEncodeGrant: true,
                },
                clientId: CLIENT_ID,
                redirectUri: REDIRECT_URI,
                scopes: SCOPES,
              }),
            ],
      ),
      Section(
        {
          id: "content",
          header: "Content",
          footer: "Browse and search results include everything up to the chosen rating.",
        },
        [
          SelectRow("rating", {
            title: "Content rating up to",
            layout: "list",
            value: [storedRating()],
            items: RATINGS,
            minItemCount: 1,
            maxItemCount: 1,
            onValueChange: Application.Selector(this as ComickSettingsForm, "ratingChanged"),
          }),
        ],
      ),
      Section({ id: "about" }, [
        LabelRow("about", {
          title: "Comick is a tracker",
          subtitle:
            "comick.dev hosts no chapters. Use it to follow titles, keep lists and sync progress; read from another source.",
        }),
      ]),
    ];
  }

  // The app hands the two tokens over positionally; the access token is the
  // one /me accepts, so both orders are checked once rather than guessed.
  async loginSucceeded(first: string, second: string): Promise<void> {
    const candidates = [
      { accessToken: second, refreshToken: first },
      { accessToken: first, refreshToken: second },
    ].filter((pair) => pair.accessToken);
    let username: string | undefined;
    let lastError: unknown;

    for (const pair of candidates) {
      const session = { ...pair, expiresAt: Date.now() + ACCESS_LIFETIME_MS };

      try {
        username = await fetchUsername(session);
        saveSession(session);
        break;
      } catch (error: unknown) {
        lastError = error;
      }
    }

    if (!username) {
      this.status = `Login failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`;
      this.reloadForm();
      return;
    }

    Application.setState(username, USER_KEY);
    this.status = "";
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async logOut(): Promise<void> {
    const session = currentSession();

    if (session) {
      try {
        await revokeSession(session);
      } catch (error: unknown) {
        // The tokens are dropped either way; Comick expires them on its own.
        this.status = `Signed out locally; Comick could not be told: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    clearSession();
    this.reloadForm();
  }

  async ratingChanged(value: string[]): Promise<void> {
    Application.setState(value[0] ?? DEFAULT_RATING, RATING_KEY);
    Application.invalidateDiscoverSections();
  }
}

export class ComickSearchForm extends AdvancedSearchForm {
  private readonly genres: Option[];

  private readonly themes: Option[];

  private state: ComickMetadata;

  constructor(metadata: ComickMetadata | undefined, genres: Option[], themes: Option[]) {
    super();
    this.genres = genres;
    this.themes = themes;
    this.state = { rating: storedRating(), ...metadata };
  }

  private multi(
    id: string,
    title: string,
    options: Option[],
    key: "demographics" | "countries" | "statuses",
  ): FormItemElement<unknown> {
    return SelectRow(id, {
      title,
      layout: "flow",
      value: this.state[key] ?? [],
      items: options,
      minItemCount: 0,
      maxItemCount: options.length,
      onValueChange: closureSelector(this, id, async (value: string[]) => {
        this.state[key] = value;
        this.reloadForm();
      }),
    });
  }

  private tri(id: string, title: string, options: Option[]): FormItemElement<unknown> {
    const own = new Set(options.map((option) => option.id));
    const value = Object.fromEntries(
      Object.entries(this.state.genres ?? {}).filter(([slug]) => own.has(slug)),
    ) as TriState;

    return TriStateSelectRow(id, {
      title,
      layout: "flow",
      value,
      items: options,
      allowExclusion: true,
      allowEmptySelection: true,
      onValueChange: closureSelector(this, id, async (changed: TriState) => {
        const kept = Object.fromEntries(
          Object.entries(this.state.genres ?? {}).filter(([slug]) => !own.has(slug)),
        ) as TriState;
        this.state.genres = { ...kept, ...changed };
        this.reloadForm();
      }),
    });
  }

  private input(
    id: string,
    title: string,
    key: "from" | "to" | "minimum",
  ): FormItemElement<unknown> {
    return InputRow(id, {
      title,
      value: this.state[key] ?? "",
      onValueChange: closureSelector(this, id, async (value: string) => {
        this.state[key] = value.trim();
      }),
    });
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section({ id: "catalog", header: "Catalog" }, [
        this.multi("countries", "Origin", COUNTRIES, "countries"),
        this.multi("demographics", "Demographic", DEMOGRAPHICS, "demographics"),
        this.multi("statuses", "Publication", PUBLICATION, "statuses"),
      ]),
      Section(
        {
          id: "rating",
          header: "Content rating",
          footer: "Results include everything up to the chosen rating.",
        },
        [
          SelectRow("rating", {
            title: "Up to",
            layout: "flow",
            value: [this.state.rating ?? storedRating()],
            items: Application.filterAdultTitles ? RATINGS.slice(0, 2) : RATINGS,
            minItemCount: 1,
            maxItemCount: 1,
            onValueChange: closureSelector(this, "rating", async (value: string[]) => {
              this.state.rating = value[0];
              this.reloadForm();
            }),
          }),
        ],
      ),
      Section(
        {
          id: "genres",
          header: "Genres and themes",
          footer: "Tap once to include, twice to exclude.",
        },
        [this.tri("genres", "Genres", this.genres), this.tri("themes", "Themes", this.themes)],
      ),
      Section({ id: "details", header: "Details" }, [
        this.input("from", "Year from", "from"),
        this.input("to", "Year to", "to"),
        this.input("minimum", "Minimum chapters", "minimum"),
      ]),
    ];
  }

  override getSearchQueryMetadata(): ComickMetadata {
    // An explicit undefined cannot cross the bridge, so omit empty keys.
    const metadata: ComickMetadata = {};

    for (const key of ["demographics", "countries", "statuses"] as const) {
      const value = this.state[key];

      if (value && value.length > 0) {
        metadata[key] = value;
      }
    }

    if (this.state.genres && Object.keys(this.state.genres).length > 0) {
      metadata.genres = this.state.genres;
    }

    for (const key of ["rating", "from", "to", "minimum"] as const) {
      const value = this.state[key];

      if (value) {
        metadata[key] = value;
      }
    }

    return metadata;
  }
}

type Entry = { data?: LibraryRow };

// Edits the user's follow entry; the whole form is one PUT or PATCH on Done.
export class ComickProgressForm extends Form {
  private readonly hid: string;

  private readonly title: string;

  private row: LibraryRow | undefined;

  private loaded = false;

  private error = "";

  private status: string;

  private chapter = "";

  private rating = 0;

  override requiresExplicitSubmission = true;

  constructor(hid: string, title: string) {
    super();
    this.hid = hid;
    this.title = title;
    this.status = COLLECTIONS[0]!.id;
  }

  override formWillAppear(): void {
    void library<Entry>(`/me/library/${encodeURIComponent(this.hid)}`, "GET", undefined, [200, 404])
      .then((result: LibraryResult<Entry>) => {
        this.row = result.status === 200 ? result.body?.data : undefined;

        if (this.row) {
          this.status = String(this.row.status ?? this.status);
          this.chapter = this.row.progress?.number ?? "";
          this.rating = this.row.rating ?? 0;
        }
      })
      .catch((error: unknown) => {
        this.error = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        this.loaded = true;
        this.reloadForm();
      });
  }

  override getSections(): FormSectionElement<unknown>[] {
    if (!this.loaded) {
      return [Section("loading", [LabelRow("loading", { title: "Loading…" })])];
    }

    if (this.error) {
      return [Section("error", [LabelRow("error", { title: "Error", subtitle: this.error })])];
    }

    const when = (value: string | null | undefined): string | undefined => {
      const date = value ? new Date(value) : undefined;

      return date && !isNaN(date.getTime()) ? date.toLocaleDateString("en-US") : undefined;
    };

    return [
      Section(
        {
          id: "entry",
          footer: this.row
            ? [
                when(this.row.followed_at) ? `Followed ${when(this.row.followed_at)}.` : "",
                when(this.row.progressed_at) ? `Last read ${when(this.row.progressed_at)}.` : "",
              ]
                .filter(Boolean)
                .join(" ")
            : "Not in your Comick library yet. Done adds it with the status below.",
        },
        [LabelRow("title", { title: this.title })],
      ),
      Section({ id: "progress", header: "Progress" }, [
        SelectRow("status", {
          title: "Status",
          layout: "list",
          value: [this.status],
          items: COLLECTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(this as ComickProgressForm, "statusChanged"),
        }),
        InputRow("chapter", {
          title: "Last read chapter",
          value: this.chapter,
          onValueChange: Application.Selector(this as ComickProgressForm, "chapterChanged"),
        }),
        StepperRow("rating", {
          title: "Rating",
          subtitle: this.rating > 0 ? `${this.rating} / 10` : "Unrated",
          value: this.rating,
          minValue: 0,
          maxValue: 10,
          stepValue: 1,
          loopOver: false,
          onValueChange: Application.Selector(this as ComickProgressForm, "ratingChanged"),
        }),
      ]),
      ...(this.row
        ? [
            Section(
              {
                id: "remove",
                footer: "Removes the follow and its rating and notes on Comick.",
              },
              [
                ButtonRow("remove", {
                  title: "Remove from Comick library",
                  onSelect: Application.Selector(this as ComickProgressForm, "remove"),
                }),
              ],
            ),
          ]
        : []),
    ];
  }

  async statusChanged(value: string[]): Promise<void> {
    this.status = value[0] ?? this.status;
  }

  async chapterChanged(value: string): Promise<void> {
    this.chapter = value.trim();
  }

  async ratingChanged(value: number): Promise<void> {
    this.rating = Math.round(value);
    this.reloadForm();
  }

  override async formDidSubmit(): Promise<void> {
    if (this.chapter && !/^\d+(\.\d+)?$/.test(this.chapter)) {
      throw new Error("The chapter must be a number such as 12 or 12.5.");
    }

    const body: Record<string, unknown> = {
      status: Number(this.status),
      rating: this.rating > 0 ? this.rating : null,
    };

    if (this.chapter) {
      body["progress"] = { number: this.chapter };
    } else if (this.row?.progress) {
      body["progress"] = null;
    }

    await library(`/me/library/${encodeURIComponent(this.hid)}`, this.row ? "PATCH" : "PUT", body);
  }

  async remove(): Promise<void> {
    await library(`/me/library/${encodeURIComponent(this.hid)}`, "DELETE", undefined, [204]);
    this.row = undefined;
    this.chapter = "";
    this.rating = 0;
    this.reloadForm();
  }
}
