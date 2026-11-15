/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { MangaFox } from "../MangaFox/main.js";
import sourceInfo from "../MangaFox/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

// A title the mobile reader refuses as licensed, a long-strip one and a plain one.
const TITLES = ["one_piece", "solo_leveling", "chainsaw_man"];
const END_SCREEN_BYTES = 206523;

async function imageBytes(url: string): Promise<{ head: string; size: number }> {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  expect(response.status, url).to.equal(200);
  const head = Array.from(new Uint8Array(buffer.slice(0, 4)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return { head, size: buffer.byteLength };
}

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("MangaFox tests", logger);
  registerDefaultTests(suite, MangaFox, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "one piece" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: [TITLES[0]!],
    },
  });

  for (const title of TITLES) {
    suite.test(`${title}: the first chapter serves every page as a real image`, async () => {
      const manga = await MangaFox.getMangaDetails(title);
      const chapters = await MangaFox.getChapters(manga);
      expect(chapters.length).to.be.greaterThan(1);
      const details = await MangaFox.getChapterDetails(chapters[chapters.length - 1]!);
      expect("pages" in details).to.be.true;
      if ("pages" in details) {
        expect(details.pages.length).to.be.greaterThan(4);
        expect(new Set(details.pages).size).to.equal(details.pages.length);
        for (const page of details.pages) {
          expect(page).to.match(/^https:\/\/[^/]+\/store\/manga\//);
        }
        const first = await imageBytes(details.pages[0]!);
        const last = await imageBytes(details.pages[details.pages.length - 1]!);
        expect(first.head).to.match(/^(ffd8ff|89504e47)/);
        expect(last.head).to.match(/^(ffd8ff|89504e47)/);
        expect(last.size).to.not.equal(END_SCREEN_BYTES);
      }
    });
  }

  await suite.run();
}
