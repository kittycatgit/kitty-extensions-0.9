/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type Chapter, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { NuviaToon } from "../NuviaToon/main.js";
import sourceInfo from "../NuviaToon/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const COMIC = "comic:after-the-possessor-left";
const NOVEL = "novel:the-fantasie-of-a-stepmother-novel";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("NuviaToon tests", logger);
  registerDefaultTests(suite, NuviaToon, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "possessor" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: [COMIC],
    },
    // The newest chapters are coin-locked, so the reader is checked against the
    // oldest chapter of each half below.
    chapterProviding: {
      getChapters: false,
      getChapterDetails: false,
    },
  });

  suite.test("every discover row yields items with covers", async () => {
    const sections = await NuviaToon.getDiscoverSections();
    expect(sections.length).to.equal(4);
    for (const section of sections) {
      const result = await NuviaToon.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.id).to.be.greaterThan(0);
      for (const item of result.items) {
        if (item.type !== "genresCarouselItem") {
          expect(item.imageUrl, section.id).to.match(/^https:\/\//);
        }
      }
    }
  });

  suite.test("search, genre, status and the novel half", async () => {
    const all = await NuviaToon.getSearchResults({ title: "" }, undefined, undefined);
    expect(all.items.length).to.be.greaterThan(5);

    // `search=` is accepted and ignored by this API, so a working query has to
    // narrow the list.
    const found = await NuviaToon.getSearchResults({ title: "possessor" }, undefined, undefined);
    expect(found.items.map((item) => item.mangaId)).to.include(COMIC);
    expect(found.items.length).to.be.lessThan(all.items.length);

    const byGenre = await NuviaToon.getSearchResults(
      { title: "", metadata: { genre: "action" } },
      undefined,
      undefined,
    );
    expect(byGenre.items.length).to.be.greaterThan(0);
    expect(byGenre.items.length).to.be.lessThan(all.items.length);

    const novels = await NuviaToon.getSearchResults(
      { title: "", metadata: { kind: "novel" } },
      undefined,
      undefined,
    );
    expect(novels.items.length).to.be.greaterThan(0);
    expect(novels.items.every((item) => item.mangaId.startsWith("novel:"))).to.be.true;
  });

  suite.test("comic details, chapters and pages", async () => {
    const manga = await NuviaToon.getMangaDetails(COMIC);
    expect(manga.mangaInfo.primaryTitle).to.not.be.empty;
    expect(manga.mangaInfo.contentType).to.equal("comic");
    expect(manga.mangaInfo.thumbnailUrl).to.match(/^https:\/\//);
    expect(manga.mangaInfo.synopsis.length).to.be.greaterThan(40);
    expect(manga.mangaInfo.secondaryTitles.length).to.be.greaterThan(0);

    const chapters = await NuviaToon.getChapters(manga);
    expect(chapters.length).to.equal(Number(manga.mangaInfo.additionalInfo!["Chapters"]));
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(chapters.length);

    const details = await NuviaToon.getChapterDetails(chapters[chapters.length - 1]!);
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

  suite.test("novel details and chapter text", async () => {
    const manga = await NuviaToon.getMangaDetails(NOVEL);
    expect(manga.mangaInfo.contentType).to.equal("novel");
    const chapters = await NuviaToon.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(0);

    const details = await NuviaToon.getChapterDetails(chapters[chapters.length - 1]!);
    expect(details.type).to.equal("html");
    if (details.type === "html") {
      const text = details.html
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      expect(text.length).to.be.greaterThan(500);
    }
  });

  await suite.run();
}
