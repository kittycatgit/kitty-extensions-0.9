/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type Chapter, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { Tritinia } from "../Tritinia/main.js";
import sourceInfo from "../Tritinia/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const SERIES = "are-you-going-to-kick-out-the-godly-artist";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Tritinia tests", logger);
  registerDefaultTests(suite, Tritinia, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "love" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: [SERIES],
    },
  });

  suite.test("every discover row yields items with covers", async () => {
    const sections = await Tritinia.getDiscoverSections();
    expect(sections.length).to.equal(4);
    for (const section of sections) {
      const result = await Tritinia.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.id).to.be.greaterThan(0);
      for (const item of result.items) {
        if (item.type !== "genresCarouselItem") {
          expect(item.imageUrl, section.id).to.match(/^https?:\/\//);
        }
      }
    }
  });

  suite.test("chapter list carries unique ids and numbers", async () => {
    const manga = await Tritinia.getMangaDetails(SERIES);
    expect(manga.mangaInfo.primaryTitle).to.not.be.empty;
    const chapters = await Tritinia.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(1);
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(chapters.length);
    expect(chapters[0]!.chapNum).to.be.greaterThan(chapters[chapters.length - 1]!.chapNum);
    suite.state["chapters"] = chapters;
  });

  suite.test("pages resolve and the first image is served", async () => {
    const chapters = suite.state["chapters"] as Chapter[];
    const details = await Tritinia.getChapterDetails(chapters[chapters.length - 1]!);
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
