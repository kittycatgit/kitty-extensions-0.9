/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type Chapter, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { DesireScans } from "../DesireScans/main.js";
import sourceInfo from "../DesireScans/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const SERIES = "robber-x-lover";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("DesireScans tests", logger);
  registerDefaultTests(suite, DesireScans, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "robber" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: [SERIES],
    },
    // Newer chapters are coin-locked, so the reader is checked against the
    // oldest chapter below instead.
    chapterProviding: {
      getChapters: false,
      getChapterDetails: false,
    },
  });

  suite.test("every discover row yields items with covers", async () => {
    const sections = await DesireScans.getDiscoverSections();
    expect(sections.length).to.equal(4);
    for (const section of sections) {
      const result = await DesireScans.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.id).to.be.greaterThan(0);
      for (const item of result.items) {
        if (item.type !== "genresCarouselItem") {
          expect(item.imageUrl, section.id).to.match(/^https:\/\//);
        }
      }
    }
  });

  suite.test("genres are read off the listing and narrow it", async () => {
    const form = await DesireScans.getAdvancedSearchForm({ title: "" });
    expect(form).to.not.be.undefined;

    const all = await DesireScans.getSearchResults({ title: "" }, undefined, undefined);
    const filtered = await DesireScans.getSearchResults(
      { title: "", metadata: { genre: ["comedy"] } },
      undefined,
      undefined,
    );
    expect(filtered.items.length, "comedy").to.be.greaterThan(0);
    expect(filtered.items.map((item) => item.mangaId)).to.not.deep.equal(
      all.items.map((item) => item.mangaId),
    );
  });

  suite.test("title search finds the series under test", async () => {
    const found = await DesireScans.getSearchResults({ title: "robber" }, undefined, undefined);
    expect(found.items.map((item) => item.mangaId)).to.include(SERIES);
  });

  suite.test("details and the chapter list are real", async () => {
    const manga = await DesireScans.getMangaDetails(SERIES);
    expect(manga.mangaInfo.primaryTitle).to.not.be.empty;
    expect(manga.mangaInfo.thumbnailUrl).to.match(/^https:\/\//);
    expect(manga.mangaInfo.synopsis.length).to.be.greaterThan(40);
    expect(manga.mangaInfo.tagGroups?.[0]?.tags.length).to.be.greaterThan(0);
    const chapters = await DesireScans.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(1);
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(chapters.length);
    expect(chapters[0]!.chapNum).to.be.greaterThan(chapters[chapters.length - 1]!.chapNum);
    expect(chapters.filter((chapter) => chapter.publishDate).length).to.equal(chapters.length);
    suite.state["chapters"] = chapters;
  });

  suite.test("the oldest chapter serves pages in order", async () => {
    const chapters = suite.state["chapters"] as Chapter[];
    const details = await DesireScans.getChapterDetails(chapters[chapters.length - 1]!);
    expect("pages" in details).to.be.true;
    if ("pages" in details) {
      expect(details.pages.length).to.be.greaterThan(3);
      for (const page of details.pages) {
        expect(page).to.match(/^https:\/\//);
      }
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
