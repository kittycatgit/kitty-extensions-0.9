import { type TestLogger } from "@paperback/types";

import { DankeFursLesen } from "../DankeFursLesen/main.js";
import sourceInfo from "../DankeFursLesen/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("DankeFursLesen tests", logger);
  registerDefaultTests(suite, DankeFursLesen, sourceInfo);

  await suite.run();
}
