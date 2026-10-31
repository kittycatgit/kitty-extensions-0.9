/* eslint-disable @typescript-eslint/no-unused-expressions */
import {
  DiscoverSectionType,
  type Chapter,
  type DiscoverSectionItem,
  type SearchResultItem,
  type TestLogger,
} from "@paperback/types";
import { expect } from "chai";

import { SilentQuill } from "../SilentQuill/main.js";
import sourceInfo from "../SilentQuill/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const ID_PATTERN = /^[A-Za-z0-9._\-@()[\]%?#+=/&:]+$/;

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("SilentQuill tests", logger);
  registerDefaultTests(suite, SilentQuill, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "hero" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: ["doing-secret-things-with-the-holy-maidens"],
    },
  });

  suite.test("series metadata is complete", async () => {
    const manga = await SilentQuill.getMangaDetails("oops-were-rich");
    const info = manga.mangaInfo;

    expect(info.primaryTitle).to.equal("Oops! We’re Rich");
    expect(info.thumbnailUrl).to.match(/^https:\/\/silentquill\.net\/img\//);
    expect(info.synopsis).to.include("lottery");
    expect(info.author).to.equal("Hiroyuki");
    expect(info.artist).to.equal("Hiroyuki");
    expect(info.status).to.equal("Ongoing");
    expect(info.additionalInfo?.["Translated by"]).to.equal("KDT SCANS");
    expect(Number(info.additionalInfo?.["Chapters"])).to.be.greaterThan(60);

    const genres = info.tagGroups?.[0]?.tags ?? [];
    expect(genres.map((tag) => tag.id)).to.include.members(["comedy", "shounen", "slice-of-life"]);
    for (const tag of genres) {
      expect(tag.id).to.match(ID_PATTERN);
    }
  });

  suite.test("adult series is rated ADULT", async () => {
    const manga = await SilentQuill.getMangaDetails("doing-secret-things-with-the-holy-maidens");
    expect(manga.mangaInfo.contentRating).to.equal("ADULT");
  });

  suite.test("every chapter is listed with a number and date", async () => {
    const manga = await SilentQuill.getMangaDetails("doing-secret-things-with-the-holy-maidens");
    const chapters = await SilentQuill.getChapters(manga);

    expect(chapters.length).to.equal(Number(manga.mangaInfo.additionalInfo?.["Chapters"]));
    expect(chapters[0]!.chapNum).to.be.greaterThan(chapters[chapters.length - 1]!.chapNum);
    expect(chapters[chapters.length - 1]!.chapNum).to.equal(1);
    expect(chapters[chapters.length - 1]!.volume).to.equal(1);
    for (const chapter of chapters) {
      expect(chapter.chapterId).to.match(ID_PATTERN);
      expect(chapter.publishDate).to.be.instanceOf(Date);
    }
  });

  suite.test("half chapters keep their decimal", async () => {
    const manga = await SilentQuill.getMangaDetails("tsukimino-karma-is-just-my-pet");
    const chapters = await SilentQuill.getChapters(manga);
    expect(chapters.some((chapter) => chapter.chapNum === 6.5)).to.be.true;
  });

  suite.test("pages resolve and the first one is an image", async () => {
    const manga = await SilentQuill.getMangaDetails("oops-were-rich");
    const chapters = await SilentQuill.getChapters(manga);
    const chapter = chapters.find((entry: Chapter) => entry.chapNum === 61)!;
    const details = await SilentQuill.getChapterDetails(chapter);

    expect("pages" in details && details.pages.length).to.equal(19);
    const first = "pages" in details ? details.pages[0]! : "";
    const [response] = await Application.scheduleRequest({ url: first, method: "GET" });
    expect(response.status).to.equal(200);
    expect(response.headers["content-type"] ?? "").to.match(/^image\//);
  });

  suite.test("every discover row yields items", async () => {
    const sections = await SilentQuill.getDiscoverSections();
    expect(sections.length).to.equal(6);

    for (const section of sections) {
      const results = await SilentQuill.getDiscoverSectionItems(section, undefined);
      expect(results.items.length, section.id).to.be.greaterThan(0);

      for (const item of results.items as DiscoverSectionItem[]) {
        if (item.type === "genresCarouselItem") {
          expect(item.name).to.not.be.empty;
        } else {
          expect(item.mangaId, section.id).to.match(ID_PATTERN);
          expect(item.imageUrl, section.id).to.match(/^https:\/\//);
          expect(item.title, section.id).to.not.be.empty;
        }
      }
    }
  });

  suite.test("latest releases page without repeating", async () => {
    const section = {
      id: "latest",
      title: "Latest releases",
      type: DiscoverSectionType.chapterUpdates,
    };
    const first = await SilentQuill.getDiscoverSectionItems(section, undefined);
    const second = await SilentQuill.getDiscoverSectionItems(
      section,
      first.metadata as Record<string, unknown> | undefined,
    );
    const ids = (entry: typeof first) =>
      entry.items.map((item) => ("mangaId" in item ? item.mangaId : ""));

    expect(first.items.length).to.be.greaterThan(10);
    expect(second.items.length).to.be.greaterThan(10);
    expect(ids(first).filter((id) => ids(second).includes(id))).to.be.empty;
    for (const item of first.items) {
      expect(item.type).to.equal("chapterUpdatesCarouselItem");
      expect("chapterId" in item && item.chapterId).to.match(/-chapter-/);
      expect("subtitle" in item && item.subtitle).to.match(/^Ch\. /);
    }
  });

  suite.test("title search finds the series with a subtitle", async () => {
    const results = await SilentQuill.getSearchResults({ title: "oops rich" }, undefined);
    const hit = results.items.find((item: SearchResultItem) => item.mangaId === "oops-were-rich");
    expect(hit?.title).to.equal("Oops! We’re Rich");
    expect(hit?.subtitle).to.match(/^Ch\. \d+/);
  });

  suite.test("filters narrow the listing", async () => {
    const results = await SilentQuill.getSearchResults(
      { title: "", metadata: { genre: "slice-of-life", status: "completed" } },
      undefined,
    );
    expect(results.items.length).to.be.greaterThan(0);
    expect(results.items.length).to.be.lessThan(24);

    for (const item of results.items.slice(0, 3)) {
      const manga = await SilentQuill.getMangaDetails(item.mangaId);
      expect(manga.mangaInfo.status).to.equal("Completed");
      expect(manga.mangaInfo.tagGroups?.[0]?.tags.map((tag) => tag.id)).to.include("slice-of-life");
    }
  });

  suite.test("listing pages to the end", async () => {
    let metadata: Record<string, unknown> | undefined;
    let total = 0;

    for (let page = 0; page < 12; page += 1) {
      const results = await SilentQuill.getSearchResults(
        { title: "", metadata: { genre: "comedy" } },
        metadata,
      );
      total += results.items.length;
      metadata = results.metadata as Record<string, unknown> | undefined;

      if (results.items.length === 0) {
        break;
      }
    }

    expect(total).to.be.greaterThan(100);
    expect(metadata?.["completed"]).to.be.true;
  });

  suite.test("advanced form loads the genres", async () => {
    const form = await SilentQuill.getAdvancedSearchForm({ title: "" });
    const sections = form.getSections();
    expect(sections.length).to.equal(2);

    const genres = (
      sections[0]!.items[0] as unknown as { form: { params: { items: Array<{ id: string }> } } }
    ).form.params;
    expect(genres.items.length).to.be.greaterThan(40);
    expect(genres.items.map((item) => item.id)).to.include.members(["comedy", "romance", "ecchi"]);
  });

  await suite.run();
}
