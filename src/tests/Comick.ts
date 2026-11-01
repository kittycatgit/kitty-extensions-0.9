/* eslint-disable @typescript-eslint/no-unused-expressions */
import {
  CloudflareError,
  DiscoverSectionType,
  type DiscoverSectionItem,
  type SourceManga,
  type TestLogger,
} from "@paperback/types";
import { expect } from "chai";

import { sessionFrom } from "../Comick/auth.js";
import { pkceChallenge, randomToken } from "../Comick/crypto.js";
import { Comick } from "../Comick/main.js";
import { parseLibraryRow, plainText } from "../Comick/parsers.js";
import sourceInfo from "../Comick/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const ID = /^[A-Za-z0-9._\-@()[\]%?#+=/&:]+$/;
const SOLO = "71gMd0vF";

// Cloudflare challenges the comic, chapter and latest routes for anything
// that is not a browser; the app solves that with its bypass webview, the
// harness cannot. Those assertions run whenever the network lets them through
// and say so plainly when it does not, instead of failing every run.
let challenged = false;

async function throughCloudflare(logger: TestLogger, work: () => Promise<void>): Promise<void> {
  if (challenged) {
    logger.log("skipped", "Cloudflare challenged this network earlier in the run");
    return;
  }

  try {
    await work();
  } catch (error: unknown) {
    if (error instanceof CloudflareError) {
      challenged = true;
      logger.log("skipped", "Cloudflare challenge from this network; verify on device");
      return;
    }

    throw error;
  }
}

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Comick tests", logger);
  registerDefaultTests(suite, Comick, sourceInfo, {
    mangaProviding: false,
    searchResultsProviding: {
      getSearchResults: [{ title: "solo leveling" }, undefined, undefined],
    },
  });

  suite.test("title search finds Solo Leveling", async () => {
    const results = await Comick.getSearchResults({ title: "solo leveling" }, undefined, undefined);
    expect(results.items.length).to.be.greaterThan(0);
    const hit = results.items.find((item) => item.mangaId === SOLO);
    expect(hit, "Solo Leveling by hid").to.exist;
    expect(hit!.title).to.equal("Solo Leveling");
    expect(hit!.imageUrl).to.match(/^https:\/\/meo\.comick\.pictures\//);
    expect(hit!.subtitle).to.contain("Ch.");
    for (const item of results.items) {
      expect(item.mangaId).to.match(ID);
      expect(item.imageUrl).to.not.be.empty;
    }
  });

  suite.test("details carry cover, synopsis, people and genres", async () => {
    await throughCloudflare(logger, async () => {
      const manga: SourceManga = await Comick.getMangaDetails(SOLO);
      const info = manga.mangaInfo;
      expect(manga.mangaId).to.equal(SOLO);
      expect(info.primaryTitle).to.equal("Solo Leveling");
      expect(info.thumbnailUrl).to.equal("https://meo.comick.pictures/0GRgd.jpg");
      expect(info.synopsis).to.contain("Jinwoo");
      expect(info.synopsis).to.not.contain("](");
      expect(info.status).to.equal("Completed");
      expect(info.artist).to.contain("REDICE");
      expect(info.author).to.be.a("string").and.not.empty;
      expect(info.secondaryTitles).to.include("나 혼자만 레벨업");
      expect(info.rating).to.be.within(0.8, 1);
      expect(info.shareUrl).to.equal("https://comick.dev/comic/00-solo-leveling");
      const groups = info.tagGroups ?? [];
      const genres = groups.find((group) => group.id === "genres")!.tags.map((tag) => tag.title);
      expect(genres).to.include.members(["Action", "Fantasy"]);
      expect(groups.map((group) => group.id)).to.include.members(["themes", "demographic"]);
      for (const tag of groups.flatMap((group) => group.tags)) {
        expect(tag.id).to.match(ID);
      }
      expect(info.additionalInfo?.["Year"]).to.equal("2018");
    });
  });

  suite.test("filters narrow the listing", async () => {
    const query = {
      title: "",
      metadata: {
        countries: ["kr"],
        demographics: ["2"],
        statuses: ["2"],
        genres: { isekai: "included" as const, action: "excluded" as const },
        rating: "safe",
      },
    };
    const results = await Comick.getSearchResults(query, undefined, { id: "follow", label: "" });
    expect(results.items.length).to.be.greaterThan(3);
    for (const item of results.items) {
      expect(item.contentRating).to.equal("SAFE");
    }
    // The list rows only carry ids; the detail route proves the filter took.
    await throughCloudflare(logger, async () => {
      for (const item of results.items.slice(0, 4)) {
        const info = (await Comick.getMangaDetails(item.mangaId)).mangaInfo;
        expect(info.status, item.title).to.equal("Completed");
        const titles = (info.tagGroups ?? []).flatMap((group) =>
          group.tags.map((tag) => tag.title),
        );
        expect(titles, item.title).to.include("Isekai");
        expect(titles, item.title).to.not.include("Action");
        expect(titles, item.title).to.include("Shoujo");
        expect(titles, item.title).to.include("KR");
      }
    });
  });

  suite.test("sorting options and rating ceiling apply", async () => {
    const sorts = await Comick.getSortingOptions();
    expect(sorts.map((sort) => sort.id)).to.include.members(["follow", "rating", "created_at"]);
    const rated = await Comick.getSearchResults(
      { title: "", metadata: { rating: "erotica" } },
      undefined,
      { id: "rating", label: "" },
    );
    expect(
      rated.items.some((item) => item.contentRating === "ADULT"),
      "erotica allowed",
    ).to.be.true;
    const safe = await Comick.getSearchResults(
      { title: "", metadata: { rating: "safe" } },
      undefined,
      {
        id: "rating",
        label: "",
      },
    );
    expect(safe.items.length).to.be.greaterThan(10);
    expect(
      safe.items.every((item) => item.contentRating === "SAFE"),
      "safe only",
    ).to.be.true;
  });

  suite.test("search pages continue without repeating", async () => {
    const first = await Comick.getSearchResults({ title: "" }, undefined, undefined);
    const second = await Comick.getSearchResults(
      { title: "" },
      first.metadata as Record<string, unknown>,
      undefined,
    );
    expect(first.items.length).to.equal(50);
    expect(second.items.length).to.be.greaterThan(0);
    const firstIds = new Set(first.items.map((item) => item.mangaId));
    expect(second.items.filter((item) => firstIds.has(item.mangaId))).to.be.empty;
  });

  suite.test("advanced form loads genres and themes", async () => {
    const form = await Comick.getAdvancedSearchForm({ title: "" });
    const sections = form.getSections();
    expect(sections.map((section) => section.id)).to.deep.equal([
      "catalog",
      "rating",
      "genres",
      "details",
    ]);
    const genreRows = sections[2]!.items as unknown as {
      id: string;
      form: { params: { items: { id: string; title: string }[] } };
    }[];
    const genres = genreRows[0]!.form.params.items;
    const themes = genreRows[1]!.form.params.items;
    expect(genres.length).to.be.greaterThan(15);
    expect(genres.map((genre) => genre.title)).to.include.members(["Action", "Isekai", "Romance"]);
    expect(themes.map((theme) => theme.title)).to.include.members(["Magic", "Full Color"]);
    for (const option of [...genres, ...themes]) {
      expect(option.id).to.match(ID);
    }
    expect(form.getSearchQueryMetadata()).to.deep.equal({ rating: "suggestive" });
  });

  suite.test("every discover row yields items", async () => {
    const sections = await Comick.getDiscoverSections();
    expect(sections.length).to.equal(8);
    for (const section of sections) {
      const check = async (): Promise<void> => {
        const results = await Comick.getDiscoverSectionItems(section, undefined);
        expect(results.items.length, section.id).to.be.greaterThan(8);
        for (const item of results.items) {
          if (item.type === "genresCarouselItem") {
            expect(item.name).to.not.be.empty;
            continue;
          }
          expect(item.mangaId, section.id).to.match(ID);
          expect(item.imageUrl, section.id).to.not.be.empty;
          expect(item.title, section.id).to.not.be.empty;
          expect(item.contentRating, section.id).to.not.equal("ADULT");
        }
        if (section.type === DiscoverSectionType.chapterUpdates) {
          const first = results.items[0] as Extract<
            DiscoverSectionItem,
            { type: "chapterUpdatesCarouselItem" }
          >;
          expect(first.chapterId).to.match(ID);
          expect(first.subtitle).to.match(/^Ch\. /);
          expect(first.publishDate).to.be.instanceOf(Date);
        }
      };

      if (section.id === "latest") {
        await throughCloudflare(logger, check);
      } else {
        await check();
      }
    }
  });

  suite.test("paged rows continue without repeating", async () => {
    const sections = await Comick.getDiscoverSections();
    const ids = (items: DiscoverSectionItem[]) =>
      items.map((item) => ("mangaId" in item ? item.mangaId : ""));
    const check = async (id: string): Promise<void> => {
      const section = sections.find((entry) => entry.id === id)!;
      const first = await Comick.getDiscoverSectionItems(section, undefined);
      const second = await Comick.getDiscoverSectionItems(
        section,
        first.metadata as Record<string, unknown>,
      );
      expect(second.items.length, id).to.be.greaterThan(0);
      const overlap = ids(second.items).filter((mangaId) => ids(first.items).includes(mangaId));
      expect(overlap, id).to.be.empty;
    };

    await check("followed");
    await check("trending");
    await throughCloudflare(logger, () => check("latest"));
  });

  suite.test("library rows map to source manga", async () => {
    const manga = parseLibraryRow({
      hid: "aB7kP2xQ",
      title: "Example Manga",
      slug: "example-manga",
      media_type: "manga",
      status: 1,
      rating: 8,
      publication_status: 1,
      bayesian_rating: 8.25,
      cover_url: "https://meo.comick.pictures/example-cover-s.jpg",
      last_released_number: "3",
      titles: [
        { title: "Example Manga", lang: "en", is_default: true },
        { title: "例のマンガ", lang: "ja", is_default: false },
      ],
      url: "https://comick.dev/comic/example-manga",
      progress: { number: "3", volume: null, hid: "rT4mN8vW" },
      progressed_at: "2026-10-01T00:00:00.000Z",
    });
    expect(manga.mangaId).to.equal("aB7kP2xQ");
    expect(manga.mangaInfo.primaryTitle).to.equal("Example Manga");
    expect(manga.mangaInfo.secondaryTitles).to.deep.equal(["例のマンガ"]);
    expect(manga.mangaInfo.thumbnailUrl).to.equal(
      "https://meo.comick.pictures/example-cover-s.jpg",
    );
    expect(manga.mangaInfo.status).to.equal("Ongoing");
    expect(manga.mangaInfo.rating).to.equal(0.825);
    expect(manga.mangaInfo.additionalInfo?.["Last chapter"]).to.equal("3");
    expect(manga.mangaInfo.shareUrl).to.equal("https://comick.dev/comic/example-manga");
    const bare = parseLibraryRow({ hid: "x1", cover_url: null });
    expect(bare.mangaInfo.thumbnailUrl).to.not.be.empty;
    expect(bare.mangaInfo.primaryTitle).to.equal("x1");
  });

  suite.test("token responses rotate the whole session at once", async () => {
    const previous = { accessToken: "old-a", refreshToken: "old-r", expiresAt: 1 };
    const rotated = sessionFrom(
      { access_token: "new-a", refresh_token: "new-r", expires_in: 900 },
      previous,
      1_000,
    );
    expect(rotated).to.deep.equal({
      accessToken: "new-a",
      refreshToken: "new-r",
      expiresAt: 1_000 + 14 * 60 * 1000,
    });
    const kept = sessionFrom({ access_token: "new-a", expires_in: 60 }, previous, 0);
    expect(kept.refreshToken).to.equal("old-r");
    expect(kept.expiresAt).to.equal(60_000);
    expect(() => sessionFrom({ error: "invalid_grant" }, previous, 0)).to.throw("invalid_grant");
  });

  suite.test("PKCE challenge matches RFC 7636", async () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).to.equal(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
    const verifier = randomToken(64);
    expect(verifier).to.match(/^[A-Za-z0-9\-._~]{64}$/);
    expect(randomToken(64)).to.not.equal(verifier);
  });

  suite.test("markdown synopses become plain text", async () => {
    expect(
      plainText(
        "**Bold** text\n\n**Links:**  \n[Manta](https://manta.net), [Tapas](https://tapas.io)",
      ),
    ).to.equal("Bold text\n\nLinks:\nManta, Tapas");
  });

  await suite.run();
}
