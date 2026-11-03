import { type TestLogger } from "@paperback/types";

import { ExiledRebels } from "../ExiledRebels/main.js";
import sourceInfo from "../ExiledRebels/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("ExiledRebels tests", logger);
  registerDefaultTests(suite, ExiledRebels, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "little bun" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: ["raising-my-little-bun-at-the-military-academy"],
    },
  });

  await suite.run();
}
