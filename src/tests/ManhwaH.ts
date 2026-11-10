/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type Chapter, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { ManhwaH } from "../ManhwaH/main.js";
import sourceInfo from "../ManhwaH/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const SERIES = "a-contract-marriage-with-all-the-perks";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("ManhwaH tests", logger);
  registerDefaultTests(suite, ManhwaH, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "contract" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: [SERIES],
    },
  });

  suite.test("every discover row yields items with covers", async () => {
    const sections = await ManhwaH.getDiscoverSections();
    expect(sections.length).to.equal(4);
    for (const section of sections) {
      const result = await ManhwaH.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.id).to.be.greaterThan(0);
      for (const item of result.items) {
        if (item.type !== "genresCarouselItem") {
          expect(item.imageUrl, section.id).to.match(/^https:\/\//);
        }
      }
    }

    // Two rails must not be the same listing: hot, views and popular are one
    // order on this API and latest, updated and trending another.
    const latest = await ManhwaH.getDiscoverSectionItems(sections[0]!, undefined);
    const rated = await ManhwaH.getDiscoverSectionItems(sections[3]!, undefined);
    const idsOf = (items: typeof latest.items) =>
      items.map((item) => ("mangaId" in item ? item.mangaId : ""));
    expect(idsOf(rated.items)).to.not.deep.equal(idsOf(latest.items));
  });

  suite.test("search, genre and status narrow the catalogue", async () => {
    const all = await ManhwaH.getSearchResults({ title: "" }, undefined, undefined);
    expect(all.items.length).to.be.greaterThan(10);

    // `keyword=`, which the site's own search url uses, is ignored by the API.
    const found = await ManhwaH.getSearchResults({ title: "contract" }, undefined, undefined);
    expect(found.items.length).to.be.greaterThan(0);
    expect(found.items.map((item) => item.mangaId)).to.not.deep.equal(
      all.items.map((item) => item.mangaId),
    );

    const byGenre = await ManhwaH.getSearchResults(
      { title: "", metadata: { genre: "Romance" } },
      undefined,
      undefined,
    );
    expect(byGenre.items.length).to.be.greaterThan(0);

    const second = await ManhwaH.getSearchResults({ title: "" }, { page: 2 }, undefined);
    expect(second.items.map((item) => item.mangaId)).to.not.deep.equal(
      all.items.map((item) => item.mangaId),
    );
  });

  suite.test("details and the chapter list", async () => {
    const manga = await ManhwaH.getMangaDetails(SERIES);
    expect(manga.mangaInfo.primaryTitle).to.not.be.empty;
    expect(manga.mangaInfo.thumbnailUrl).to.match(/^https:\/\//);
    expect(manga.mangaInfo.synopsis.length).to.be.greaterThan(40);
    expect(manga.mangaInfo.secondaryTitles.length).to.be.greaterThan(0);
    expect(manga.mangaInfo.tagGroups?.[0]?.tags.length).to.be.greaterThan(0);

    const chapters = await ManhwaH.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(5);
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(chapters.length);
    expect(chapters[0]!.chapNum).to.be.greaterThan(chapters[chapters.length - 1]!.chapNum);
    expect(chapters.filter((chapter) => chapter.publishDate).length).to.equal(chapters.length);
    suite.state["chapters"] = chapters;
  });

  suite.test("a chapter serves its pages", async () => {
    const chapters = suite.state["chapters"] as Chapter[];
    const details = await ManhwaH.getChapterDetails(chapters[chapters.length - 1]!);
    expect("pages" in details).to.be.true;
    if ("pages" in details) {
      expect(details.pages.length).to.be.greaterThan(3);
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
