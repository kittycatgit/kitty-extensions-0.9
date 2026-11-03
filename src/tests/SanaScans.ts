/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { SanaScans } from "../SanaScans/main.js";
import sourceInfo from "../SanaScans/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const SERIES = "a-marriage-chosen-for-love-over-politics-regret-came-ten-years-later";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("SanaScans tests", logger);
  // The newest chapters of most series are coin-locked, so the default chapter
  // test (which opens chapters[0]) is replaced below.
  registerDefaultTests(suite, SanaScans, sourceInfo, {
    chapterProviding: false,
    searchResultsProviding: {
      getSearchResults: [{ title: "marriage" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: [SERIES],
    },
  });

  suite.test("series: metadata, full chapter list and an unlocked chapter", async () => {
    const series = await SanaScans.getMangaDetails(SERIES);
    const info = series.mangaInfo;
    expect(info.primaryTitle).to.contain("A Marriage Chosen for Love");
    expect(info.status).to.equal("Ongoing");
    expect(info.synopsis.length).to.be.greaterThan(100);
    expect(info.rating).to.be.greaterThan(0);
    expect(info.tagGroups?.[0]?.tags.map((tag) => tag.title)).to.include("Romance");

    const chapters = await SanaScans.getChapters(series);
    expect(chapters.length).to.equal(Number(info.additionalInfo?.Chapters));
    expect(chapters.every((chapter) => !/\s/.test(chapter.chapterId))).to.be.true;
    expect(chapters.some((chapter) => chapter.version === "Locked")).to.be.true;

    const free = [...chapters].reverse().find((chapter) => chapter.version !== "Locked")!;
    const details = await SanaScans.getChapterDetails(free);
    const pages = "pages" in details ? details.pages : [];
    expect(pages.length).to.be.greaterThan(0);
    expect(pages.every((page) => page.startsWith("https://storage.sanascans.com/"))).to.be.true;
    const [response] = await Application.scheduleRequest({ url: pages[0]!, method: "GET" });
    expect(response.status).to.equal(200);
  });

  suite.test("locked chapters are rejected with the price", async () => {
    const series = await SanaScans.getMangaDetails(SERIES);
    const chapters = await SanaScans.getChapters(series);
    const locked = chapters.find((chapter) => chapter.version === "Locked")!;
    let message = "";
    try {
      await SanaScans.getChapterDetails(locked);
    } catch (error) {
      message = String(error);
    }
    expect(message).to.match(/locked and costs \d+ coins/);
  });

  suite.test("every discover row yields items", async () => {
    const sections = await SanaScans.getDiscoverSections();
    expect(sections.length).to.equal(9);
    for (const section of sections) {
      const result = await SanaScans.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.id).to.be.greaterThan(4);
      for (const item of result.items) {
        if (item.type !== "genresCarouselItem") {
          expect(item.imageUrl, section.id).to.match(/^https:\/\//);
        }
      }
    }
  });

  suite.test("genre include and exclude change the results", async () => {
    const all = await SanaScans.getSearchResults({ title: "" }, undefined, undefined);
    const isekai = await SanaScans.getSearchResults(
      { title: "", metadata: { genres: { "6": "included" } } },
      undefined,
      undefined,
    );
    const noRomance = await SanaScans.getSearchResults(
      { title: "", metadata: { genres: { "5": "excluded" } } },
      undefined,
      undefined,
    );
    expect(isekai.items.length).to.be.greaterThan(0);
    expect(isekai.items.map((item) => item.mangaId)).to.not.deep.equal(
      all.items.map((item) => item.mangaId),
    );
    expect(noRomance.items.map((item) => item.mangaId)).to.not.deep.equal(
      all.items.map((item) => item.mangaId),
    );
  });

  await suite.run();
}
