/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type Chapter, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { ReadNovel } from "../ReadNovel/main.js";
import sourceInfo from "../ReadNovel/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

// Small on purpose: this one has a single-page table of contents, so the tests
// stay quick. The paging test uses a long novel instead.
const SHORT = "emperor";
const LONG = "emperors-domination";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("ReadNovel tests", logger);
  registerDefaultTests(suite, ReadNovel, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "emperor" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: [SHORT],
    },
  });

  suite.test("every discover row yields items with covers", async () => {
    const sections = await ReadNovel.getDiscoverSections();
    expect(sections.length).to.equal(4);
    for (const section of sections) {
      const result = await ReadNovel.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.id).to.be.greaterThan(0);
      for (const item of result.items) {
        if (item.type !== "genresCarouselItem") {
          expect(item.imageUrl, section.id).to.match(/^https:\/\//);
        }
      }
    }
  });

  suite.test("search is a path, and browse filters are query parameters", async () => {
    const all = await ReadNovel.getSearchResults({ title: "" }, undefined, undefined);
    expect(all.items.length).to.be.greaterThan(10);

    // /browse ignores q, search, title and keyword, so title search has to go
    // through /search/<query>.
    const found = await ReadNovel.getSearchResults({ title: "emperor" }, undefined, undefined);
    expect(found.items.length).to.be.greaterThan(0);
    expect(found.items.map((item) => item.mangaId)).to.include(SHORT);

    const byGenre = await ReadNovel.getSearchResults(
      { title: "", metadata: { genre: "action" } },
      undefined,
      undefined,
    );
    expect(byGenre.items.map((item) => item.mangaId)).to.not.deep.equal(
      all.items.map((item) => item.mangaId),
    );

    const completed = await ReadNovel.getSearchResults(
      { title: "", metadata: { status: "completed" } },
      undefined,
      undefined,
    );
    expect(completed.items.map((item) => item.mangaId)).to.not.deep.equal(
      all.items.map((item) => item.mangaId),
    );

    const second = await ReadNovel.getSearchResults({ title: "" }, { page: 2 }, undefined);
    expect(second.items.map((item) => item.mangaId)).to.not.deep.equal(
      all.items.map((item) => item.mangaId),
    );
  });

  suite.test("details read as a novel", async () => {
    const manga = await ReadNovel.getMangaDetails(LONG);
    expect(manga.mangaInfo.primaryTitle).to.not.be.empty;
    expect(manga.mangaInfo.contentType).to.equal("novel");
    expect(manga.mangaInfo.thumbnailUrl).to.match(/^https:\/\/cdn\./);
    expect(manga.mangaInfo.synopsis.length).to.be.greaterThan(80);
    expect(manga.mangaInfo.secondaryTitles.length).to.be.greaterThan(0);
  });

  suite.test("the whole table of contents is walked, not just its first page", async () => {
    const manga = await ReadNovel.getMangaDetails(LONG);
    const chapters = await ReadNovel.getChapters(manga);
    // A hundred per page, and this novel runs past five thousand.
    expect(chapters.length).to.be.greaterThan(5000);
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(chapters.length);
    expect(chapters[0]!.chapNum).to.be.greaterThan(chapters[chapters.length - 1]!.chapNum);
    suite.state["chapters"] = chapters;
  });

  suite.test("chapter text comes back as html", async () => {
    const chapters = suite.state["chapters"] as Chapter[];
    const details = await ReadNovel.getChapterDetails(chapters[chapters.length - 1]!);
    expect(details.type).to.equal("html");
    if (details.type === "html") {
      const text = details.html
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      expect(text.length).to.be.greaterThan(500);
    }
  });

  await suite.run();
}
