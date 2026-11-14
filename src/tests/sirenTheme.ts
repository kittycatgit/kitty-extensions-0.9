/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type Chapter } from "@paperback/types";
import { expect } from "chai";

import type { SirenGeneric } from "../siren/main.js";
import type { SirenSearchMetadata } from "../siren/models.js";
import type { TestSuite } from "./suite.js";

// Real-content checks shared by every site on the Siren theme.
export function registerSirenTests(suite: TestSuite, source: SirenGeneric, series: string) {
  suite.test("every discover row yields items with covers", async () => {
    const sections = await source.getDiscoverSections();
    expect(sections.length).to.be.greaterThan(8);
    for (const section of sections) {
      const result = await source.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.id).to.be.greaterThan(0);
      for (const item of result.items) {
        if (item.type !== "genresCarouselItem") {
          expect(item.imageUrl, section.id).to.match(/^https:\/\//);
        }
      }
    }
  });

  suite.test("browse pages do not repeat", async () => {
    const first = await source.getSearchResults({ title: "" }, undefined, undefined);
    const second = await source.getSearchResults(
      { title: "" },
      first.metadata as SirenSearchMetadata,
      undefined,
    );
    const seen = new Set(first.items.map((item) => item.mangaId));
    expect(second.items.length).to.be.greaterThan(0);
    expect(second.items.filter((item) => seen.has(item.mangaId))).to.be.empty;
  });

  suite.test("genre filter returns series carrying that genre", async () => {
    const sections = await source.getDiscoverSections();
    const genres = await source.getDiscoverSectionItems(sections[sections.length - 1]!, undefined);
    // A multi-word genre: its id (slug) and its name on the site differ.
    const genre = genres.items
      .map((item) => (item.type === "genresCarouselItem" ? item.searchQuery.metadata : undefined))
      .map((metadata) => (metadata as { tags: string[] } | undefined)?.tags[0])
      .find((id) => id?.includes("-"));
    expect(genre).to.be.a("string");
    const filtered = await source.getSearchResults(
      { title: "", metadata: { tags: [genre!] } },
      undefined,
      undefined,
    );
    expect(filtered.items.length, genre).to.be.greaterThan(0);
    const manga = await source.getMangaDetails(filtered.items[0]!.mangaId);
    expect(manga.mangaInfo.tagGroups?.[0]?.tags.map((tag) => tag.id)).to.include(genre);
  });

  suite.test("series details and chapter list are real", async () => {
    const manga = await source.getMangaDetails(series);
    expect(manga.mangaInfo.primaryTitle).to.not.be.empty;
    expect(manga.mangaInfo.thumbnailUrl).to.match(/^https:\/\//);
    expect(manga.mangaInfo.synopsis.length).to.be.greaterThan(20);
    expect(manga.mangaInfo.status).to.not.equal("Unknown");
    expect(manga.mangaInfo.tagGroups?.[0]?.tags.length).to.be.greaterThan(0);
    const chapters = await source.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(1);
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(chapters.length);
    expect(chapters[0]!.chapNum).to.be.greaterThan(chapters[chapters.length - 1]!.chapNum);
    expect(chapters.filter((chapter) => chapter.publishDate).length).to.equal(chapters.length);
    suite.state["chapters"] = chapters;
  });

  // Newer chapters are coin-locked, so read the oldest free one.
  suite.test("a free chapter serves real image bytes", async () => {
    const chapters = suite.state["chapters"] as Chapter[];
    const free = chapters.filter((chapter) => !chapter.version);
    const details = await source.getChapterDetails(free[free.length - 1]!);
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
      expect(head).to.match(/^(89504e47|ffd8ff|52494646.{8}57454250|474946|.{8}6674797061766966)/);
    }
  });
}
