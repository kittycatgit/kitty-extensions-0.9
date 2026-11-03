import { type TestLogger } from "@paperback/types";

import { Toonz } from "../Toonz/main.js";
import sourceInfo from "../Toonz/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Toonz tests", logger);
  registerDefaultTests(suite, Toonz, sourceInfo);

  await suite.run();
}
