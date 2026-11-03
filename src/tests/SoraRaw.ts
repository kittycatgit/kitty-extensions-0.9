import { type TestLogger } from "@paperback/types";

import { SoraRaw } from "../SoraRaw/main.js";
import sourceInfo from "../SoraRaw/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("SoraRaw tests", logger);
  registerDefaultTests(suite, SoraRaw, sourceInfo);

  await suite.run();
}
