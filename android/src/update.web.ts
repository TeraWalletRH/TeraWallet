// Updating, in the browser build.
//
// There is no APK here. The web app updates the way a website does: the
// service worker fetches the new build, and the next launch runs it. So there
// is nothing to check or install from inside the app, and every answer below
// says so rather than pretending to be an Android install.
import { CURRENT, OPTIONAL, REQUIRED } from "../../public/tera/core/update.js";
import type { Channel, Manifest, UpdateDecision } from "./update";

export { CURRENT, OPTIONAL, REQUIRED };
export type { Channel, Manifest, UpdateDecision };

/** Stamped by scripts/build-web.mjs, so Settings shows which web build is open. */
const BUILD = Number(process.env.EXPO_PUBLIC_WEB_BUILD);

export const installedVersionCode = (): number | null =>
  Number.isSafeInteger(BUILD) && BUILD > 0 ? BUILD : null;
export const installedVersionName = () => "web";
/** terawallet.app is the production site; the web build is never a preview. */
export const installedChannel = (): Channel | null => "production";
export const checkForUpdate = async (): Promise<UpdateDecision | null> => null;
export async function downloadApk(_manifest: Manifest): Promise<string> {
  throw new Error("Updates arrive with the page on the web. / 网页版随页面自动更新。");
}
export async function installApk(_fileUri: string): Promise<void> {
  throw new Error("Updates arrive with the page on the web. / 网页版随页面自动更新。");
}
