/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type Chapter, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { NoodleBrainSquad } from "../NoodleBrainSquad/main.js";
import sourceInfo from "../NoodleBrainSquad/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

const SERIES = "franchise-god";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("NoodleBrainSquad tests", logger);
  registerDefaultTests(suite, NoodleBrainSquad, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "god" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: [SERIES],
    },
  });

  suite.test("every discover row yields items with covers", async () => {
    const sections = await NoodleBrainSquad.getDiscoverSections();
    expect(sections.length).to.equal(4);
    for (const section of sections) {
      const result = await NoodleBrainSquad.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.id).to.be.greaterThan(0);
      for (const item of result.items) {
        if (item.type !== "genresCarouselItem") {
          expect(item.imageUrl, section.id).to.match(/^https?:\/\//);
        }
      }
    }
  });

  suite.test("series details carry novel metadata", async () => {
    const manga = await NoodleBrainSquad.getMangaDetails(SERIES);
    expect(manga.mangaInfo.primaryTitle).to.not.be.empty;
    expect(manga.mangaInfo.contentType).to.equal("novel");
    expect(manga.mangaInfo.thumbnailUrl).to.match(/^https?:\/\//);
    expect(manga.mangaInfo.synopsis).to.not.be.empty;
    const chapters = await NoodleBrainSquad.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(0);
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(chapters.length);
    suite.state["chapters"] = chapters;
  });

  suite.test("chapter text resolves as html", async () => {
    const chapters = suite.state["chapters"] as Chapter[];
    const details = await NoodleBrainSquad.getChapterDetails(chapters[0]!);
    expect(details.type).to.equal("html");
    if (details.type === "html") {
      const text = details.html
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      expect(text.length).to.be.greaterThan(500);
    }
  });

  suite.test("genre filter changes the listing", async () => {
    const all = await NoodleBrainSquad.getSearchResults({ title: "" }, undefined);
    const tags = await NoodleBrainSquad.searchTags();
    const genre = tags.find((section) => section.title === "genres")?.tags[0];
    expect(genre, "no genres parsed").to.not.be.undefined;
    const filtered = await NoodleBrainSquad.getSearchResults(
      { title: "", metadata: { genres: [genre!.id] } },
      undefined,
    );
    expect(filtered.items.length).to.be.greaterThan(0);
    expect(filtered.items.map((item) => item.mangaId)).to.not.deep.equal(
      all.items.map((item) => item.mangaId),
    );
  });

  await suite.run();
}
