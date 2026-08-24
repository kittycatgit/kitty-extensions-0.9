import { type TestLogger } from "@paperback/types";

import { HiperDex } from "../HiperDex/main.js";
import sourceInfo from "../HiperDex/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("HiperDex tests", logger);
  registerDefaultTests(suite, HiperDex, sourceInfo);

  await suite.run();
}
