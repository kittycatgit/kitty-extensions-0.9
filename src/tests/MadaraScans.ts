/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { MadaraScans } from "../MadaraScans/main.js";
import sourceInfo from "../MadaraScans/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const SERIES = "0th-correctional-officer";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("MadaraScans tests", logger);
  registerDefaultTests(suite, MadaraScans, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "love" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: [SERIES],
    },
  });

  suite.test("series details and chapters are real", async () => {
    const manga = await MadaraScans.getMangaDetails(SERIES);
    expect(manga.mangaInfo.primaryTitle).to.not.be.empty;
    expect(manga.mangaInfo.thumbnailUrl).to.match(/^https?:\/\//);
    const chapters = await MadaraScans.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(0);
    const details = await MadaraScans.getChapterDetails(chapters[chapters.length - 1]!);
    expect("pages" in details).to.be.true;
    if ("pages" in details) {
      expect(details.pages.length).to.be.greaterThan(0);
      expect(details.pages[0]).to.match(/^https?:\/\//);
    }
  });

  suite.test("every discover row yields items with covers", async () => {
    const sections = await MadaraScans.getDiscoverSections();
    expect(sections.length).to.be.greaterThan(0);
    for (const section of sections) {
      const result = await MadaraScans.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.id).to.be.greaterThan(0);
      for (const item of result.items) {
        if (item.type !== "genresCarouselItem") {
          expect(item.imageUrl, section.id).to.match(/^https?:\/\//);
        }
      }
    }
  });

  await suite.run();
}
