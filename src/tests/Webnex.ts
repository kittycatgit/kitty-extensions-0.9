/* eslint-disable @typescript-eslint/no-unused-expressions */
import {
  DiscoverSectionType,
  type Chapter,
  type DiscoverSectionItem,
  type SourceManga,
  type TestLogger,
} from "@paperback/types";
import { expect } from "chai";

import { Webnex } from "../Webnex/main.js";
import sourceInfo from "../Webnex/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const ID = /^[A-Za-z0-9._\-@()[\]%?#+=/&:]+$/;

// Node's fetch pins Sec-Fetch-Mode to "cors", which the reader page answers
// without its cookie. The app sends what the extension sets, so do the same.
// The sandbox only exposes the host through `globalThis`.
function sendNavigationsRaw(): void {
  const host = globalThis;
  const { get } = host.process.getBuiltinModule("node:https");
  const inner = host.fetch;

  host.fetch = async (input, init = {}) => {
    const headers = Object.fromEntries(new host.Headers(init.headers));

    if (headers["sec-fetch-mode"] !== "navigate") {
      return inner(input, init);
    }

    const url = input instanceof host.Request ? input.url : input;

    return new Promise<Response>((resolve, reject) => {
      get(url, { headers: { ...headers, "accept-encoding": "identity" } }, (reply) => {
        const chunks: Buffer[] = [];
        reply.on("data", (chunk: Buffer) => chunks.push(chunk));
        reply.on("end", () =>
          resolve(new host.Response(host.Buffer.concat(chunks), { status: reply.statusCode ?? 0 })),
        );
      }).on("error", reject);
    });
  };
}

export async function runTests(logger: TestLogger) {
  sendNavigationsRaw();
  const suite = new TestSuite("Webnex tests", logger);
  registerDefaultTests(suite, Webnex, sourceInfo, {
    mangaProviding: { getMangaDetails: ["the-academy-is-doomed-0ifdh9kpqo"] },
  });

  suite.test("series metadata is complete", async () => {
    const manga = await Webnex.getMangaDetails("the-academy-is-doomed-0ifdh9kpqo");
    const info = manga.mangaInfo;
    expect(info.primaryTitle).to.equal("The Academy is Doomed");
    expect(info.thumbnailUrl).to.match(/^https:\/\/images\.webnex\.cc\//);
    expect(info.synopsis).to.contain("Amon");
    expect(info.status).to.equal("Completed");
    expect(info.author).to.contain("BIN");
    expect(info.artist).to.contain("GG");
    expect(info.secondaryTitles).to.include("My Ruined Academy");
    expect(info.additionalInfo).to.include({ Type: "Manhwa", Year: "2024", Language: "English" });
    const tags = (info.tagGroups ?? []).flatMap((group) => group.tags);
    // "Teachers" sits behind the panel's "+N more" toggle.
    expect(tags.map((tag) => tag.title)).to.include.members([
      "Comedy",
      "Fantasy",
      "School Life",
      "Teachers",
    ]);
    expect(new Set(tags.map((tag) => tag.id)).size).to.equal(tags.length);
    for (const tag of tags) {
      expect(tag.id).to.match(ID);
    }
  });

  suite.test("18+ series is rated adult", async () => {
    const manga = await Webnex.getMangaDetails("sexual-fantasy-ed2r3vud5n");
    expect(manga.mangaInfo.contentRating).to.equal("ADULT");
  });

  suite.test("chapter list spans every page with dates and groups", async () => {
    const manga = await Webnex.getMangaDetails("the-academy-is-doomed-0ifdh9kpqo");
    const chapters = await Webnex.getChapters(manga);
    expect(chapters.length).to.equal(104);
    expect(chapters[0]!.chapNum).to.equal(104);
    expect(chapters[chapters.length - 1]!.chapNum).to.equal(1);
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(104);
    expect(chapters.filter((chapter) => chapter.publishDate).length).to.be.greaterThan(90);
    expect(chapters[0]!.version).to.be.a("string").and.not.empty;
    for (const chapter of chapters) {
      expect(chapter.chapterId).to.match(ID);
    }
    suite.state["chapters"] = chapters;
  });

  suite.test("decimal chapters and titles parse", async () => {
    const manga = await Webnex.getMangaDetails("sometimes-even-reality-is-a-lie-2unawrftf0");
    const chapters = await Webnex.getChapters(manga);
    const decimal = chapters.find((chapter) => chapter.chapNum === 240.3);
    expect(decimal, "chapter 240.3").to.exist;
    expect(decimal!.title).to.equal("The Wisdom Of A House Husband");
  });

  suite.test("pages resolve through the reader cookie", async () => {
    const chapters = suite.state["chapters"] as Chapter[];
    const details = await Webnex.getChapterDetails(chapters[0]!);
    const pages = "pages" in details ? details.pages : [];
    expect(pages.length).to.be.greaterThan(10);
    for (const page of pages) {
      // Official uploads are proxied by the site; scans come off the image host.
      expect(page).to.match(/^https:\/\/(images\.webnex\.cc|webnex\.cc\/api\/image)\//);
    }
    const [response] = await Application.scheduleRequest({ url: pages[0]!, method: "GET" });
    expect(response.status).to.equal(200);
    expect(response.headers["content-type"]).to.match(/^image\//);
  });

  suite.test("every discover row yields items", async () => {
    const sections = await Webnex.getDiscoverSections();
    expect(sections.length).to.equal(11);
    for (const section of sections) {
      const results = await Webnex.getDiscoverSectionItems(section, undefined);
      expect(results.items, section.id).not.to.be.empty;
      for (const item of results.items) {
        if (item.type === "genresCarouselItem") {
          expect(item.name).not.to.be.empty;
          continue;
        }
        expect(item.mangaId, section.id).to.match(ID);
        expect(item.imageUrl, section.id).to.match(/^https:\/\//);
        if (item.type === "chapterUpdatesCarouselItem") {
          expect(item.chapterId, section.id).to.match(ID);
        }
      }
      suite.state[`row.${section.id}`] = results;
    }
  });

  suite.test("browse rows page without repeating", async () => {
    const first = suite.state["row.sources"] as {
      items: DiscoverSectionItem[];
      metadata?: unknown;
    };
    const section = { id: "sources", title: "", type: DiscoverSectionType.simpleCarousel };
    const second = await Webnex.getDiscoverSectionItems(section, first.metadata as never);
    expect(second.items).not.to.be.empty;
    const ids = new Set(first.items.map((item) => "mangaId" in item && item.mangaId));
    for (const item of second.items) {
      expect("mangaId" in item && ids.has(item.mangaId), "repeated title").to.be.false;
    }
  });

  suite.test("latest updates page through ?latest=", async () => {
    const first = suite.state["row.latest"] as { items: DiscoverSectionItem[]; metadata?: unknown };
    const section = { id: "latest", title: "", type: DiscoverSectionType.chapterUpdates };
    const second = await Webnex.getDiscoverSectionItems(section, first.metadata as never);
    expect(second.items).not.to.be.empty;
    expect(first.items.length).to.be.greaterThan(10);
  });

  suite.test("title search finds the series", async () => {
    const results = await Webnex.getSearchResults(
      { title: "academy is doomed" },
      undefined,
      undefined,
    );
    expect(results.items.map((item) => item.mangaId)).to.include(
      "the-academy-is-doomed-0ifdh9kpqo",
    );
  });

  suite.test("filters narrow the listing", async () => {
    const genres = { [encodeURIComponent("Slice of Life")]: "included" as const };
    const results = await Webnex.getSearchResults(
      {
        title: "",
        metadata: {
          kinds: ["manhwa"],
          statuses: ["completed"],
          genres,
          tags: { Magic: "excluded" },
        },
      },
      undefined,
      { id: "title", label: "" },
    );
    expect(results.items.length).to.be.greaterThan(10);
    const manga: SourceManga = await Webnex.getMangaDetails(results.items[0]!.mangaId);
    expect(manga.mangaInfo.additionalInfo?.["Type"]).to.equal("Manhwa");
    expect(manga.mangaInfo.status).to.equal("Completed");
  });

  suite.test("sorting by latest update works with a query", async () => {
    const results = await Webnex.getSearchResults({ title: "academy" }, undefined, {
      id: "updated",
      label: "",
    });
    expect(results.items.length).to.be.greaterThan(10);
  });

  suite.test("advanced search form loads the taxonomy", async () => {
    const form = await Webnex.getAdvancedSearchForm({ title: "" });
    const sections = form.getSections();
    expect(sections.length).to.equal(4);
    const taxonomy = sections.find((section) => section.id === "taxonomy")!;
    expect(taxonomy.items.length, "taxonomy rows").to.equal(3);
    // A tri-state row keeps its options on the nested form it opens.
    const genres = (
      taxonomy.items[0] as unknown as {
        form: { params: { items: Array<{ id: string; title: string }> } };
      }
    ).form.params;
    expect(genres.items.length).to.equal(150);
    expect(genres.items.map((genre) => genre.title)).to.include.members([
      "Action",
      "Romance",
      "Boys' Love",
    ]);
    for (const genre of genres.items) {
      expect(genre.id).to.match(ID);
    }
  });

  suite.test("a sweep of titles parses cleanly", async () => {
    const row = suite.state["row.sources"] as { items: DiscoverSectionItem[] };
    for (const item of row.items.slice(0, 6)) {
      if (!("mangaId" in item)) {
        continue;
      }
      const manga = await Webnex.getMangaDetails(item.mangaId);
      expect(manga.mangaInfo.thumbnailUrl, item.mangaId).to.match(/^https:\/\//);
      expect(manga.mangaInfo.synopsis, item.mangaId).not.to.be.empty;
      for (const tag of (manga.mangaInfo.tagGroups ?? []).flatMap((group) => group.tags)) {
        expect(tag.id, `${item.mangaId} ${tag.title}`).to.match(ID);
      }
      const chapters = await Webnex.getChapters(manga);
      const listed = Number(manga.mangaInfo.additionalInfo?.["Chapters"]);
      expect(chapters.length, `${item.mangaId} chapter count`).to.equal(listed);
    }
  });

  await suite.run();
}
