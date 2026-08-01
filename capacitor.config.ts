import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.dermwatch.local",
  appName: "DermWatch",
  webDir: "dist",
  backgroundColor: "#f4f4f1",
  server: {
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
