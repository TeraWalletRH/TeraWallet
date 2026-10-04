declare module "qrcode" {
  export function toString(
    text: string,
    options?: { type?: "svg" | "utf8" | "terminal"; margin?: number },
  ): Promise<string>;
  export function toDataURL(text: string, options?: Record<string, unknown>): Promise<string>;
}
