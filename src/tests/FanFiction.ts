import { type TestLogger } from "@paperback/types";

import { FanFiction } from "../FanFiction/main.js";
import sourceInfo from "../FanFiction/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("FanFiction tests", logger);
  registerDefaultTests(suite, FanFiction, sourceInfo);

  await suite.run();
}
