/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type Chapter, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { FroPi } from "../FroPi/main.js";
import sourceInfo from "../FroPi/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const SERIES = "11b37f9362-my-daddy-hid-his-power";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("FroPi tests", logger);
  registerDefaultTests(suite, FroPi, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "daddy" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: [SERIES],
    },
    // The newest chapter is early access and serves no pages, so the reader is
    // covered by the oldest-chapter test below.
    chapterProviding: {
      getChapters: false,
      getChapterDetails: false,
    },
  });

  suite.test("every discover row yields items with covers", async () => {
    const sections = await FroPi.getDiscoverSections();
    expect(sections.length).to.equal(4);
    for (const section of sections) {
      const result = await FroPi.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.id).to.be.greaterThan(0);
      for (const item of result.items) {
        if (item.type !== "genresCarouselItem") {
          expect(item.imageUrl, section.id).to.match(/^https:\/\//);
        }
      }
    }
  });

  suite.test("search, filters and cursor paging", async () => {
    const all = await FroPi.getSearchResults({ title: "" }, undefined, undefined);
    expect(all.items.length).to.be.greaterThan(5);

    const byTitle = await FroPi.getSearchResults({ title: "daddy" }, undefined, undefined);
    expect(byTitle.items.map((item) => item.mangaId)).to.include(SERIES);
    expect(byTitle.items.length).to.be.lessThan(all.items.length);

    // Singular, case-sensitive genre: `genres=` or a lowercase value is
    // accepted and then ignored, which would silently show everything.
    const byGenre = await FroPi.getSearchResults(
      { title: "", metadata: { genre: "Horror" } },
      undefined,
      undefined,
    );
    expect(byGenre.items.length).to.be.greaterThan(0);
    expect(byGenre.items.length).to.be.lessThan(all.items.length);

    const completed = await FroPi.getSearchResults(
      { title: "", metadata: { status: "completed" } },
      undefined,
      undefined,
    );
    expect(completed.items.length).to.be.greaterThan(0);
    expect(completed.items.length).to.be.lessThan(all.items.length);
  });

  suite.test("details and the full chapter list", async () => {
    const manga = await FroPi.getMangaDetails(SERIES);
    expect(manga.mangaInfo.primaryTitle).to.not.be.empty;
    expect(manga.mangaInfo.thumbnailUrl).to.match(/^https:\/\//);
    expect(manga.mangaInfo.synopsis.length).to.be.greaterThan(40);
    expect(manga.mangaInfo.secondaryTitles.length).to.be.greaterThan(0);
    expect(manga.mangaInfo.tagGroups?.[0]?.tags.length).to.be.greaterThan(3);

    const chapters = await FroPi.getChapters(manga);
    // The chapters endpoint caps at fifty, so the cursor has to be walked.
    expect(chapters.length).to.equal(Number(manga.mangaInfo.additionalInfo!["Chapters"]));
    expect(chapters.length).to.be.greaterThan(50);
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(chapters.length);
    expect(chapters.filter((chapter) => chapter.publishDate).length).to.equal(chapters.length);
    suite.state["chapters"] = chapters;
  });

  suite.test("pages come out of the reader payload in order", async () => {
    const chapters = suite.state["chapters"] as Chapter[];
    const details = await FroPi.getChapterDetails(chapters[chapters.length - 1]!);
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
