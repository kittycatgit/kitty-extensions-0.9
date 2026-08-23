import { type TestLogger } from "@paperback/types";

import { Manga18Club } from "../Manga18Club/main.js";
import sourceInfo from "../Manga18Club/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Manga18Club tests", logger);
  registerDefaultTests(suite, Manga18Club, sourceInfo);

  await suite.run();
}
