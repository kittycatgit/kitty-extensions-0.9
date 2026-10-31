/* eslint-disable @typescript-eslint/no-unused-expressions */
import {
  DiscoverSectionType,
  type DiscoverSection,
  type DiscoverSectionItem,
  type SourceManga,
  type TestLogger,
} from "@paperback/types";
import { expect } from "chai";

import { CoffeeManga } from "../CoffeeManga/main.js";
import sourceInfo from "../CoffeeManga/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const ID_PATTERN = /^[A-Za-z0-9._\-@()[\]%?#+=/&:]+$/;

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("CoffeeManga tests", logger);
  registerDefaultTests(suite, CoffeeManga, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "demon" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: ["flowers-are-bait"],
    },
  });

  let series: SourceManga | undefined;

  suite.test("series metadata is complete", async () => {
    series = await CoffeeManga.getMangaDetails("flowers-are-bait");
    const info = series.mangaInfo;

    expect(info.primaryTitle).to.equal("Flowers Are Bait");
    expect(info.secondaryTitles).to.include("꽂은 미끼야");
    expect(info.thumbnailUrl).to.match(/^https:\/\/coffeemanga\.net\/img\//);
    expect(info.synopsis).to.have.length.greaterThan(50);
    expect(info.status).to.equal("Ongoing");
    expect(info.contentRating).to.equal("ADULT");
    expect(info.rating).to.be.greaterThan(3);
    expect(info.additionalInfo?.Type).to.equal("Manhwa");
    expect(info.additionalInfo?.Year).to.equal("2025");
    expect(Number(info.additionalInfo?.Chapters)).to.be.greaterThan(50);

    const genres = info.tagGroups?.find((group) => group.id === "genres")?.tags ?? [];
    const tags = info.tagGroups?.find((group) => group.id === "tags")?.tags ?? [];
    expect(genres.map((tag) => tag.id)).to.include("romance");
    expect(tags.length).to.be.greaterThan(0);

    for (const tag of [...genres, ...tags]) {
      expect(tag.id).to.match(ID_PATTERN);
    }
  });

  suite.test("every chapter is listed with a date", async () => {
    const chapters = await CoffeeManga.getChapters(series!);

    expect(chapters.length).to.equal(Number(series!.mangaInfo.additionalInfo?.Chapters));
    expect(chapters[0]!.chapNum).to.equal(56);
    expect(chapters[chapters.length - 1]!.chapNum).to.equal(1);
    expect(chapters.every((chapter) => chapter.publishDate instanceof Date)).to.be.true;
    expect(chapters.every((chapter) => ID_PATTERN.test(chapter.chapterId))).to.be.true;
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(chapters.length);
  });

  suite.test("pages resolve through the reader manifest", async () => {
    const manga = await CoffeeManga.getMangaDetails("9wmyhkzjo5qlmxp");
    const chapters = await CoffeeManga.getChapters(manga);
    const chapter = chapters.find((entry) => entry.chapterId === "chapter-24")!;
    const details = await CoffeeManga.getChapterDetails(chapter);

    expect("pages" in details).to.be.true;

    const pages = "pages" in details ? details.pages : [];
    expect(pages.length).to.equal(70);
    expect(pages.every((page) => page.startsWith("https://"))).to.be.true;

    const [response] = await Application.scheduleRequest({ url: pages[0]!, method: "GET" });
    expect(response.status).to.equal(200);
    expect(response.headers["content-type"] ?? response.headers["Content-Type"]).to.match(
      /^image\//,
    );
  });

  suite.test("every discover row yields items", async () => {
    const sections = await CoffeeManga.getDiscoverSections();
    expect(sections.length).to.equal(9);

    for (const section of sections) {
      const result = await CoffeeManga.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.id).to.be.greaterThan(5);

      for (const item of result.items) {
        if (item.type === "genresCarouselItem") {
          expect(item.name).to.have.length.greaterThan(0);
          expect((item.searchQuery.metadata as { genre?: string }).genre).to.match(ID_PATTERN);
        } else {
          expect(item.mangaId, section.id).to.match(ID_PATTERN);
          expect(item.imageUrl, section.id).to.match(/^https:\/\//);
          expect(item.title.length).to.be.greaterThan(0);
        }
      }

      if (section.type === DiscoverSectionType.chapterUpdates) {
        const first = result.items[0] as Extract<
          DiscoverSectionItem,
          { type: "chapterUpdatesCarouselItem" }
        >;
        expect(first.chapterId).to.match(/^chapter-/);
        expect(first.subtitle).to.match(/^Chapter/);
      }
    }
  });

  suite.test("library rows page without repeating", async () => {
    const section: DiscoverSection = {
      id: "most_viewed",
      title: "Most viewed",
      type: DiscoverSectionType.simpleCarousel,
    };
    const first = await CoffeeManga.getDiscoverSectionItems(section, undefined);
    const second = await CoffeeManga.getDiscoverSectionItems(section, first.metadata as never);
    const ids = (items: DiscoverSectionItem[]) =>
      items.map((item) => (item.type === "genresCarouselItem" ? item.name : item.mangaId));

    expect(first.items.length).to.equal(24);
    expect(second.items.length).to.equal(24);
    expect(ids(first.items).filter((id) => ids(second.items).includes(id))).to.be.empty;
  });

  suite.test("title search finds the series and pages", async () => {
    const first = await CoffeeManga.getSearchResults(
      { title: "flowers are bait" },
      undefined,
      undefined,
    );
    expect(first.items.map((item) => item.mangaId)).to.include("flowers-are-bait");
    expect(first.items[0]!.subtitle).to.match(/^Chapter \d+/);

    const page1 = await CoffeeManga.getSearchResults({ title: "demon" }, undefined, undefined);
    const page2 = await CoffeeManga.getSearchResults(
      { title: "demon" },
      page1.metadata as never,
      undefined,
    );
    expect(page1.items.length).to.equal(24);
    expect(page2.items.length).to.be.greaterThan(0);
    expect(
      page1.items
        .map((item) => item.mangaId)
        .filter((id) => page2.items.some((item) => item.mangaId === id)),
    ).to.be.empty;
  });

  suite.test("filters narrow the listing", async () => {
    const result = await CoffeeManga.getSearchResults(
      {
        title: "",
        metadata: { genre: "romance", type: "manhwa", status: "completed" },
      },
      undefined,
      { id: "vistas", label: "Most viewed" },
    );

    expect(result.items.length).to.be.greaterThan(5);

    const details = await CoffeeManga.getMangaDetails(result.items[0]!.mangaId);
    expect(details.mangaInfo.additionalInfo?.Type).to.equal("Manhwa");
    expect(details.mangaInfo.status).to.equal("Completed");
    expect(details.mangaInfo.tagGroups?.[0]?.tags.map((tag) => tag.id)).to.include("romance");
  });

  suite.test("advanced form loads the genre list", async () => {
    const form = await CoffeeManga.getAdvancedSearchForm({ title: "" });
    const sections = form.getSections() as unknown as {
      id: string;
      items: { id: string; items?: unknown[] }[];
    }[];

    expect(sections.map((section) => section.id)).to.deep.equal(["catalog", "genre"]);
    expect(sections[0]!.items.map((row) => row.id)).to.deep.equal(["type", "status", "section"]);

    const genre = sections[1]!.items[0] as unknown as {
      id: string;
      form: { params: { items: unknown[] } };
    };
    expect(genre.id).to.equal("genre");
    expect(genre.form.params.items.length).to.be.greaterThan(50);
  });

  await suite.run();
}
