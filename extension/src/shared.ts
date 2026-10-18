// What the worker and the extension's pages agree on.

/** The "origin" of a send the owner starts from the popup, not a site. */
export const OWN = "tera:wallet";

/** How a request's origin reads in Tera's windows and lists. */
export const originLabel = (origin: string) =>
  origin === OWN ? "You, from Tera" : origin.replace(/^https:\/\//, "");
