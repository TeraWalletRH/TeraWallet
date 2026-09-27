import { Dimensions } from "react-native";

// On a desktop the app sits in a phone-width column (#frame, set up by the web
// page's own stylesheet), and overlays are drawn inside that column. Window
// coordinates are therefore offset by where the column starts.
const frame = () => document.getElementById("frame")?.getBoundingClientRect();

export const screenOrigin = () => {
  const rect = frame();
  return rect ? { x: rect.left, y: rect.top } : { x: 0, y: 0 };
};

export const screenSize = () => {
  const rect = frame();
  return rect ? { width: rect.width, height: rect.height } : Dimensions.get("window");
};
