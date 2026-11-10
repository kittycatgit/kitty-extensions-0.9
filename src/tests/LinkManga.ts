/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { LinkManga } from "../LinkManga/main.js";
import sourceInfo from "../LinkManga/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const SERIES = "1000-yen-hero";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("LinkManga tests", logger);
  registerDefaultTests(suite, LinkManga, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "hero" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: [SERIES],
    },
  });

  suite.test("the one reachable row fills and pages", async () => {
    const sections = await LinkManga.getDiscoverSections();
    expect(sections.length).to.equal(1);
    const first = await LinkManga.getDiscoverSectionItems(sections[0]!, undefined);
    expect(first.items.length).to.be.greaterThan(0);
    for (const item of first.items) {
      if (item.type !== "genresCarouselItem") {
        expect(item.imageUrl).to.match(/^https?:\/\//);
      }
    }
    const second = await LinkManga.getDiscoverSectionItems(sections[0]!, { page: 2 });
    const idsOf = (items: typeof first.items) =>
      items.map((item) => ("mangaId" in item ? item.mangaId : ""));
    expect(idsOf(second.items)).to.not.deep.equal(idsOf(first.items));
  });

  suite.test("title search works where the query string is blocked", async () => {
    const found = await LinkManga.getSearchResults({ title: "hero" }, undefined, undefined);
    expect(found.items.length).to.be.greaterThan(0);
    for (const item of found.items) {
      expect(item.imageUrl).to.match(/^https?:\/\//);
    }

    // The typeahead answers a single batch, so page two has to be empty rather
    // than a repeat of page one.
    const far = await LinkManga.getSearchResults({ title: "hero" }, { page: 2 }, undefined);
    expect(far.items.length).to.equal(0);
  });

  suite.test("genres come off the directory page and browse by path", async () => {
    const genres = await LinkManga.fetchGenres();
    expect(genres.length).to.be.greaterThan(10);

    const all = await LinkManga.getSearchResults({ title: "" }, undefined, undefined);
    const byGenre = await LinkManga.getSearchResults(
      { title: "", metadata: { genres: { [genres[0]!.id]: "included" } } },
      undefined,
      undefined,
    );
    expect(byGenre.items.length).to.be.greaterThan(0);
    expect(byGenre.items.map((item) => item.mangaId)).to.not.deep.equal(
      all.items.map((item) => item.mangaId),
    );
  });

  suite.test("details, chapters and pages are real", async () => {
    const manga = await LinkManga.getMangaDetails(SERIES);
    expect(manga.mangaInfo.primaryTitle).to.not.be.empty;
    expect(manga.mangaInfo.thumbnailUrl).to.match(/^https?:\/\//);
    const chapters = await LinkManga.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(10);
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(chapters.length);
    const details = await LinkManga.getChapterDetails(chapters[chapters.length - 1]!);
    expect("pages" in details).to.be.true;
    if ("pages" in details) {
      expect(details.pages.length).to.be.greaterThan(0);
      const [response, buffer] = await Application.scheduleRequest({
        url: details.pages[0]!,
        method: "GET",
      });
      expect(response.status).to.equal(200);
      const head = Array.from(new Uint8Array(buffer.slice(0, 16)))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      expect(head).to.match(/(89504e47|ffd8ff|57454250|474946|6674797061766966)/);
    }
  });

  await suite.run();
}
