// Bootstrap step of the expo-router migration (see
// /Users/macbook/.claude/plans/fizzy-conjuring-scroll.md): a single catch-all
// route that renders the app exactly as it rendered before router existed,
// so this commit is behavior-preserving. Subsequent steps replace this with
// real per-screen routes under app/(auth) and app/(app).
export { Wallet as default } from "../App";
