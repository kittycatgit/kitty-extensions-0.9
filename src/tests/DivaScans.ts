/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type SourceManga, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { DivaScans } from "../DivaScans/main.js";
import sourceInfo from "../DivaScans/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const ID_PATTERN = /^[A-Za-z0-9._\-@()[\]%?#+=/&:]+$/;

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("DivaScans tests", logger);
  // The newest chapter of nearly every series is paid, so the default chapter
  // tests (which open chapters[0]) are replaced below.
  registerDefaultTests(suite, DivaScans, sourceInfo, { chapterProviding: false });

  async function oldestFreeChapter(series: SourceManga) {
    const chapters = await DivaScans.getChapters(series);
    expect(chapters.every((chapter) => ID_PATTERN.test(chapter.chapterId))).to.be.true;
    expect(chapters.every((chapter, i) => i === 0 || chapters[i - 1]!.chapNum > chapter.chapNum)).to
      .be.true;
    const free = [...chapters].reverse().find((chapter) => chapter.version !== "Paid");
    expect(free).to.not.be.undefined;
    return { chapters, free: free! };
  }

  suite.test("comic series: metadata, chapters and plain image pages", async () => {
    const series = await DivaScans.getMangaDetails("deer-pink");
    const info = series.mangaInfo;
    expect(info.primaryTitle).to.equal("Deer Pink");
    expect(info.contentType).to.equal("comic");
    expect(info.secondaryTitles).to.include("디어 핑크");
    expect(info.status).to.equal("Ongoing");
    expect(info.author).to.equal("Kim Leuru");
    expect(info.artist).to.equal("Yama");
    expect(info.synopsis.length).to.be.greaterThan(100);
    expect(info.rating).to.be.greaterThan(0.5);
    // The API slug differs from the site slug for this series.
    expect(info.shareUrl).to.equal("https://divascans.org/series/comic/dear-pink");
    const genres = info.tagGroups?.find((group) => group.id === "genres")?.tags ?? [];
    expect(genres.length).to.be.greaterThan(2);
    for (const tag of genres) expect(tag.id).to.match(ID_PATTERN);

    const { chapters, free } = await oldestFreeChapter(series);
    expect(chapters.length).to.equal(Number(info.additionalInfo?.Chapters));
    expect(chapters.some((chapter) => chapter.version === "Paid")).to.be.true;

    const details = await DivaScans.getChapterDetails(free);
    expect("pages" in details).to.be.true;
    const pages = "pages" in details ? details.pages : [];
    expect(pages.length).to.be.greaterThan(0);
    expect(pages.every((page) => page.startsWith("https://media.divascans.org/"))).to.be.true;
    const [response] = await Application.scheduleRequest({ url: pages[0]!, method: "GET" });
    expect(response.status).to.equal(200);
  });

  suite.test("novel series: html chapter as a complete XHTML document", async () => {
    const series = await DivaScans.getMangaDetails("obedient-pregnancy-2");
    const info = series.mangaInfo;
    expect(info.contentType).to.equal("novel");
    expect(info.shareUrl).to.equal("https://divascans.org/series/novel/obedient-pregnancy");

    const { free } = await oldestFreeChapter(series);
    const details = await DivaScans.getChapterDetails(free);
    expect("html" in details).to.be.true;
    const html = "html" in details ? details.html : "";
    expect(html.startsWith('<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>')).to.be
      .true;
    expect(html.endsWith("</body></html>")).to.be.true;
    expect((html.match(/<p>/g) ?? []).length).to.be.greaterThan(20);
    expect(html).to.not.match(/<br>|&nbsp;/);
  });

  suite.test("paid chapters are rejected with the price", async () => {
    const series = await DivaScans.getMangaDetails("obedient-pregnancy");
    const chapters = await DivaScans.getChapters(series);
    const paid = chapters.find((chapter) => chapter.version === "Paid")!;
    let message = "";
    try {
      await DivaScans.getChapterDetails(paid);
    } catch (error) {
      message = String(error);
    }
    expect(message).to.match(/paid chapter \(\d+ coins\)/);
  });

  suite.test("every discover row yields distinct items", async () => {
    const sections = await DivaScans.getDiscoverSections();
    expect(sections.length).to.equal(9);
    const seen = new Set<string>();

    for (const section of sections) {
      const result = await DivaScans.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.id).to.be.greaterThan(5);

      const key = result.items.map((item) => ("title" in item ? item.title : item.name)).join("|");
      expect(seen.has(key), `${section.id} duplicates another row`).to.be.false;
      seen.add(key);

      for (const item of result.items) {
        if (item.type === "genresCarouselItem") {
          expect((item.searchQuery.metadata as { genre?: string }).genre).to.match(ID_PATTERN);
        } else {
          expect(item.mangaId, section.id).to.match(ID_PATTERN);
          expect(item.imageUrl, section.id).to.match(/^https:\/\//);
        }
      }
    }
  });

  suite.test("genre filter and its exclusion are honoured", async () => {
    const included = await DivaScans.getSearchResults(
      { title: "", metadata: { genre: "slice-of-life" } },
      undefined,
      undefined,
    );
    expect(included.items.length).to.be.greaterThan(10);
    const first = await DivaScans.getMangaDetails(included.items[0]!.mangaId);
    const genres = first.mangaInfo.tagGroups?.find((group) => group.id === "genres")?.tags ?? [];
    expect(genres.map((tag) => tag.id)).to.include("slice-of-life");

    const page2 = await DivaScans.getSearchResults(
      { title: "", metadata: { genre: "slice-of-life" } },
      included.metadata,
      undefined,
    );
    expect(page2.items.map((item) => item.mangaId)).to.not.deep.equal(
      included.items.map((item) => item.mangaId),
    );

    const search = await DivaScans.getSearchResults(
      { title: "the grand duke" },
      undefined,
      undefined,
    );
    expect(search.items.length).to.be.greaterThan(0);
  });

  await suite.run();
}
