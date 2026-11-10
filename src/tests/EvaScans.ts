/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { EvaScans } from "../EvaScans/main.js";
import sourceInfo from "../EvaScans/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const SERIES = "a-portrait-of-pride";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("EvaScans tests", logger);
  registerDefaultTests(suite, EvaScans, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "love" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: [SERIES],
    },
  });

  suite.test("series details and chapters are real", async () => {
    const manga = await EvaScans.getMangaDetails(SERIES);
    expect(manga.mangaInfo.primaryTitle).to.not.be.empty;
    expect(manga.mangaInfo.thumbnailUrl).to.match(/^https?:\/\//);
    const chapters = await EvaScans.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(0);
    const details = await EvaScans.getChapterDetails(chapters[chapters.length - 1]!);
    expect("pages" in details).to.be.true;
    if ("pages" in details) {
      expect(details.pages.length).to.be.greaterThan(0);
      expect(details.pages[0]).to.match(/^https?:\/\//);
    }
  });

  suite.test("every discover row yields items with covers", async () => {
    const sections = await EvaScans.getDiscoverSections();
    expect(sections.length).to.be.greaterThan(0);
    for (const section of sections) {
      const result = await EvaScans.getDiscoverSectionItems(section, undefined);
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
