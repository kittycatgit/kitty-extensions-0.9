/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type Chapter, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { RenaScans } from "../RenaScans/main.js";
import sourceInfo from "../RenaScans/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const SERIES = "the-nuances-of-lies";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("RenaScans tests", logger);
  registerDefaultTests(suite, RenaScans, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "lies" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: [SERIES],
    },
    // The newest chapter is coin-locked, so the reader is covered by the
    // oldest-chapter test below.
    chapterProviding: {
      getChapters: false,
      getChapterDetails: false,
    },
  });

  suite.test("every discover row yields items with covers", async () => {
    const sections = await RenaScans.getDiscoverSections();
    expect(sections.length).to.equal(3);
    for (const section of sections) {
      const result = await RenaScans.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.id).to.be.greaterThan(0);
      for (const item of result.items) {
        if (item.type !== "genresCarouselItem") {
          expect(item.imageUrl, section.id).to.match(/^https:\/\//);
        }
      }
    }
  });

  suite.test("search and the filters the API actually honours", async () => {
    const all = await RenaScans.getSearchResults({ title: "" }, undefined);
    expect(all.items.length).to.be.greaterThan(10);

    const byTitle = await RenaScans.getSearchResults({ title: "lies" }, undefined);
    expect(byTitle.items.length).to.be.greaterThan(0);
    expect(byTitle.items.length).to.be.lessThan(all.items.length);

    const completed = await RenaScans.getSearchResults(
      { title: "", metadata: { status: "Completed" } },
      undefined,
    );
    expect(completed.items.length).to.be.greaterThan(0);
    expect(completed.items.map((item) => item.mangaId)).to.not.deep.equal(
      all.items.map((item) => item.mangaId),
    );

    // The listing caps at fifty, so paging has to walk an offset.
    const second = await RenaScans.getSearchResults({ title: "" }, { offset: 50 });
    expect(second.items.map((item) => item.mangaId)).to.not.deep.equal(
      all.items.map((item) => item.mangaId),
    );
  });

  suite.test("details and chapters are real", async () => {
    const manga = await RenaScans.getMangaDetails(SERIES);
    expect(manga.mangaInfo.primaryTitle).to.not.be.empty;
    expect(manga.mangaInfo.thumbnailUrl).to.match(/^https:\/\//);
    expect(manga.mangaInfo.synopsis.length).to.be.greaterThan(40);
    expect(manga.mangaInfo.secondaryTitles.length).to.be.greaterThan(0);
    expect(manga.mangaInfo.tagGroups?.[0]?.tags.length).to.be.greaterThan(0);

    const chapters = await RenaScans.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(3);
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(chapters.length);
    expect(chapters[0]!.chapNum).to.be.greaterThan(chapters[chapters.length - 1]!.chapNum);
    expect(chapters.filter((chapter) => chapter.publishDate).length).to.equal(chapters.length);
    suite.state["chapters"] = chapters;
  });

  suite.test("pages come back signed and load", async () => {
    const chapters = suite.state["chapters"] as Chapter[];
    const details = await RenaScans.getChapterDetails(chapters[chapters.length - 1]!);
    expect("pages" in details).to.be.true;
    if ("pages" in details) {
      expect(details.pages.length).to.be.greaterThan(3);
      // Page urls carry an expiry and a signature; an unsigned one would 403.
      for (const page of details.pages) {
        expect(page).to.match(/^https:\/\/renascans\.net\/uploads\/.*[?&]sig=/);
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
