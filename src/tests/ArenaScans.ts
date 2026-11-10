/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type Chapter, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { ArenaScans } from "../ArenaScans/main.js";
import sourceInfo from "../ArenaScans/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

// Slugs here are random strings, never title-derived, so this one is read off
// the listing rather than constructed.
const SERIES = "2vey2spampjvafi";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("ArenaScans tests", logger);
  registerDefaultTests(suite, ArenaScans, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "idol" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: [SERIES],
    },
  });

  suite.test("every discover row yields items with covers", async () => {
    const sections = await ArenaScans.getDiscoverSections();
    expect(sections.length).to.equal(4);
    for (const section of sections) {
      const result = await ArenaScans.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.id).to.be.greaterThan(0);
      for (const item of result.items) {
        if (item.type !== "genresCarouselItem") {
          expect(item.imageUrl, section.id).to.match(/^https?:\/\//);
        }
      }
    }
  });

  suite.test("details come off the custom hero block", async () => {
    const manga = await ArenaScans.getMangaDetails(SERIES);
    expect(manga.mangaInfo.primaryTitle).to.not.be.empty;
    expect(manga.mangaInfo.thumbnailUrl).to.match(/^https?:\/\//);
    expect(manga.mangaInfo.synopsis.length).to.be.greaterThan(100);
    expect(manga.mangaInfo.status).to.not.be.empty;
    expect(manga.mangaInfo.tagGroups?.[0]?.tags.length).to.be.greaterThan(0);
    const chapters = await ArenaScans.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(5);
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(chapters.length);
    suite.state["chapters"] = chapters;
  });

  suite.test("pages resolve and the first image is served", async () => {
    const chapters = suite.state["chapters"] as Chapter[];
    const details = await ArenaScans.getChapterDetails(chapters[chapters.length - 1]!);
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
