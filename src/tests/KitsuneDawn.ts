/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type Chapter, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { KitsuneDawn } from "../KitsuneDawn/main.js";
import sourceInfo from "../KitsuneDawn/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const SERIES = "00621ee1-3bc2-4465-8fd3-9f202cfbebd4";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("KitsuneDawn tests", logger);
  registerDefaultTests(suite, KitsuneDawn, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "love" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: [SERIES],
    },
    // Recent chapters are coin-locked, so the reader is checked against the
    // oldest chapter below.
    chapterProviding: {
      getChapters: false,
      getChapterDetails: false,
    },
  });

  suite.test("the livewire listing answers every rail", async () => {
    const sections = await KitsuneDawn.getDiscoverSections();
    expect(sections.length).to.equal(4);
    for (const section of sections) {
      const result = await KitsuneDawn.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.id).to.be.greaterThan(0);
      for (const item of result.items) {
        if (item.type !== "genresCarouselItem") {
          expect(item.imageUrl, section.id).to.match(/^https:\/\//);
        }
      }
    }
  });

  suite.test("search narrows the listing and paginates", async () => {
    const all = await KitsuneDawn.getSearchResults({ title: "" }, undefined, undefined);
    expect(all.items.length).to.be.greaterThan(0);

    const found = await KitsuneDawn.getSearchResults({ title: "love" }, undefined, undefined);
    expect(found.items.length).to.be.greaterThan(0);
    expect(found.items.length).to.be.lessThan(all.items.length + 1);
    expect(found.items.map((item) => item.mangaId)).to.not.deep.equal(
      all.items.map((item) => item.mangaId),
    );

    const second = await KitsuneDawn.getSearchResults({ title: "" }, { page: 2 }, undefined);
    expect(second.items.map((item) => item.mangaId)).to.not.deep.equal(
      all.items.map((item) => item.mangaId),
    );
  });

  suite.test("the genre filter comes off the component and narrows it", async () => {
    const form = await KitsuneDawn.getAdvancedSearchForm({ title: "" });
    expect(form).to.not.be.undefined;

    const genres = await KitsuneDawn.searchGenres();
    expect(genres.length).to.be.greaterThan(3);

    const all = await KitsuneDawn.getSearchResults({ title: "" }, undefined, undefined);
    const filtered = await KitsuneDawn.getSearchResults(
      { title: "", metadata: { genre: genres[0]!.id } },
      undefined,
      undefined,
    );
    expect(filtered.items.length).to.be.greaterThan(0);
    expect(filtered.items.map((item) => item.mangaId)).to.not.deep.equal(
      all.items.map((item) => item.mangaId),
    );
  });

  suite.test("details and chapters are real", async () => {
    const manga = await KitsuneDawn.getMangaDetails(SERIES);
    expect(manga.mangaInfo.primaryTitle).to.not.be.empty;
    expect(manga.mangaInfo.thumbnailUrl).to.match(/^https:\/\//);
    expect(manga.mangaInfo.synopsis.length).to.be.greaterThan(40);
    expect(manga.mangaInfo.tagGroups?.[0]?.tags.length).to.be.greaterThan(0);
    const chapters = await KitsuneDawn.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(2);
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(chapters.length);
    expect(chapters[0]!.chapNum).to.be.greaterThan(chapters[chapters.length - 1]!.chapNum);
    suite.state["chapters"] = chapters;
  });

  suite.test("the oldest chapter serves every page", async () => {
    const chapters = suite.state["chapters"] as Chapter[];
    const details = await KitsuneDawn.getChapterDetails(chapters[chapters.length - 1]!);
    expect("pages" in details).to.be.true;
    if ("pages" in details) {
      expect(details.pages.length).to.be.greaterThan(3);
      // Pages are built from a template, so the last one has to exist too.
      for (const url of [details.pages[0]!, details.pages[details.pages.length - 1]!]) {
        const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
        expect(response.status, url).to.equal(200);
        const head = Array.from(new Uint8Array(buffer.slice(0, 16)))
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        expect(head, url).to.match(/(89504e47|ffd8ff|57454250|474946|6674797061766966)/);
      }
    }
  });

  await suite.run();
}
