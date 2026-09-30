import { Alert, type AlertButton } from "react-native";

// react-native-web ships Alert as a no-op, which would make every confirmation
// in the app — erasing the wallet among them — a button that does nothing. The
// browser's own dialogs stand in: one button is a notice, and a cancel button
// plus another is a question whose answer runs that other button.
Alert.alert = (title: string, message?: string, buttons?: AlertButton[]) => {
  const text = message ? `${title}\n\n${message}` : title;
  const cancel = buttons?.find((b) => b.style === "cancel");
  const proceed = buttons?.filter((b) => b !== cancel) ?? [];
  if (!cancel || proceed.length === 0) {
    window.alert(text);
    proceed[0]?.onPress?.();
    return;
  }
  if (window.confirm(text)) proceed[proceed.length - 1].onPress?.();
  else cancel.onPress?.();
};
