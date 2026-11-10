/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type Chapter, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { AquaReader } from "../AquaReader/main.js";
import sourceInfo from "../AquaReader/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const SERIES = "cyberpunk-chivalry";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("AquaReader tests", logger);
  registerDefaultTests(suite, AquaReader, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "demon" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: [SERIES],
    },
  });

  suite.test("every discover row yields items with covers", async () => {
    const sections = await AquaReader.getDiscoverSections();
    expect(sections.length).to.equal(4);
    for (const section of sections) {
      const result = await AquaReader.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.id).to.be.greaterThan(0);
      for (const item of result.items) {
        if (item.type !== "genresCarouselItem") {
          expect(item.imageUrl, section.id).to.match(/^https?:\/\//);
        }
      }
    }
  });

  suite.test("chapter list carries unique ids and numbers", async () => {
    const manga = await AquaReader.getMangaDetails(SERIES);
    expect(manga.mangaInfo.primaryTitle).to.not.be.empty;
    expect(manga.mangaInfo.thumbnailUrl).to.match(/^https?:\/\//);
    expect(manga.mangaInfo.synopsis.length).to.be.greaterThan(100);
    expect(manga.mangaInfo.tagGroups?.[0]?.tags.length).to.be.greaterThan(0);
    const chapters = await AquaReader.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(3);
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(chapters.length);
    expect(chapters[0]!.chapNum).to.be.greaterThan(chapters[chapters.length - 1]!.chapNum);
    suite.state["chapters"] = chapters;
  });

  suite.test("pages resolve and the first image is served", async () => {
    const chapters = suite.state["chapters"] as Chapter[];
    const details = await AquaReader.getChapterDetails(chapters[chapters.length - 1]!);
    expect("pages" in details).to.be.true;
    if ("pages" in details) {
      expect(details.pages.length).to.be.greaterThan(0);
      const [response, buffer] = await Application.scheduleRequest({
        url: details.pages[0]!,
        method: "GET",
      });
      expect(response.status).to.equal(200);
      // Some hosts mislabel the content type, so check the magic bytes instead.
      const head = Array.from(new Uint8Array(buffer.slice(0, 12)))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      expect(head).to.match(/^(89504e47|ffd8ff|52494646.{8}57454250|474946)/);
    }
  });

  await suite.run();
}
