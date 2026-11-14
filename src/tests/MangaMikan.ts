/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type Chapter, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { MangaMikan } from "../MangaMikan/main.js";
import type { MikanSearchMetadata } from "../MangaMikan/models.js";
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

  suite.test("every discover row yields its own items with covers", async () => {
    const sections = await MangaMikan.getDiscoverSections();
    expect(sections.length).to.equal(7);
    const rails: string[] = [];
    for (const section of sections) {
      const result = await MangaMikan.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.id).to.be.greaterThan(0);
      for (const item of result.items) {
        if (item.type !== "genresCarouselItem") {
          expect(item.imageUrl, section.id).to.match(/^https:\/\//);
        }
      }
      rails.push(
        result.items
          .map((item) => (item.type === "genresCarouselItem" ? item.name : item.mangaId))
          .join(),
      );
    }
    expect(new Set(rails).size).to.equal(rails.length);
  });

  suite.test("latest updates carry a chapter and a date", async () => {
    const sections = await MangaMikan.getDiscoverSections();
    const latest = await MangaMikan.getDiscoverSectionItems(sections[1]!, undefined);
    for (const item of latest.items) {
      expect(item.type).to.equal("chapterUpdatesCarouselItem");
      if (item.type === "chapterUpdatesCarouselItem") {
        expect(item.chapterId).to.match(/^\d+$/);
        expect(item.publishDate).to.be.instanceOf(Date);
      }
    }
  });

  suite.test("every sort pages without repeating", async () => {
    const sorts = await MangaMikan.getSortingOptions();
    expect(sorts.length).to.be.greaterThan(4);
    for (const sort of sorts) {
      const first = await MangaMikan.getSearchResults({ title: "" }, undefined, sort);
      const second = await MangaMikan.getSearchResults(
        { title: "" },
        first.metadata as MikanSearchMetadata,
        sort,
      );
      const ids = [...first.items, ...second.items].map((item) => item.mangaId);
      expect(second.items.length, sort.id).to.be.greaterThan(0);
      expect(new Set(ids).size, sort.id).to.equal(ids.length);
    }
  });

  suite.test("genre and status filters narrow the listing", async () => {
    const sections = await MangaMikan.getDiscoverSections();
    const genres = await MangaMikan.getDiscoverSectionItems(
      sections[sections.length - 1]!,
      undefined,
    );
    expect(genres.items.length).to.be.greaterThan(20);
    const filtered = await MangaMikan.getSearchResults(
      { title: "", metadata: { genre: "school-life", status: "completed" } },
      undefined,
      undefined,
    );
    expect(filtered.items.length).to.be.greaterThan(0);
    const manga = await MangaMikan.getMangaDetails(filtered.items[0]!.mangaId);
    expect(manga.mangaInfo.tagGroups?.[0]?.tags.map((tag) => tag.id)).to.include("school-life");
    expect(manga.mangaInfo.status).to.equal("Completed");
  });

  suite.test("a multi-word search finds the series", async () => {
    const results = await MangaMikan.getSearchResults(
      { title: "pressed flower" },
      undefined,
      undefined,
    );
    expect(results.items.map((item) => item.mangaId)).to.include(SERIES);
    expect(results.items[0]!.subtitle).to.not.be.empty;
  });

  suite.test("series details and chapter list are real", async () => {
    const manga = await MangaMikan.getMangaDetails(SERIES);
    expect(manga.mangaInfo.primaryTitle).to.equal("Pressed Flower");
    expect(manga.mangaInfo.thumbnailUrl).to.match(/^https:\/\//);
    expect(manga.mangaInfo.synopsis.length).to.be.greaterThan(20);
    expect(manga.mangaInfo.status).to.not.equal("Unknown");
    expect(manga.mangaInfo.author).to.not.be.empty;
    expect(manga.mangaInfo.tagGroups?.[0]?.tags.length).to.be.greaterThan(0);
    const chapters = await MangaMikan.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(1);
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(chapters.length);
    expect(chapters[0]!.chapNum).to.be.greaterThan(chapters[chapters.length - 1]!.chapNum);
    expect(chapters.filter((chapter) => chapter.publishDate).length).to.equal(chapters.length);
    suite.state["chapters"] = chapters;
  });

  suite.test("a chapter serves real image bytes", async () => {
    const chapters = suite.state["chapters"] as Chapter[];
    const details = await MangaMikan.getChapterDetails(chapters[chapters.length - 1]!);
    expect("pages" in details).to.be.true;
    if ("pages" in details) {
      expect(details.pages.length).to.be.greaterThan(1);
      const [response, buffer] = await Application.scheduleRequest({
        url: details.pages[0]!,
        method: "GET",
      });
      expect(response.status).to.equal(200);
      const head = Array.from(new Uint8Array(buffer.slice(0, 12)))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      expect(head).to.match(/^(89504e47|ffd8ff|52494646.{8}57454250|474946|.{8}6674797061766966)/);
    }
  });

  await suite.run();
}
