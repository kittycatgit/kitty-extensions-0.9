import { type TestLogger } from "@paperback/types";

import { DivineDaoLibrary } from "../DivineDaoLibrary/main.js";
import sourceInfo from "../DivineDaoLibrary/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("DivineDaoLibrary tests", logger);
  registerDefaultTests(suite, DivineDaoLibrary, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "villain" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: ["lets-manage-the-tower"],
    },
  });

  await suite.run();
}
