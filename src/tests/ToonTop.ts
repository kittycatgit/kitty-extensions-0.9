import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { ToonTop } from "../ToonTop/main.js";
import sourceInfo from "../ToonTop/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("ToonTop tests", logger);
  registerDefaultTests(suite, ToonTop, sourceInfo);

  suite.test("chapter numbers come from the names", async () => {
    const manga = await ToonTop.getMangaDetails("monster-eater");
    const chapters = await ToonTop.getChapters(manga);
    const byTitle = new Map(chapters.map((chapter) => [chapter.title, chapter.chapNum]));
    expect(byTitle.get("Chapter 126")).to.equal(126);
    expect(byTitle.get("Chapter 91.5")).to.equal(91.5);
    expect(byTitle.get("Chapter 0")).to.equal(0);
  });

  await suite.run();
}
