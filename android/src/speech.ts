import { useEffect } from "react";
import type * as Speech from "expo-speech-recognition";

// Expo Go does not include this native module. Loading it only when present
// keeps the rest of the wallet available for preview.
let nativeSpeech: typeof Speech | null = null;
try {
  nativeSpeech = require("expo-speech-recognition") as typeof Speech;
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("ExpoSpeechRecognition"))
    throw error;
}

export const speechAvailable = nativeSpeech !== null;
export const ExpoSpeechRecognitionModule = nativeSpeech?.ExpoSpeechRecognitionModule;

export const useSpeechRecognitionEvent: typeof Speech.useSpeechRecognitionEvent =
  (eventName, listener) => {
    useEffect(() => {
      if (!nativeSpeech) return;
      const subscription = nativeSpeech.ExpoSpeechRecognitionModule.addListener(
        eventName,
        listener as never,
      );
      return () => subscription.remove();
    }, [eventName, listener]);
  };
