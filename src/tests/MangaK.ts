/* eslint-disable @typescript-eslint/no-unused-expressions */
import { DiscoverSectionType, type DiscoverSectionItem, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { MangaK } from "../MangaK/main.js";
import sourceInfo from "../MangaK/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const ID = /^[A-Za-z0-9._\-@()[\]%?#+=/&:]+$/;

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("MangaK tests", logger);
  registerDefaultTests(suite, MangaK, sourceInfo, {
    mangaProviding: { getMangaDetails: ["trash-of-the-counts-family"] },
  });

  suite.test("series metadata is complete", async () => {
    const manga = await MangaK.getMangaDetails("trash-of-the-counts-family");
    const info = manga.mangaInfo;
    expect(info.primaryTitle).to.match(/Trash of the Count/i);
    expect(info.thumbnailUrl).to.match(/^https:\/\//);
    expect(info.synopsis).not.to.be.empty;
    expect(info.status).to.equal("Ongoing");
    expect(info.author).to.be.a("string").and.not.empty;
    expect(info.rating).to.be.greaterThan(0);
    expect(info.secondaryTitles).not.to.be.empty;
    const tags = (info.tagGroups ?? []).flatMap((group) => group.tags);
    expect(tags.map((tag) => tag.title)).to.include.members(["Action", "Fantasy"]);
    for (const tag of tags) {
      expect(tag.id).to.match(ID);
    }
    expect(info.additionalInfo?.["Chapters"]).to.match(/chapters/);
    expect(info.additionalInfo?.["Type"]).to.equal("Manhwa");
  });

  suite.test("chapter list is the full feed with real numbers", async () => {
    const manga = await MangaK.getMangaDetails("trash-of-the-counts-family");
    const chapters = await MangaK.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(200);
    expect(chapters[0]!.chapNum).to.be.greaterThan(190).and.lessThan(300);
    expect(
      chapters.find((chapter) => chapter.chapNum === 92.5),
      "chapter 92.5",
    ).to.exist;
    expect(chapters[chapters.length - 1]!.chapNum).to.equal(0);
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(chapters.length);
    expect(chapters.filter((chapter) => chapter.publishDate).length).to.equal(chapters.length);
    for (const chapter of chapters) {
      expect(chapter.chapterId).to.match(ID);
    }
    suite.state["chapters"] = chapters;
  });

  suite.test("pages load with the site referer", async () => {
    const chapters = suite.state["chapters"] as Awaited<ReturnType<typeof MangaK.getChapters>>;
    const details = await MangaK.getChapterDetails(chapters[0]!);
    const pages = "pages" in details ? details.pages : [];
    expect(pages.length).to.be.greaterThan(3);
    for (const page of pages) {
      expect(page).to.match(/^https:\/\//);
    }
    const [response] = await Application.scheduleRequest({ url: pages[0]!, method: "GET" });
    expect(response.status).to.equal(200);
    expect(response.headers["content-type"]).to.match(/^image\//);
  });

  suite.test("adult series is rated adult", async () => {
    const manga = await MangaK.getMangaDetails("prince-seal-rebellion-log");
    expect(manga.mangaInfo.contentRating).to.equal("ADULT");
  });

  suite.test("title search finds the series first", async () => {
    const results = await MangaK.getSearchResults({ title: "one piece" }, undefined, undefined);
    expect(results.items[0]!.mangaId).to.equal("one-piece");
    expect(results.items[0]!.subtitle).to.match(/chapters/);
  });

  suite.test("filters narrow the catalogue", async () => {
    const query = {
      title: "",
      metadata: {
        genres: { romance: "included", yaoi: "excluded" },
        status: "completed",
        type: "manhwa",
        minChapters: "50",
      },
    };
    const sort = { id: "views", label: "Most Viewed: All Time" };
    const results = await MangaK.getSearchResults(query, undefined, sort);
    expect(results.items.length).to.be.greaterThan(10);
    const second = await MangaK.getSearchResults(query, results.metadata, sort);
    expect(second.items).not.to.be.empty;
    const ids = new Set(results.items.map((item) => item.mangaId));
    expect(
      second.items.some((item) => ids.has(item.mangaId)),
      "page repeats",
    ).to.be.false;
  });

  suite.test("every discover row yields distinct items", async () => {
    const sections = await MangaK.getDiscoverSections();
    expect(sections.length).to.equal(13);
    const firsts = new Map<string, string>();
    for (const section of sections) {
      const results = await MangaK.getDiscoverSectionItems(section, undefined);
      expect(results.items, section.id).not.to.be.empty;
      for (const item of results.items) {
        if (item.type === "genresCarouselItem") {
          expect(item.name).not.to.be.empty;
          continue;
        }
        expect(item.mangaId, section.id).to.match(ID);
        expect(item.imageUrl, section.id).to.match(/^https:\/\//);
      }
      const key = results.items
        .slice(0, 5)
        .map((item) => ("mangaId" in item ? item.mangaId : item.name))
        .join("|");
      for (const [other, otherKey] of firsts) {
        expect(key, `${section.id} duplicates ${other}`).not.to.equal(otherKey);
      }
      firsts.set(section.id, key);
      suite.state[`row.${section.id}`] = results;
    }
  });

  suite.test("latest and ranked rows page without repeating", async () => {
    for (const id of ["latest", "topWeek"]) {
      const first = suite.state[`row.${id}`] as {
        items: DiscoverSectionItem[];
        metadata?: unknown;
      };
      const section = { id, title: "", type: DiscoverSectionType.simpleCarousel };
      const second = await MangaK.getDiscoverSectionItems(section, first.metadata as never);
      expect(second.items, id).not.to.be.empty;
      const ids = new Set(first.items.map((item) => "mangaId" in item && item.mangaId));
      for (const item of second.items) {
        expect("mangaId" in item && ids.has(item.mangaId), `${id} repeated title`).to.be.false;
      }
    }
  });

  await suite.run();
}
