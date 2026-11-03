import { type TestLogger } from "@paperback/types";

import { LagoonScans } from "../LagoonScans/main.js";
import sourceInfo from "../LagoonScans/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("LagoonScans tests", logger);
  registerDefaultTests(suite, LagoonScans, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "mercenary" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: ["the-regressed-mercenarys-machinations"],
    },
  });

  await suite.run();
}
