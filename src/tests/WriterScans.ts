/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type Chapter, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { WriterScans } from "../WriterScans/main.js";
import sourceInfo from "../WriterScans/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const SERIES = "652beef7274";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("WriterScans tests", logger);
  registerDefaultTests(suite, WriterScans, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "star" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: [SERIES],
    },
    // Newer chapters here are coin-locked, so the reader is covered by the
    // free-chapter test below instead of the default one.
    chapterProviding: {
      getChapters: false,
      getChapterDetails: false,
    },
  });

  suite.test("catalogue carries tags, types and statuses", async () => {
    const entries = await WriterScans.catalog();
    expect(entries.length).to.be.greaterThan(10);
    expect(entries.every((entry) => entry.title.length > 0)).to.be.true;
    expect(entries.filter((entry) => entry.imageUrl.startsWith("https://")).length).to.equal(
      entries.length,
    );
    expect(new Set(entries.flatMap((entry) => entry.tags)).size).to.be.greaterThan(3);
  });

  suite.test("every discover row yields items with covers", async () => {
    const sections = await WriterScans.getDiscoverSections();
    expect(sections.length).to.be.greaterThan(2);
    for (const section of sections) {
      const result = await WriterScans.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.id).to.be.greaterThan(0);
      for (const item of result.items) {
        if (item.type !== "genresCarouselItem") {
          expect(item.imageUrl, section.id).to.match(/^https?:\/\//);
        }
      }
    }
  });

  suite.test("genre filter narrows the search", async () => {
    const entries = await WriterScans.catalog();
    const genre = [...new Set(entries.flatMap((entry) => entry.tags))].sort()[0]!;
    const all = await WriterScans.getSearchResults({ title: "" }, undefined);
    const filtered = await WriterScans.getSearchResults(
      { title: "", metadata: { genres: [genre] } },
      undefined,
    );
    expect(filtered.items.length, genre).to.be.greaterThan(0);
    expect(filtered.items.map((item) => item.mangaId)).to.not.deep.equal(
      all.items.map((item) => item.mangaId),
    );
  });

  suite.test("series details and chapter list are real", async () => {
    const manga = await WriterScans.getMangaDetails(SERIES);
    expect(manga.mangaInfo.primaryTitle).to.not.be.empty;
    expect(manga.mangaInfo.thumbnailUrl).to.match(/^https?:\/\//);
    expect(manga.mangaInfo.synopsis.length).to.be.greaterThan(20);
    const chapters = await WriterScans.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(1);
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(chapters.length);
    expect(chapters[0]!.chapNum).to.be.greaterThan(chapters[chapters.length - 1]!.chapNum);
    expect(chapters.filter((chapter) => chapter.publishDate).length).to.equal(chapters.length);
    suite.state["chapters"] = chapters;
  });

  suite.test("a free chapter serves real image bytes", async () => {
    const chapters = suite.state["chapters"] as Chapter[];
    const details = await WriterScans.getChapterDetails(chapters[chapters.length - 1]!);
    expect("pages" in details).to.be.true;
    if ("pages" in details) {
      expect(details.pages.length).to.be.greaterThan(0);
      const [response, buffer] = await Application.scheduleRequest({
        url: details.pages[0]!,
        method: "GET",
      });
      expect(response.status).to.equal(200);
      // The CDN labels every page text/plain, so check the magic bytes.
      const head = Array.from(new Uint8Array(buffer.slice(0, 12)))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      expect(head).to.match(
        /^(89504e47|ffd8ff|52494646.{8}57454250|474946|0000001c6674797061766966|....................6674797061766966)/,
      );
    }
  });

  await suite.run();
}
