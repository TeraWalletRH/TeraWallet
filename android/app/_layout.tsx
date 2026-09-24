import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { WalletProvider } from "../src/store/WalletProvider";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <WalletProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </WalletProvider>
    </SafeAreaProvider>
  );
}
