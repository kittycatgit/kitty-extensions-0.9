/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type Chapter, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { KenComics } from "../KenComics/main.js";
import sourceInfo from "../KenComics/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const SERIES = "296";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("KenComics tests", logger);
  registerDefaultTests(suite, KenComics, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "producer" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: [SERIES],
    },
    // The newest chapter of this series is coin-locked, so the reader is
    // covered by the oldest-chapter test below.
    chapterProviding: {
      getChapters: false,
      getChapterDetails: false,
    },
  });

  suite.test("every discover row yields items with covers", async () => {
    const sections = await KenComics.getDiscoverSections();
    expect(sections.length).to.equal(4);
    for (const section of sections) {
      const result = await KenComics.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.id).to.be.greaterThan(0);
      for (const item of result.items) {
        if (item.type !== "genresCarouselItem") {
          expect(item.imageUrl, section.id).to.match(/^https:\/\/[^/]+\/[^/]/);
        }
      }
    }
  });

  suite.test("search and filters narrow the listing", async () => {
    const all = await KenComics.getSearchResults({ title: "" }, undefined);
    expect(all.items.length).to.be.greaterThan(0);

    const byTitle = await KenComics.getSearchResults({ title: "producer" }, undefined);
    expect(byTitle.items.length).to.be.greaterThan(0);
    expect(byTitle.items.map((item) => item.mangaId)).to.not.deep.equal(
      all.items.map((item) => item.mangaId),
    );

    const completed = await KenComics.getSearchResults(
      { title: "", metadata: { seriesStatus: "COMPLETED" } },
      undefined,
    );
    expect(completed.items.map((item) => item.mangaId)).to.not.deep.equal(
      all.items.map((item) => item.mangaId),
    );
  });

  suite.test("details and the whole chapter list come back", async () => {
    const manga = await KenComics.getMangaDetails(SERIES);
    expect(manga.mangaInfo.primaryTitle).to.not.be.empty;
    expect(manga.mangaInfo.thumbnailUrl).to.match(/^https:\/\/[^/]+\/[^/]/);
    expect(manga.mangaInfo.status).to.not.be.empty;
    const chapters = await KenComics.getChapters(manga);
    // The API reports its own total, so a short list means a missed page.
    expect(chapters.length).to.equal(Number(manga.mangaInfo.additionalInfo!["Chapters"]));
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(chapters.length);
    expect(chapters[0]!.chapNum).to.be.greaterThan(chapters[chapters.length - 1]!.chapNum);
    expect(chapters.filter((chapter) => chapter.publishDate).length).to.equal(chapters.length);
    suite.state["chapters"] = chapters;
  });

  suite.test("the oldest chapter serves real image bytes", async () => {
    const chapters = suite.state["chapters"] as Chapter[];
    const details = await KenComics.getChapterDetails(chapters[chapters.length - 1]!);
    expect("pages" in details).to.be.true;
    if ("pages" in details) {
      expect(details.pages.length).to.be.greaterThan(0);
      // A doubled slash after the host is what the API hands back unfixed.
      for (const page of details.pages) {
        expect(page).to.match(/^https:\/\/[^/]+\/[^/]/);
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
