/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type Chapter, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { DanmeiNovel } from "../DanmeiNovel/main.js";
import sourceInfo from "../DanmeiNovel/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const SERIES = "after-a-flash-marriage-with-the-disabled-tyrant";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("DanmeiNovel tests", logger);
  registerDefaultTests(suite, DanmeiNovel, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "demon" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: [SERIES],
    },
  });

  suite.test("every discover row yields items with covers", async () => {
    const sections = await DanmeiNovel.getDiscoverSections();
    expect(sections.length).to.equal(4);
    for (const section of sections) {
      const result = await DanmeiNovel.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.id).to.be.greaterThan(0);
      for (const item of result.items) {
        if (item.type !== "genresCarouselItem") {
          expect(item.imageUrl, section.id).to.match(/^https?:\/\//);
        }
      }
    }
  });

  suite.test("chapter list carries unique ids and numbers", async () => {
    const manga = await DanmeiNovel.getMangaDetails(SERIES);
    expect(manga.mangaInfo.primaryTitle).to.not.be.empty;
    const chapters = await DanmeiNovel.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(10);
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(chapters.length);
    expect(chapters[0]!.chapNum).to.be.greaterThan(chapters[chapters.length - 1]!.chapNum);
    suite.state["chapters"] = chapters;
  });

  suite.test("chapter text resolves as html", async () => {
    const chapters = suite.state["chapters"] as Chapter[];
    const details = await DanmeiNovel.getChapterDetails(chapters[chapters.length - 1]!);
    expect(details.type).to.equal("html");
    if (details.type === "html") {
      expect(details.html).to.match(/<\?xml|<html/);
      // Strip the wrapper markup: what is left has to be actual prose.
      const text = details.html
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      expect(text.length).to.be.greaterThan(500);
    }
  });

  await suite.run();
}
