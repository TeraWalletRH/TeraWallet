import { Dimensions } from "react-native";

// The screen the app is drawn on. On a phone it is the window; the web build
// (viewport.web.ts) may sit in a phone-width column on a wider screen, so the
// spotlight tour asks here instead of asking the window directly.
export const screenOrigin = () => ({ x: 0, y: 0 });
export const screenSize = () => Dimensions.get("window");
