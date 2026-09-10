const { execFileSync } = require("node:child_process");
const path = require("node:path");

// Forge passes the build target on the command line (`--platform win32`), and
// packagerConfig is static, so it is read here to pick per-platform icons,
// makers and signing inputs.
const platformArgumentIndex = process.argv.indexOf("--platform");
const targetPlatform =
  platformArgumentIndex >= 0 ? process.argv[platformArgumentIndex + 1] : process.platform;
const windowsCertificateFile = process.env.WINDOWS_CERT_FILE;
const windowsCertificatePassword = process.env.WINDOWS_CERT_PASSWORD;

const makers = [];
if (targetPlatform === "darwin") {
  makers.push({
    name: "@electron-forge/maker-dmg",
    config: {
      format: "ULFO",
    },
  });
}
if (targetPlatform === "win32") {
  makers.push({
    name: "@electron-forge/maker-squirrel",
    config: {
      name: "Mareo",
      setupExe: "MareoSetup.exe",
      setupIcon: path.join(__dirname, "assets", "app-icon.ico"),
      authors: "Wuhan Datou AI Technology Co., Ltd.",
      description: "Mareo desktop host for DeepSeek Harness",
      // Signing the installer needs the code-signing certificate; without it
      // the installer is produced unsigned (SmartScreen will warn).
      ...(windowsCertificateFile && windowsCertificatePassword
        ? {
            certificateFile: windowsCertificateFile,
            certificatePassword: windowsCertificatePassword,
          }
        : {}),
    },
  });
}

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    name: "Mareo",
    icon: targetPlatform === "win32"
      ? path.join(__dirname, "assets", "app-icon.ico")
      : path.join(__dirname, ".cache", "icons", "mareo.icns"),
    appBundleId: "app.mareo.desktop",
    appCategoryType: "public.app-category.productivity",
    asar: true,
    extendInfo: {
      NSAppTransportSecurity: {
        NSAllowsLocalNetworking: true,
      },
    },
    extraResource: [".staging/dsh-runtime", ".staging/node-runtime"],
    ignore: [
      /^\/\.cache(?:\/|$)/,
      /^\/\.npm-cache(?:\/|$)/,
      /^\/\.staging(?:\/|$)/,
      /^\/dist\/tests(?:\/|$)/,
      /^\/runtime(?:\/|$)/,
      /^\/scripts(?:\/|$)/,
      /^\/server(?:\/|$)/,
      /^\/brand(?:\/|$)/,
      /^\/website(?:\/|$)/,
      /^\/entitlements\.mac\.plist$/,
      /^\/tests(?:\/|$)/,
      /^\/src\/.*\.ts$/,
    ],
  },
  makers,
  hooks: {
    generateAssets: async () => {
      // The macOS icon is generated with sips/iconutil; Windows and other
      // hosts use the committed assets/app-icon.ico instead.
      if (process.platform !== "darwin") return;
      execFileSync(process.execPath, [
        path.join(__dirname, "scripts", "generate-icon.mjs"),
      ]);
    },
    postPackage: async (_forgeConfig, { platform, outputPaths }) => {
      if (platform !== "darwin") return;
      const unusedPermissions = [
        "NSAudioCaptureUsageDescription",
        "NSBluetoothAlwaysUsageDescription",
        "NSBluetoothPeripheralUsageDescription",
        "NSCameraUsageDescription",
        "NSMicrophoneUsageDescription",
      ];
      // Optional Developer ID signing + notarization (see scripts/sign-macos.mjs).
      const { signApp, notarizeApp } = await import("./scripts/sign-macos.mjs");
      for (const outputPath of outputPaths) {
        const infoPlist = path.join(
          outputPath,
          "Mareo.app",
          "Contents",
          "Info.plist",
        );
        for (const permission of unusedPermissions) {
          execFileSync("/usr/bin/plutil", ["-remove", permission, infoPlist]);
        }
        const appPath = path.join(outputPath, "Mareo.app");
        if (await signApp(appPath)) {
          await notarizeApp(appPath);
        }
      }
    },
  },
};
