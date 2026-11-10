/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type Chapter, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { ArtLapsa } from "../ArtLapsa/main.js";
import sourceInfo from "../ArtLapsa/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const SERIES = "b9844ae0-6447-423c-b1dd-4695de2a33da";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("ArtLapsa tests", logger);
  registerDefaultTests(suite, ArtLapsa, sourceInfo, {
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
    const sections = await ArtLapsa.getDiscoverSections();
    expect(sections.length).to.equal(4);
    for (const section of sections) {
      const result = await ArtLapsa.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.id).to.be.greaterThan(0);
      for (const item of result.items) {
        if (item.type !== "genresCarouselItem") {
          expect(item.imageUrl, section.id).to.match(/^https:\/\//);
        }
      }
    }
  });

  suite.test("search narrows the listing and paginates", async () => {
    const all = await ArtLapsa.getSearchResults({ title: "" }, undefined, undefined);
    expect(all.items.length).to.be.greaterThan(0);

    const found = await ArtLapsa.getSearchResults({ title: "love" }, undefined, undefined);
    expect(found.items.length).to.be.greaterThan(0);
    expect(found.items.length).to.be.lessThan(all.items.length + 1);
    expect(found.items.map((item) => item.mangaId)).to.not.deep.equal(
      all.items.map((item) => item.mangaId),
    );

    const second = await ArtLapsa.getSearchResults({ title: "" }, { page: 2 }, undefined);
    expect(second.items.map((item) => item.mangaId)).to.not.deep.equal(
      all.items.map((item) => item.mangaId),
    );
  });

  suite.test("the genre filter comes off the component and narrows it", async () => {
    const form = await ArtLapsa.getAdvancedSearchForm({ title: "" });
    expect(form).to.not.be.undefined;

    const genres = await ArtLapsa.searchGenres();
    expect(genres.length).to.be.greaterThan(3);

    const all = await ArtLapsa.getSearchResults({ title: "" }, undefined, undefined);
    const filtered = await ArtLapsa.getSearchResults(
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
    const manga = await ArtLapsa.getMangaDetails(SERIES);
    expect(manga.mangaInfo.primaryTitle).to.not.be.empty;
    expect(manga.mangaInfo.thumbnailUrl).to.match(/^https:\/\//);
    expect(manga.mangaInfo.synopsis.length).to.be.greaterThan(40);
    expect(manga.mangaInfo.tagGroups?.[0]?.tags.length).to.be.greaterThan(0);
    const chapters = await ArtLapsa.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(2);
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(chapters.length);
    expect(chapters[0]!.chapNum).to.be.greaterThan(chapters[chapters.length - 1]!.chapNum);
    suite.state["chapters"] = chapters;
  });

  suite.test("the oldest chapter serves every page", async () => {
    const chapters = suite.state["chapters"] as Chapter[];
    const details = await ArtLapsa.getChapterDetails(chapters[chapters.length - 1]!);
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
