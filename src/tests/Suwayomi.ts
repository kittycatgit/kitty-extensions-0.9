/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { Suwayomi } from "../Suwayomi/main.js";
import { PASS_KEY, SERVER_KEY, USER_KEY } from "../Suwayomi/models.js";
import { TestSuite } from "./suite.js";

// There is no public server to test against. Point these at your own:
// SUWAYOMI_SERVER, SUWAYOMI_USER and SUWAYOMI_PASSWORD. Without them only the
// unconfigured behaviour is checked. The sandbox exposes the host through
// `globalThis`.
const env = (name: string): string =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name] ??
  "";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Suwayomi tests", logger);
  const server = env("SUWAYOMI_SERVER");

  await Suwayomi.initialise();

  suite.test("an unconfigured source says what is missing", async () => {
    Application.setState(undefined, SERVER_KEY);

    let message = "";

    try {
      await Suwayomi.getDiscoverSections();
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).to.contain("No Suwayomi server address is set");
  });

  if (!server) {
    logger.log(
      "skipped",
      "set SUWAYOMI_SERVER, SUWAYOMI_USER and SUWAYOMI_PASSWORD to test a server",
    );
    await suite.run();
    return;
  }

  const configure = (): void => {
    Application.setState(server, SERVER_KEY);
    Application.setState(env("SUWAYOMI_USER"), USER_KEY);
    Application.setSecureState(env("SUWAYOMI_PASSWORD"), PASS_KEY);
  };

  suite.test("every home row of every site has titles with covers", async () => {
    configure();

    const sections = await Suwayomi.getDiscoverSections();
    expect(sections.length).to.be.greaterThan(0);

    for (const section of sections) {
      const page = await Suwayomi.getDiscoverSectionItems(section, undefined);
      expect(page.items.length, section.title).to.be.greaterThan(0);

      for (const item of page.items) {
        if (!("mangaId" in item)) {
          throw new Error(`${section.title} holds something that is not a title`);
        }

        expect(item.mangaId).to.match(/^\d+$/);
        expect(item.imageUrl).to.match(/^https?:\/\//);
      }
    }
  });

  suite.test("search reaches details, chapters and pages", async () => {
    configure();

    const first = await Suwayomi.getSearchResults({ title: "one" }, undefined);
    expect(first.items.length).to.be.greaterThan(0);

    const hit = first.items[0]!;
    expect(hit.subtitle).to.be.a("string").and.not.empty;

    const manga = await Suwayomi.getMangaDetails(hit.mangaId);
    expect(manga.mangaInfo.primaryTitle).to.equal(hit.title);
    expect(manga.mangaInfo.thumbnailUrl).to.match(/^https?:\/\//);
    expect(manga.mangaInfo.additionalInfo?.Site).to.be.a("string").and.not.empty;

    const chapters = await Suwayomi.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(0);
    expect(new Set(chapters.map((chapter) => chapter.chapterId)).size).to.equal(chapters.length);

    for (const [index, chapter] of chapters.entries()) {
      if (index > 0) {
        expect(chapter.sortingIndex).to.be.lessThan(chapters[index - 1]!.sortingIndex!);
      }
    }

    const details = await Suwayomi.getChapterDetails(chapters.at(-1)!);
    const pages = "pages" in details ? details.pages : [];
    expect(pages.length).to.be.greaterThan(0);

    const [response, data] = await Application.scheduleRequest({
      url: pages[0]!,
      method: "GET",
    });
    expect(response.status).to.equal(200);
    expect(data.byteLength).to.be.greaterThan(1000);
  });

  suite.test("the settings form signs in and names the sites", async () => {
    configure();

    const form = await Suwayomi.getSettingsForm();
    form.reloadForm = () => {};
    await form.testConnection();

    const footers = form.getSections().map((section) => section.footer ?? "");
    expect(footers.some((footer) => footer.startsWith("Signed in as"))).to.be.true;
  });

  await suite.run();
}
