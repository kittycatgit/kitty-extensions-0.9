/* eslint-disable @typescript-eslint/no-unused-expressions */
import {
  ContentRating,
  DiscoverSectionType,
  type Chapter,
  type DiscoverSectionItem,
  type SourceManga,
  type TestLogger,
} from "@paperback/types";
import { expect } from "chai";

import { ManhwaToon } from "../ManhwaToon/main.js";
import type { ManhwaToonMetadata } from "../ManhwaToon/models.js";
import sourceInfo from "../ManhwaToon/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const ID = /^[A-Za-z0-9._\-@()[\]%?#+=/&:]+$/;
const SERIES = "global-martial-arts";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("ManhwaToon tests", logger);
  registerDefaultTests(suite, ManhwaToon, sourceInfo, {
    mangaProviding: { getMangaDetails: [SERIES] },
  });

  suite.test("series metadata is complete", async () => {
    const manga = await ManhwaToon.getMangaDetails(SERIES);
    const info = manga.mangaInfo;
    expect(info.primaryTitle).to.equal("Global Martial Arts");
    expect(info.thumbnailUrl).to.match(/^https:\/\/cdn\.manhwatoon\.me\//);
    expect(info.synopsis).to.contain("Rebirth");
    expect(info.status).to.equal("Ongoing");
    expect(info.author).to.contain("Laoin");
    expect(info.secondaryTitles).to.include("Global Gao Wu");
    expect(info.additionalInfo?.["Type"]).to.equal("Manhua");
    expect(info.contentRating).to.equal(ContentRating.EVERYONE);
    const tags = (info.tagGroups ?? []).flatMap((group) => group.tags);
    expect(tags.map((tag) => tag.title)).to.include.members(["Action", "Adventure"]);
    for (const tag of tags) {
      expect(tag.id).to.match(ID);
    }
  });

  suite.test("18+ series is rated adult with artist and absolute chapter dates", async () => {
    const manga = await ManhwaToon.getMangaDetails("secret-sex-room");
    expect(manga.mangaInfo.contentRating).to.equal(ContentRating.ADULT);
    expect(manga.mangaInfo.artist).to.contain("Nico");
    expect(manga.mangaInfo.status).to.equal("Completed");
    const chapters = await ManhwaToon.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(0);
    const date = chapters[0]!.publishDate!;
    expect(date.getTime()).to.be.lessThan(Date.now() - 86_400_000);
  });

  suite.test("chapter list carries numbers, ids and dates", async () => {
    const manga = await ManhwaToon.getMangaDetails(SERIES);
    const chapters = await ManhwaToon.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(50);
    expect(chapters[0]!.chapNum).to.be.greaterThan(chapters[chapters.length - 1]!.chapNum);
    expect(chapters[chapters.length - 1]!.chapNum).to.equal(1);
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(chapters.length);
    expect(chapters.filter((chapter) => chapter.publishDate).length).to.equal(chapters.length);
    for (const chapter of chapters) {
      expect(chapter.chapterId).to.match(ID);
    }
    suite.state["chapters"] = chapters;
  });

  suite.test("pages resolve and the first image is served", async () => {
    const chapters = suite.state["chapters"] as Chapter[];
    const last = chapters[chapters.length - 1]!;
    const details = await ManhwaToon.getChapterDetails(last);
    expect("pages" in details).to.be.true;
    if ("pages" in details) {
      expect(details.pages.length).to.be.greaterThan(3);
      // The CDN labels images text/plain, so check the bytes instead.
      const [response, buffer] = await Application.scheduleRequest({
        url: details.pages[1]!,
        method: "GET",
      });
      expect(response.status).to.equal(200);
      const head = Array.from(new Uint8Array(buffer.slice(0, 12)))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      expect(head).to.match(/^(89504e47|ffd8ff|52494646.{8}57454250|474946)/);
    }
  });

  suite.test("every discover row yields items", async () => {
    const sections = await ManhwaToon.getDiscoverSections();
    expect(sections.length).to.equal(11);
    for (const section of sections) {
      const results = await ManhwaToon.getDiscoverSectionItems(section, undefined);
      expect(results.items.length, section.id).to.be.greaterThan(0);
      for (const item of results.items) {
        if (item.type === "genresCarouselItem") {
          expect(item.name, JSON.stringify(item)).to.not.be.empty;
          continue;
        }
        expect(item.mangaId, section.id).to.match(ID);
        expect(item.imageUrl, section.id).to.match(/^https?:\/\//);
        expect(item.title, section.id).to.not.be.empty;
      }
      if (section.type === DiscoverSectionType.chapterUpdates) {
        const first = results.items[0] as DiscoverSectionItem & { chapterId?: string };
        expect(first.chapterId, JSON.stringify(first)).to.not.be.empty;
      }
    }
  });

  suite.test("paged rows continue without repeating", async () => {
    const sections = await ManhwaToon.getDiscoverSections();
    for (const id of ["latest", "views"]) {
      const section = sections.find((entry) => entry.id === id)!;
      const first = await ManhwaToon.getDiscoverSectionItems(section, undefined);
      const second = await ManhwaToon.getDiscoverSectionItems(
        section,
        first.metadata as ManhwaToonMetadata,
      );
      expect(second.items.length, id).to.be.greaterThan(0);
      const ids = new Set(first.items.map((item) => "mangaId" in item && item.mangaId));
      for (const item of second.items) {
        expect(ids.has("mangaId" in item && item.mangaId), id).to.be.false;
      }
    }
  });

  suite.test("title search finds the series", async () => {
    const results = await ManhwaToon.getSearchResults(
      { title: "Global Martial Arts", metadata: undefined },
      undefined,
      undefined,
    );
    expect(results.items.map((item) => item.mangaId)).to.include(SERIES);
    expect(results.items[0]!.subtitle).to.not.be.empty;
  });

  suite.test("filters narrow the listing", async () => {
    const results = await ManhwaToon.getSearchResults(
      {
        title: "",
        metadata: { types: ["manhwa"], genres: ["romance"], statuses: ["end"], adult: "0" },
      },
      undefined,
      { id: "alphabet", label: "A-Z" },
    );
    expect(results.items.length).to.equal(10);
    expect(results.items[0]!.title.toUpperCase().startsWith("A")).to.be.true;
    const manga: SourceManga = await ManhwaToon.getMangaDetails(results.items[0]!.mangaId);
    expect(manga.mangaInfo.status).to.equal("Completed");
    const tags = (manga.mangaInfo.tagGroups ?? []).flatMap((group) => group.tags);
    expect(tags.map((tag) => tag.id)).to.include.members(["manhwa", "romance"]);
  });

  suite.test("search pages end cleanly", async () => {
    const query = { title: "zzzzqqqq-no-such-series", metadata: undefined };
    const results = await ManhwaToon.getSearchResults(query, undefined, undefined);
    expect(results.items).to.be.empty;
  });

  suite.test("advanced form loads the site's filters", async () => {
    const form = await ManhwaToon.getAdvancedSearchForm({ title: "", metadata: undefined });
    const sections = form.getSections();
    expect(sections.length).to.equal(4);
    type Rows = { items: { form: { params: { items: { id: string }[] } } }[] };
    const catalog = sections[0] as unknown as Rows;
    expect(catalog.items.length).to.equal(2);
    expect(catalog.items[0]!.form.params.items.length).to.equal(3);
    const genres = (sections[2] as unknown as Rows).items[0]!;
    expect(genres.form.params.items.length).to.be.greaterThan(80);
    for (const genre of genres.form.params.items) {
      expect(genre.id).to.match(ID);
    }
  });

  await suite.run();
}
