/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type Chapter, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { MangaMikan } from "../MangaMikan/main.js";
import sourceInfo from "../MangaMikan/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const SERIES = "pressed-flower";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("MangaMikan tests", logger);
  registerDefaultTests(suite, MangaMikan, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "flower" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: [SERIES],
    },
  });

  suite.test("every discover row yields items with covers", async () => {
    const sections = await MangaMikan.getDiscoverSections();
    expect(sections.length).to.equal(4);
    for (const section of sections) {
      const result = await MangaMikan.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.id).to.be.greaterThan(0);
      for (const item of result.items) {
        if (item.type !== "genresCarouselItem") {
          expect(item.imageUrl, section.id).to.match(/^https:\/\//);
        }
      }
    }
  });

  suite.test("listings paginate and search narrows them", async () => {
    const first = await MangaMikan.getSearchResults({ title: "" }, undefined);
    const second = await MangaMikan.getSearchResults({ title: "" }, { page: 2 });
    expect(first.items.length).to.be.greaterThan(0);
    expect(second.items.map((item) => item.mangaId)).to.not.deep.equal(
      first.items.map((item) => item.mangaId),
    );

    const found = await MangaMikan.getSearchResults({ title: "flower" }, undefined);
    expect(found.items.length).to.be.greaterThan(0);
    expect(found.items.length).to.be.lessThan(first.items.length + 1);
  });

  suite.test("details and chapter dates are real", async () => {
    const manga = await MangaMikan.getMangaDetails(SERIES);
    expect(manga.mangaInfo.primaryTitle).to.not.be.empty;
    expect(manga.mangaInfo.thumbnailUrl).to.match(/^https:\/\//);
    expect(manga.mangaInfo.synopsis.length).to.be.greaterThan(40);
    expect(manga.mangaInfo.tagGroups?.[0]?.tags.length).to.be.greaterThan(0);

    const chapters = await MangaMikan.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(3);
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(chapters.length);
    expect(chapters[0]!.chapNum).to.be.greaterThan(chapters[chapters.length - 1]!.chapNum);
    expect(chapters.filter((chapter) => chapter.publishDate).length).to.equal(chapters.length);
    suite.state["chapters"] = chapters;
  });

  suite.test("a chapter serves only its own pages, in order", async () => {
    const chapters = suite.state["chapters"] as Chapter[];
    const chapter = chapters[chapters.length - 1]!;
    const details = await MangaMikan.getChapterDetails(chapter);
    expect("pages" in details).to.be.true;
    if ("pages" in details) {
      expect(details.pages.length).to.be.greaterThan(3);
      // The reader page also carries other chapters' covers.
      for (const page of details.pages) {
        expect(page).to.include(`/mangas/${chapter.chapterId}/`);
      }
      const numbers = details.pages.map((page) => Number(/p(\d+)_/.exec(page)?.[1] ?? 0));
      expect(numbers).to.deep.equal([...numbers].sort((left, right) => left - right));

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
