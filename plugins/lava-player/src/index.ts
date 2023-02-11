import { dirname, importx } from "@discordx/importer";
import { Plugin } from "discordx";

export class LavaPlayerPlugin extends Plugin {
  async init(): Promise<void> {
    await importx(`${dirname(import.meta.url)}/**/*.cmd.{ts,js}`);
  }
}
